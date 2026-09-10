import { tokenize, LuaToken, reencodeLuaString, tryBase64Decode } from "../utils/lua-utils";
import { evalExprFromTokens } from "../utils/const-eval";

export interface StaticResolveResult {
  result: string;
  changed: number;
  notes: string[];
}

type Scalar = { kind: "string" | "number" | "boolean" | "nil"; text: string };

function trivia(t: LuaToken): boolean {
  return t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment";
}

function sigTokens(src: string): LuaToken[] {
  return [...tokenize(src)].filter((t) => !trivia(t) && t.kind !== "eof");
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


function constNumber(tokens: LuaToken[]): number | null {
  const compact = tokens.filter((t) => !trivia(t) && t.kind !== "eof");
  if (!compact.length) return null;
  const ev = evalExprFromTokens(compact, 0);
  if (!ev || ev.endIndex !== compact.length || ev.value.k !== "number") return null;
  const n = ev.value.v;
  return Number.isFinite(n) && Number.isSafeInteger(n) ? n : null;
}

function scalar(t: LuaToken | undefined): Scalar | null {
  if (!t) return null;
  if (t.kind === "string" || t.kind === "longstring") {
    return { kind: "string", text: reencodeLuaString(t.value ?? "", '"') };
  }
  if (t.kind === "number") return { kind: "number", text: t.text };
  if (t.kind === "keyword" && (t.text === "true" || t.text === "false")) {
    return { kind: "boolean", text: t.text };
  }
  if (t.kind === "keyword" && t.text === "nil") return { kind: "nil", text: "nil" };
  return null;
}

/**
 * Replace simple immutable array/dictionary tables with literal values.
 *
 * Supported examples:
 *   local T = {"foo", "bar", 123}
 *   print(T[1], T[2])
 *   local U = T; print(U[1])
 *
 * Safety rules are intentionally strict: every table entry must be a scalar,
 * the table must be declared once, and no direct reassignment of the table is
 * present. This keeps the pass source-to-source and avoids executing attacker
 * supplied Lua.
 */
export function inlineStaticTables(src: string): StaticResolveResult {
  const sig = sigTokens(src);
  const tables = new Map<string, Map<number, Scalar>>();
  const aliases = new Map<string, string>();
  const declCount = new Map<string, number>();
  const assignments = new Map<string, number>();

  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    if (t.text === "local" && sig[i + 1]?.kind === "identifier" && sig[i + 2]?.text === "=") {
      const name = sig[i + 1].text;
      declCount.set(name, (declCount.get(name) ?? 0) + 1);
      const rhs = sig[i + 3];
      if (rhs?.text === "{") {
        let j = i + 4;
        let idx = 1;
        const values = new Map<number, Scalar>();
        let ok = true;
        while (j < sig.length && sig[j].text !== "}") {
          const lit = scalar(sig[j]);
          if (!lit) { ok = false; break; }
          values.set(idx++, lit);
          j++;
          if (sig[j]?.text === ",") j++;
          else if (sig[j]?.text !== "}") { ok = false; break; }
        }
        if (ok && sig[j]?.text === "}" && values.size > 0) tables.set(name, values);
      }
      if (rhs?.kind === "identifier") aliases.set(name, rhs.text);
      continue;
    }
    if (t.kind !== "identifier") continue;
    const next = sig[i + 1];
    const prev = sig[i - 1];
    if (next?.text === "=" && !(prev?.text === "local")) {
      assignments.set(t.text, (assignments.get(t.text) ?? 0) + 1);
    }
  }

  // Only keep once-declared, never-reassigned static tables.
  for (const name of [...tables.keys()]) {
    if ((declCount.get(name) ?? 0) !== 1 || (assignments.get(name) ?? 0) > 0) tables.delete(name);
  }

  const resolveTable = (name: string, depth = 0): Map<number, Scalar> | null => {
    if (depth > 4) return null;
    const direct = tables.get(name);
    if (direct) return direct;
    const next = aliases.get(name);
    return next ? resolveTable(next, depth + 1) : null;
  };

  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (let i = 0; i + 3 < sig.length; i++) {
    if (sig[i].kind !== "identifier" || sig[i + 1]?.text !== "[") continue;
    const table = resolveTable(sig[i].text);
    if (!table) continue;
    const idxTok = sig[i + 2];
    if (idxTok?.kind !== "number" || sig[i + 3]?.text !== "]") continue;
    const idx = Number(idxTok.text.replaceAll("_", ""));
    if (!Number.isInteger(idx) || idx < 1) continue;
    const value = table.get(idx);
    if (!value) continue;
    edits.push({ start: sig[i].start, end: sig[i + 3].end, text: value.text });
  }

  if (!edits.length) return { result: src, changed: 0, notes: [] };
  return {
    result: applyEdits(src, edits),
    changed: edits.length,
    notes: [`Inlined ${edits.length} static table lookup(s).`],
  };
}

