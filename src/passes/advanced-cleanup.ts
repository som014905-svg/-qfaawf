import { tokenize, LuaToken, reencodeLuaString } from "../utils/lua-utils";

export interface CleanupResult {
  result: string;
  changed: number;
  notes: string[];
}

type Literal = { kind: "string" | "number" | "boolean" | "nil"; text: string; value?: string | number | boolean };

/**
 * Conservative source-level constant propagation. Only propagates locals that:
 *  - have exactly one local declaration in the whole source,
 *  - are initialized with a scalar literal,
 *  - are never assigned afterwards,
 *  - are referenced as plain identifiers (never property/method names).
 * This is deliberately conservative because Lua closures and shadowing make
 * aggressive data-flow rewriting unsafe without a full parser/CFG.
 */
export function propagateImmutableLocals(src: string): CleanupResult {
  const toks = [...tokenize(src)];
  const sig = toks.filter(t => !isTrivia(t) && t.kind !== "eof");
  const decls = new Map<string, { idx: number; literal: Literal }[]>();
  const refs = new Map<string, number[]>();
  const assignments = new Map<string, number>();

  // v4: names that are DECLARED more than once anywhere (locals, function
  // parameters, for-loop variables, vararg-ish binds) disqualify themselves
  // from propagation — shadowing in a nested scope would make blind inline a
  // semantic rewrite (e.g. `local a=5; function f(a) return a end`).
  const declCount = new Map<string, number>();
  const bumpDecl = (name: string) => declCount.set(name, (declCount.get(name) ?? 0) + 1);

  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    if (t.kind === "keyword" && t.text === "local") {
      let p = i + 1;
      if (sig[p]?.text === "function") continue;
      while (sig[p]?.kind === "identifier") {
        const name = sig[p].text;
        bumpDecl(name);
        if (sig[p + 1]?.text === "=") {
          const lit = tokenLiteral(sig[p + 2]);
          if (lit) {
            const arr = decls.get(name) ?? [];
            arr.push({ idx: p, literal: lit });
            decls.set(name, arr);
          }
        }
        if (sig[p + 1]?.text !== ",") break;
        p += 2;
      }
      continue;
    }
    // function(params...) — every parameter is a declaration of its own
    if (t.kind === "keyword" && t.text === "function") {
      let p = i + 1;
      while (sig[p] && (sig[p].kind === "identifier" || sig[p].text === "." || sig[p].text === ":")) p++;
      if (sig[p]?.text !== "(") continue;
      p++;
      while (sig[p] && sig[p].text !== ")") {
        if (sig[p].kind === "identifier") bumpDecl(sig[p].text);
        p++;
      }
      continue;
    }
    // for v = a,b[,c] do / for k,v in pairs(t) do — loop vars are declarations
    if (t.kind === "keyword" && t.text === "for") {
      let p = i + 1;
      while (sig[p]?.kind === "identifier") {
        bumpDecl(sig[p].text);
        if (sig[p + 1]?.text === ",") {
          p += 2;
          continue;
        }
        break;
      }
      continue;
    }
    if (t.kind !== "identifier") continue;
    const arr = refs.get(t.text) ?? [];
    arr.push(i);
    refs.set(t.text, arr);
    const next = sig[i + 1];
    const prev = sig[i - 1];
    if (next?.text === "=" && !(prev?.kind === "keyword" && prev.text === "local")) {
      assignments.set(t.text, (assignments.get(t.text) ?? 0) + 1);
    }
  }

  const edits: Array<{ start: number; end: number; text: string }> = [];
  let changed = 0;
  for (const [name, ds] of decls) {
    if (ds.length !== 1) continue;
    if ((declCount.get(name) ?? 0) !== 1) continue; // shadowed somewhere — skip
    if ((assignments.get(name) ?? 0) > 0) continue;
    const literal = ds[0].literal;
    // v4.1: never inline BIG string literals — they are almost always
    // encoded payloads; duplicating them at every reference explodes the
    // output (the declaration itself is kept, so each reference is pure growth).
    if (literal.kind === "string" && literal.text.length > 256) continue;
    const occurrences = refs.get(name) ?? [];
    for (const idx of occurrences) {
      if (idx === ds[0].idx) continue;
      const t = sig[idx];
      const prev = sig[idx - 1];
      const next = sig[idx + 1];
      if (prev?.text === "." || prev?.text === ":") continue;
      if (next?.text === "=") continue;
      if (isTableKeyPosition(sig, idx)) continue;
      edits.push({ start: t.start, end: t.end, text: literal.text });
      changed++;
    }
  }

  if (!edits.length) return { result: src, changed: 0, notes: [] };
  const result = applyEdits(src, edits);
  return {
    result,
    changed,
    notes: [`Propagated ${changed} immutable local reference(s).`],
  };
}

/** Simplify local scalar aliases after constant folding: `local a = b; return a`
 * becomes `local a = b; return <literal>` through the propagation pass. */

function tokenLiteral(t: LuaToken | undefined): Literal | null {
  if (!t) return null;
  if (t.kind === "string" || t.kind === "longstring") {
    const value = t.value ?? "";
    return { kind: "string", text: reencodeLuaString(value, '"') };
  }
  if (t.kind === "number") return { kind: "number", text: t.text };
  if (t.kind === "keyword" && (t.text === "true" || t.text === "false")) {
    return { kind: "boolean", text: t.text };
  }
  if (t.kind === "keyword" && t.text === "nil") return { kind: "nil", text: "nil" };
  return null;
}

function isTableKeyPosition(sig: LuaToken[], idx: number): boolean {
  const t = sig[idx];
  const next = sig[idx + 1];
  const prev = sig[idx - 1];
  // `{ name = value }` / `{ [name] = value }`
  if (next?.text === "=") return true;
  if (prev?.text === "[") {
    let d = 1;
    for (let j = idx + 1; j < Math.min(sig.length, idx + 10); j++) {
      if (sig[j].text === "[") d++;
      if (sig[j].text === "]") {
        d--;
        if (d === 0) return sig[j + 1]?.text === "=";
      }
    }
  }
  return false;
}

function isTrivia(t: LuaToken): boolean {
  return t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment";
}

function applyEdits(src: string, edits: Array<{ start: number; end: number; text: string }>): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: string[] = [];
  let cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor) continue;
    out.push(src.slice(cursor, e.start), e.text);
    cursor = e.end;
  }
  out.push(src.slice(cursor));
  return out.join("");
}