/**
 * Inline the common WeAreDevs-style numeric string-table accessor without
 * executing Lua. Typical shape:
 *   local O = {"foo", "bar", ...}
 *   local function B(x) return O[x + 44603] end
 *   print(B(-44602), B(-44601))
 *
 * The large offset is an obfuscation artifact; when the table is immutable
 * and every lookup is a literal integer, the mapping can be recovered
 * deterministically. This deliberately refuses dynamic indices, mutations,
 * nested expressions, or ambiguous function bodies.
 */
export function inlineOffsetTableLookups(src: string): StaticResolveResult {
  const sig = sigTokens(src);
  const tables = new Map<string, Map<number, Scalar>>();
  const declCount = new Map<string, number>();
  const assignments = new Map<string, number>();
  const accessors = new Map<string, { table: string; param: string; offset: number; start: number; end: number }>();

  for (let i = 0; i < sig.length; i++) {
    if (sig[i].text !== "local" || sig[i + 1]?.kind !== "identifier" || sig[i + 2]?.text !== "=") continue;
    const name = sig[i + 1].text;
    declCount.set(name, (declCount.get(name) ?? 0) + 1);
    if (sig[i + 3]?.text !== "{") continue;
    let j = i + 4, idx = 1;
    const values = new Map<number, Scalar>();
    let ok = true;
    while (j < sig.length && sig[j].text !== "}") {
      const lit = scalar(sig[j]);
      if (!lit) { ok = false; break; }
      values.set(idx++, lit);
      j++;
      if (sig[j]?.text === "," || sig[j]?.text === ";") j++;
      else if (sig[j]?.text !== "}") { ok = false; break; }
    }
    if (ok && sig[j]?.text === "}" && values.size > 0) tables.set(name, values);
  }

  for (let i = 0; i < sig.length; i++) {
    if (sig[i].kind !== "identifier") continue;
    const prev = sig[i - 1], next = sig[i + 1];
    if (next?.text === "=" && prev?.text !== "local") {
      assignments.set(sig[i].text, (assignments.get(sig[i].text) ?? 0) + 1);
    }
  }
  for (const [name] of tables) {
    if ((declCount.get(name) ?? 0) !== 1 || (assignments.get(name) ?? 0) > 0) tables.delete(name);
  }

  // Parse a tiny accessor:
  //   local function B(x) return O[x + (421764 + -377161)] end
  // Arithmetic noise is evaluated with the engine's safe constant evaluator.
  for (let i = 0; i + 7 < sig.length; i++) {
    if (sig[i].text !== "local" || sig[i + 1]?.text !== "function" || sig[i + 2]?.kind !== "identifier") continue;
    const fn = sig[i + 2].text;
    if (sig[i + 3]?.text !== "(" || sig[i + 4]?.kind !== "identifier" || sig[i + 5]?.text !== ")") continue;
    const param = sig[i + 4].text;
    if (sig[i + 6]?.text !== "return" || sig[i + 7]?.kind !== "identifier" || sig[i + 8]?.text !== "[") continue;
    const table = sig[i + 7].text;
    if (!tables.has(table)) continue;

    let j = i + 9;
    let depth = 0;
    let closeBracket = -1;
    for (; j < sig.length; j++) {
      if (sig[j].text === "(") depth++;
      else if (sig[j].text === ")" && depth > 0) depth--;
      else if (sig[j].text === "]" && depth === 0) { closeBracket = j; break; }
    }
    if (closeBracket < 0 || sig[closeBracket + 1]?.text !== "end") continue;
    const expr = sig.slice(i + 9, closeBracket);
    if (!expr.some((t) => t.text === param)) continue;

    // Only accept exactly `param +/- constant` or `constant + param`; the
    // constant part may itself contain nested arithmetic, e.g. `(421764+-377161)`.
    let p = -1;
    expr.forEach((t, k) => { if (p < 0 && t.kind === "identifier" && t.text === param) p = k; });
    if (p < 0) continue;
    const left = expr.slice(0, p);
    const right = expr.slice(p + 1);
    let offset: number | null = null;
    if (left.length === 0 && (right[0]?.text === "+" || right[0]?.text === "-")) {
      const n = constNumber(right.slice(1));
      if (n !== null) offset = right[0].text === "+" ? n : -n;
    } else if (right.length === 0 && (left[left.length - 1]?.text === "+" || left[left.length - 1]?.text === "-")) {
      const op = left[left.length - 1].text;
      const n = constNumber(left.slice(0, -1));
      if (n !== null) offset = op === "+" ? n : -n;
    }
    if (offset === null) continue;
    accessors.set(fn, { table, param, offset, start: sig[i].start, end: sig[closeBracket + 1].end });
  }

  if (!accessors.size) return { result: src, changed: 0, notes: [] };
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let decoded = 0;
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    if (t.kind !== "identifier") continue;
    const acc = accessors.get(t.text);
    if (!acc || sig[i + 1]?.text !== "(") continue;
    if (t.start >= acc.start && t.start < acc.end) continue;
    const close = findMatchingSig(sig, i + 1, "(", ")");
    if (close < 0) continue;
    const args = splitSigArgs(sig.slice(i + 2, close));
    if (args.length !== 1) continue;
    const argValue = constNumber(args[0]);
    if (argValue === null) continue;
    const index = argValue + acc.offset;
    if (!Number.isInteger(index) || index < 1) continue;
    const table = tables.get(acc.table);
    const value = table?.get(index);
    if (!value) continue;
    edits.push({ start: t.start, end: sig[close].end, text: value.text });
    decoded++;
    i = close;
  }
  if (!edits.length) return { result: src, changed: 0, notes: [] };
  return {
    result: applyEdits(src, edits),
    changed: decoded,
    notes: [`Inlined ${decoded} literal numeric lookup(s) from immutable offset string table(s), including arithmetic-noise offsets.`],
  };
}

/**
 * Decode base64-looking literals inside a dense immutable string table.
 *
 * Corpus motivation: Prometheus samples commonly put many encoded fragments
 * in one local string table rather than storing a single complete source
 * payload. The older generic base64 pass only accepted a literal when its
 * decoded value looked like an entire Lua program, so short identifiers,
 * property names and keywords inside such tables were left untouched.
 *
 * Safety constraints are deliberately strict:
 *   - only `local name = { "...", "...", ... }` tables are considered;
 *   - at least 8 entries and at least 75% must be base64-shaped strings;
 *   - decoded text must be printable and Lua-ish;
 *   - no dynamic evaluation or execution is performed.
 */
export function foldEncodedStringTableLiterals(src: string): StaticResolveResult {
  const sig = sigTokens(src);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let changed = 0;
  let tablesTouched = 0;

  const luaish = (s: string): boolean => {
    if (!s || s.length > 512) return false;
    if (!looksPrintable(s)) return false;
    return /[A-Za-z_]/.test(s) || /[.:()[\]{}=,+\-*/%<>]/.test(s);
  };

  for (let i = 0; i + 4 < sig.length; i++) {
    if (sig[i].text !== "local" || sig[i + 1]?.kind !== "identifier" || sig[i + 2]?.text !== "=" || sig[i + 3]?.text !== "{") continue;
    const open = i + 3;
    let depth = 1;
    let close = -1;
    for (let j = open + 1; j < sig.length; j++) {
      if (sig[j].text === "{") depth++;
      else if (sig[j].text === "}") {
        depth--;
        if (depth === 0) { close = j; break; }
      }
    }
    if (close < 0) continue;

    const entries: LuaToken[] = [];
    let okShape = true;
    let expectValue = true;
    for (let j = open + 1; j < close; j++) {
      const t = sig[j];
      if (t.text === "," || t.text === ";") { expectValue = true; continue; }
      if (t.text === "[") { okShape = false; break; }
      if (!expectValue) { okShape = false; break; }
      if (t.kind !== "string" && t.kind !== "longstring") { okShape = false; break; }
      entries.push(t);
      expectValue = false;
    }
    if (!okShape || entries.length < 8) continue;

    const candidateEntries = entries.map((t) => {
      const raw = t.value ?? "";
      const b64ish = raw.length >= 8 && raw.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(raw);
      const decoded = b64ish ? tryBase64Decode(raw) : null;
      return { t, raw, decoded, good: !!decoded && decoded !== raw && luaish(decoded) };
    });
    const b64Count = candidateEntries.filter((x) => x.raw.length >= 8 && /^[A-Za-z0-9+/=]+$/.test(x.raw)).length;
    const goodCount = candidateEntries.filter((x) => x.good).length;
    if (b64Count / entries.length < 0.75 || goodCount < Math.ceil(entries.length * 0.5)) continue;

    let touchedHere = 0;
    for (const item of candidateEntries) {
      if (!item.good || item.decoded == null) continue;
      edits.push({ start: item.t.start, end: item.t.end, text: reencodeLuaString(item.decoded, '"') });
      changed++;
      touchedHere++;
    }
    if (touchedHere) tablesTouched++;
    i = close;
  }

  if (!edits.length) return { result: src, changed: 0, notes: [] };
  return {
    result: applyEdits(src, edits),
    changed,
    notes: [`Decoded ${changed} literal(s) across ${tablesTouched} dense base64 string table(s).`],
  };
}

function looksPrintable(s: string): boolean {
  for (const ch of s) {
    const n = ch.charCodeAt(0);
    if (n === 9 || n === 10 || n === 13) continue;
    if (n < 32 || n > 126) return false;
  }
  return true;
}

/**
 * Inline a second WeAreDevs pattern identified from VM-oriented samples:
 * a tiny accessor returns CACHE[key], while the key is a large numeric
 * constant. The binary string argument is only a decoy and is intentionally
 * ignored. We only use literal cache writes/reads, never evaluate the VM.
 *
 * Supported shape:
 *   local C = {}
 *   C[1234567890123] = "GetService"
 *   local function D(a, k) return C[k] end
 *   local x = D("\\129...", 1234567890123)
 */
export function inlineNumericCacheAccessors(src: string): StaticResolveResult {
  const sig = sigTokens(src);
  const caches = new Set<string>();
  const values = new Map<string, Scalar>();
  const accessors = new Map<string, { cache: string; keyParam: string; start: number; end: number }>();

  for (let i = 0; i + 3 < sig.length; i++) {
    if (sig[i].text === "local" && sig[i + 1]?.kind === "identifier" && sig[i + 2]?.text === "=" && sig[i + 3]?.text === "{") {
      caches.add(sig[i + 1].text);
    }
  }
  if (!caches.size) return { result: src, changed: 0, notes: [] };

  // Literal cache assignments: C[123...] = "value". The key may itself
  // contain arithmetic noise, e.g. C[-687327 + 32358950746043] = "x".
  for (let i = 0; i + 5 < sig.length; i++) {
    if (sig[i].kind !== "identifier" || !caches.has(sig[i].text) || sig[i + 1]?.text !== "[") continue;
    let close = i + 2;
    let depth = 0;
    for (; close < sig.length; close++) {
      if (sig[close].text === "(") depth++;
      else if (sig[close].text === ")" && depth > 0) depth--;
      else if (sig[close].text === "]" && depth === 0) break;
    }
    if (sig[close]?.text !== "]" || sig[close + 1]?.text !== "=") continue;
    const val = scalar(sig[close + 2]);
    if (!val) continue;
    const k = constNumber(sig.slice(i + 2, close));
    if (k !== null) values.set(`${sig[i].text}:${k}`, val);
  }

  // `local function F(a,b) return C[b] end`.
  for (let i = 0; i + 10 < sig.length; i++) {
    if (sig[i].text !== "local" || sig[i + 1]?.text !== "function" || sig[i + 2]?.kind !== "identifier") continue;
    const fn = sig[i + 2].text;
    if (sig[i + 3]?.text !== "(" || sig[i + 4]?.kind !== "identifier" || sig[i + 5]?.text !== "," || sig[i + 6]?.kind !== "identifier" || sig[i + 7]?.text !== ")") continue;
    const keyParam = sig[i + 6].text;
    if (sig[i + 8]?.text !== "return" || sig[i + 9]?.kind !== "identifier" || sig[i + 10]?.text !== "[") continue;
    const cache = sig[i + 9].text;
    if (!caches.has(cache) || sig[i + 11]?.kind !== "identifier" || sig[i + 11].text !== keyParam || sig[i + 12]?.text !== "]" || sig[i + 13]?.text !== "end") continue;
    accessors.set(fn, { cache, keyParam, start: sig[i].start, end: sig[i + 13].end });
  }
  if (!accessors.size || !values.size) return { result: src, changed: 0, notes: [] };

  const edits: Array<{ start: number; end: number; text: string }> = [];
  let decoded = 0;
  for (let i = 0; i + 4 < sig.length; i++) {
    const t = sig[i];
    if (t.kind !== "identifier") continue;
    const acc = accessors.get(t.text);
    if (!acc || sig[i + 1]?.text !== "(") continue;
    if (t.start >= acc.start && t.start < acc.end) continue;
    const close = findMatchingSig(sig, i + 1, "(", ")");
    if (close < 0) continue;
    const args = splitSigArgs(sig.slice(i + 2, close));
    if (args.length !== 2) continue;
    const key = constNumber(args[1]);
    if (key === null) continue;
    const value = values.get(`${acc.cache}:${key}`);
    if (!value) continue;
    edits.push({ start: t.start, end: sig[close].end, text: value.text });
    decoded++;
    i = close;
  }
  if (!edits.length) return { result: src, changed: 0, notes: [] };
  return { result: applyEdits(src, edits), changed: decoded, notes: [`Inlined ${decoded} literal VM-cache accessor call(s) keyed by numeric constants.`] };
}

/** Normalize local aliases of standard pure functions before constant-folding. */
export function normalizeStdlibAliases(src: string): StaticResolveResult {
  const sig = sigTokens(src);
  const raw = new Map<string, string>();
  const counts = new Map<string, number>();
  const allowedBase = new Set(["string", "math", "table", "bit32", "bit", "tonumber", "tostring"]);
  const allowedMembers = new Set([
    "string.char", "string.byte", "string.sub", "string.rep", "string.reverse", "string.lower", "string.upper", "string.len",
    "math.floor", "math.ceil", "math.abs", "math.max", "math.min", "table.concat", "table.insert",
    "bit32.bxor", "bit32.band", "bit32.bor", "bit32.bnot", "bit32.lshift", "bit32.rshift",
    "bit.bxor", "bit.band", "bit.bor", "bit.bnot", "bit.lshift", "bit.rshift", "tonumber", "tostring",
  ]);
  for (let i = 0; i + 3 < sig.length; i++) {
    if (sig[i].text !== "local" || sig[i + 1]?.kind !== "identifier" || sig[i + 2]?.text !== "=") continue;
    const alias = sig[i + 1].text;
    const a = sig[i + 3];
    let target: string | null = null;
    if (a?.kind === "identifier" && sig[i + 4]?.text === "." && sig[i + 5]?.kind === "identifier") {
      target = `${a.text}.${sig[i + 5].text}`;
    } else if (a?.kind === "identifier" && sig[i + 4]?.text === "[" && (sig[i + 5]?.kind === "string" || sig[i + 5]?.kind === "longstring") && sig[i + 6]?.text === "]") {
      target = `${a.text}.${String(sig[i + 5].value ?? "")}`;
    } else if (a?.kind === "identifier") {
      target = a.text;
    }
    if (!target) continue;
    // `bit32 or bit` style fallback is represented as a normal identifier in
    // many minifiers; only record an explicit member or known global root.
    if (allowedBase.has(target) || allowedMembers.has(target) || /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?$/.test(target)) {
      raw.set(alias, target);
      counts.set(alias, (counts.get(alias) ?? 0) + 1);
    }
  }
  const resolve = (name: string, seen = new Set<string>(), depth = 0): string | null => {
    if (depth > 12 || seen.has(name)) return null;
    const target = raw.get(name);
    if (!target) return null;
    if (allowedMembers.has(target) || allowedBase.has(target)) return target;
    if (target.includes(".")) {
      const dot = target.indexOf(".");
      const base = target.slice(0, dot);
      const member = target.slice(dot + 1);
      const rb = allowedBase.has(base) ? base : resolve(base, new Set([...seen, name]), depth + 1);
      const combined = rb ? `${rb}.${member}` : null;
      return combined && allowedMembers.has(combined) ? combined : null;
    }
    return resolve(target, new Set([...seen, name]), depth + 1);
  };
  const aliases = new Map<string, string>();
  for (const name of raw.keys()) {
    const r = resolve(name);
    if (r && (counts.get(name) ?? 0) === 1) aliases.set(name, r);
  }
  if (!aliases.size) return { result: src, changed: 0, notes: [] };
  const edits: Array<{ start: number; end: number; text: string }> = [];
  // Canonicalise immutable alias declarations too. This makes multi-hop chains
  // converge visibly (e.g. `local c=b` -> `local c=bit32`) before call sites
  // are rewritten. Reassignable locals are left untouched.
  for (let i = 0; i + 3 < sig.length; i++) {
    if (sig[i].text !== "local" || sig[i + 1]?.kind !== "identifier" || sig[i + 2]?.text !== "=") continue;
    const name = sig[i + 1].text;
    const target = aliases.get(name);
    if (!target) continue;
    let rhsEnd = i + 4;
    if (sig[i + 4]?.text === "." && sig[i + 5]?.kind === "identifier") rhsEnd = i + 6;
    else if (sig[i + 4]?.text === "[" && sig[i + 6]?.text === "]") rhsEnd = i + 7;
    const laterWrite = sig.slice(rhsEnd).some((t, k) => t.kind === "identifier" && t.text === name && sig[rhsEnd + k + 1]?.text === "=");
    const original = src.slice(sig[i + 3].start, sig[rhsEnd - 1].end);
    if (!laterWrite && original !== target) edits.push({ start: sig[i + 3].start, end: sig[rhsEnd - 1].end, text: target });
  }
  for (let i = 0; i + 1 < sig.length; i++) {
    const t = sig[i];
    if (t.kind !== "identifier") continue;
    const target = aliases.get(t.text);
    if (!target || sig[i + 1]?.text !== "(") continue;
    if (sig[i - 1]?.text === "local") continue;
    edits.push({ start: t.start, end: t.end, text: target });
  }
  return edits.length ? { result: applyEdits(src, edits), changed: edits.length, notes: [`Expanded/canonicalized ${edits.length} standard-library alias reference(s).`] } : { result: src, changed: 0, notes: [] };
}

/**
 * Resolve pure stdlib members hidden behind a getfenv() table lookup.
 * Typical shape: env["string"]["\\099\\104\\097\\114"] -> string.char.
 * This is token-based and never executes input code.
 */
export function normalizeEnvStdlibAliases(src: string): StaticResolveResult {
  const sig = sigTokens(src);
  const envs = new Set<string>();
  const aliases = new Map<string, string>();
  const declCount = new Map<string, number>();
  const allowed = new Set([
    "string.char", "string.byte", "string.sub", "string.rep", "string.reverse",
    "string.lower", "string.upper", "string.len", "math.floor", "math.ceil",
    "math.abs", "math.max", "math.min", "table.concat", "table.insert",
    "bit32", "bit",
    "bit32.bxor", "bit32.band", "bit32.bor", "bit32.bnot", "bit32.lshift", "bit32.rshift",
    "tonumber", "tostring",
  ]);
  const str = (t: LuaToken | undefined) =>
    t && (t.kind === "string" || t.kind === "longstring") ? (t.value ?? null) : null;

  for (let i = 0; i + 4 < sig.length; i++) {
    if (sig[i].text !== "local" || sig[i + 1]?.kind !== "identifier" || sig[i + 2]?.text !== "=") continue;
    const name = sig[i + 1].text;
    const rhs = sig[i + 3];

    if (rhs?.kind === "identifier" && rhs.text === "getfenv" && sig[i + 4]?.text === "(") {
      let j = i + 5, depth = 1;
      while (j < sig.length && depth > 0) {
        if (sig[j].text === "(") depth++;
        else if (sig[j].text === ")") depth--;
        j++;
      }
      if (depth === 0) envs.add(name);
      continue;
    }

    if (!envs.has(rhs?.text ?? "") || sig[i + 4]?.text !== "[") continue;
    if (str(sig[i + 5]) !== "string") continue;
    if (sig[i + 6]?.text !== "]" || sig[i + 7]?.text !== "[") continue;
    const member = str(sig[i + 8]);
    if (!member || sig[i + 9]?.text !== "]") continue;
    const target = `string.${member}`;
    if (!allowed.has(target)) continue;
    declCount.set(name, (declCount.get(name) ?? 0) + 1);
    aliases.set(name, target);
  }

  for (const [name, count] of declCount) if (count !== 1) aliases.delete(name);
  if (!aliases.size) return { result: src, changed: 0, notes: [] };

  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (let i = 0; i + 1 < sig.length; i++) {
    const t = sig[i];
    const target = t.kind === "identifier" ? aliases.get(t.text) : undefined;
    if (!target || sig[i + 1]?.text !== "(") continue;
    edits.push({ start: t.start, end: t.end, text: target });
  }
  if (!edits.length) return { result: src, changed: 0, notes: [] };
  return {
    result: applyEdits(src, edits),
    changed: edits.length,
    notes: [`Expanded ${edits.length} getfenv-indexed stdlib alias call(s).`],
  };
}


/**
 * Decode the small, purely-static XOR string decoder emitted by several
 * LuaObfuscator-style samples.  We only accept a very specific loop shape:
 * a bounded `for i=1,#data`, `string.byte(string.sub(...))`, `bit32.bxor`,
 * `string.char`, `table.insert`, and a final `table.concat`.  Calls are
 * folded only when both arguments are literal strings, so this pass never
 * executes arbitrary Lua.
 */
export function foldSimpleXorDecoderFunctions(src: string): StaticResolveResult {
  const sig = sigTokens(src);
  const functions: Array<{ name: string; start: number; end: number; params: string[]; body: string }> = [];

  for (let i = 0; i + 4 < sig.length; i++) {
    // local function name(a,b) ... end
    if (sig[i].text !== "local" || sig[i + 1]?.text !== "function" || sig[i + 2]?.kind !== "identifier") continue;
    const name = sig[i + 2].text;
    if (sig[i + 3]?.text !== "(") continue;
    const closeParen = findMatchingSig(sig, i + 3, "(", ")");
    if (closeParen < 0) continue;
    const params: string[] = [];
    for (let j = i + 4; j < closeParen; j++) {
      if (sig[j].kind === "identifier") params.push(sig[j].text);
    }
    if (params.length !== 2) continue;

    let depth = 1;
    let j = closeParen + 1;
    for (; j < sig.length; j++) {
      const t = sig[j].text;
      if (t === "function" || t === "if" || t === "for" || t === "while" || t === "repeat") depth++;
      else if (t === "end") {
        depth--;
        if (depth === 0) break;
      } else if (t === "until") {
        depth--;
      }
    }
    if (j >= sig.length || depth !== 0) continue;
    functions.push({
      name,
      start: sig[i].start,
      end: sig[j].end,
      params,
      body: src.slice(sig[closeParen].end, sig[j].start),
    });
  }

  if (!functions.length) return { result: src, changed: 0, notes: [] };

  const edits: Array<{ start: number; end: number; text: string }> = [];
  let decoded = 0;
  const notes: string[] = [];

  for (const fn of functions) {
    const body = fn.body.replace(/[\r\n\t ]+/g, "");
    const [dataParam, keyParam] = fn.params;

    // Locate the loop/index/output variables.
    const loop = body.match(new RegExp(`for([A-Za-z_][A-Za-z0-9_]*)=(?:1|3-2|2-1),#${escapeRegExp(dataParam)}do`));
    if (!loop) continue;
    const indexVar = loop[1];
    const insert = body.match(new RegExp(`table\\.insert\\(([A-Za-z_][A-Za-z0-9_]*),string\\.char\\(bit32\\.bxor\\(string\\.byte\\(string\\.sub\\(${escapeRegExp(dataParam)},${escapeRegExp(indexVar)},${escapeRegExp(indexVar)}\\+1\\)\\),string\\.byte\\(string\\.sub\\(${escapeRegExp(keyParam)},(.+?),(.+?)\\)\\)\\)(?:%[^)]*)?`));
    if (!insert) continue;
    const outVar = insert[1];
    const keyIndexExpr = insert[2];

    // Require the canonical `1+(i%#key)` key schedule used by the sample
    // family; accept harmless parenthesisation/spacing after normalization.
    const canonicalKey = `1+(${indexVar}%#${keyParam})`;
    const canonicalKey2 = `1+${indexVar}%#${keyParam}`;
    if (keyIndexExpr !== canonicalKey && keyIndexExpr !== canonicalKey2) continue;
    if (!new RegExp(`returntable\\.concat\\(${escapeRegExp(outVar)}\\)`).test(body)) continue;

    // Find calls to the decoder outside its own declaration. Token scanning
    // avoids matching the helper name inside strings/comments and keeps this
    // pass linear in the source size.
    for (let ti = 0; ti + 1 < sig.length; ti++) {
      if (sig[ti].kind !== "identifier" || sig[ti].text !== fn.name || sig[ti + 1].text !== "(") continue;
      const callStart = sig[ti].start;
      if (callStart >= fn.start && callStart < fn.end) continue;
      const closeIdx = findMatchingSig(sig, ti + 1, "(", ")");
      if (closeIdx < 0) continue;
      const close = sig[closeIdx].end;
      const argsText = src.slice(sig[ti + 1].end, sig[closeIdx].start);
      const argToks = sigTokens(argsText);
      const groups = splitSigArgs(argToks);
      if (groups.length !== 2) continue;
      const a = decodeLiteralToken(groups[0]);
      const b = decodeLiteralToken(groups[1]);
      if (a === null || b === null || b.length === 0) continue;

      let out = "";
      for (let pos = 1; pos <= a.length; pos++) {
        const kb = b.charCodeAt(pos % b.length);
        out += String.fromCharCode((a.charCodeAt(pos - 1) ^ kb) & 0xff);
      }
      edits.push({ start: callStart, end: close, text: reencodeLuaString(out, '"') });
      decoded++;
      ti = closeIdx;
    }
  }

  if (!edits.length) return { result: src, changed: 0, notes: [] };
  notes.push(`Decoded ${decoded} literal call(s) to static XOR string decoder(s).`);
  return { result: applyEdits(src, edits), changed: decoded, notes };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
}

function findMatchingSig(tokens: LuaToken[], open: number, left: string, right: string): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].text === left) depth++;
    else if (tokens[i].text === right) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}



function splitSigArgs(tokens: LuaToken[]): LuaToken[][] {
  const groups: LuaToken[][] = [];
  let cur: LuaToken[] = [];
  let depth = 0;
  for (const t of tokens) {
    if (t.text === "(" || t.text === "{" || t.text === "[") depth++;
    else if (t.text === ")" || t.text === "}" || t.text === "]") depth--;
    if (depth === 0 && t.text === ",") {
      groups.push(cur); cur = []; continue;
    }
    cur.push(t);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function decodeLiteralToken(tokens: LuaToken[]): string | null {
  const t = tokens.find((x) => !trivia(x));
  if (!t || t.kind !== "string" && t.kind !== "longstring") return null;
  return t.value ?? null;
}

/**
 * Recover direct embedded source wrappers such as
 *   return loadstring("print('hello')")()
 * only when the decoded argument is already syntactically Lua-like.
 * The original wrapper is kept in notes; caller may choose to use the
 * returned source because this pass is intended for deobfuscation output.
 */
export function unwrapLiteralLoadstring(src: string): StaticResolveResult {
  const trimmed = src.trim();
  const m = trimmed.match(/^(?:return\s+)?loadstring\(\s*([\"\'](?:.|[\r\n])*?)\s*\)\s*\(\s*\)\s*;?$/s);
  if (!m) return { result: src, changed: 0, notes: [] };

  const argText = m[1];
  const toks = sigTokens(`loadstring(${argText})`);
  const arg = toks[2];
  if (arg?.kind !== "string" && arg?.kind !== "longstring") {
    return { result: src, changed: 0, notes: [] };
  }
  const value = arg.value ?? "";
  if (value.length < 8) return { result: src, changed: 0, notes: [] };
  if (!/(?:\blocal\b|\bfunction\b|\breturn\b|\bgame\b|\bworkspace\b|\bscript\b|\bprint\b)/.test(value)) {
    return { result: src, changed: 0, notes: [] };
  }

  return {
    result: value + (value.endsWith("\n") ? "" : "\n"),
    changed: 1,
    notes: ["Unwrapped top-level literal loadstring wrapper."],
  };
}
