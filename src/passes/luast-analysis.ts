import { LuaToken, tokenize } from "../utils/lua-utils";

export interface LuastAnalysisResult {
  result: string;
  changed: number;
  notes: string[];
  callableNames: string[];
  dispatcherNames: string[];
}

type Edit = { start: number; end: number; text: string };

function significant(src: string): LuaToken[] {
  return [...tokenize(src)].filter((t) =>
    t.kind !== "whitespace" && t.kind !== "newline" && t.kind !== "comment" &&
    t.kind !== "longcomment" && t.kind !== "eof"
  );
}

function numberKey(token: LuaToken | undefined): number | null {
  if (!token || token.kind !== "number") return null;
  const value = Number(token.text.replaceAll("_", ""));
  return Number.isSafeInteger(value) ? value : null;
}

function applyEdits(src: string, edits: Edit[]): string {
  const out: string[] = [];
  let cursor = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (edit.start < cursor) continue;
    out.push(src.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  out.push(src.slice(cursor));
  return out.join("");
}

/**
 * Recover facts that are specific to Luast's split object-pool layout.
 * This pass deliberately emits no function literals and never evaluates
 * unknown expressions. Its first job is to prevent later generic passes from
 * treating `T[128] = nil` as the actual pool value.
 */
export function analyzeLuastSource(src: string): LuastAnalysisResult {
  const sig = significant(src);
  const poolBases = new Set<string>();
  const poolEntries = new Map<string, Set<number>>();
  const callable = new Set<string>();
  const dispatcher = new Set<string>();
  const aliases = new Map<string, string>();
  const edits: Edit[] = [];

  for (let i = 0; i + 5 < sig.length; i++) {
    if (sig[i].kind !== "identifier" || sig[i + 1]?.text !== "[" ||
        sig[i + 3]?.text !== "]" || sig[i + 4]?.text !== "=" ) continue;
    const base = sig[i].text;
    const key = numberKey(sig[i + 2]);
    if (key === null) continue;
    const rhs = sig[i + 5];
    if (rhs?.text === "{") {
      poolBases.add(base);
      let keys = poolEntries.get(base);
      if (!keys) { keys = new Set(); poolEntries.set(base, keys); }
      keys.add(key);
    }
  }

  // A real table literal wins over Luast's nil predeclarations. Remove only
  // those exact nil statements, preserving all other source and mutations.
  for (let i = 0; i + 5 < sig.length; i++) {
    if (sig[i].kind !== "identifier" || sig[i + 1]?.text !== "[" ||
        sig[i + 3]?.text !== "]" || sig[i + 4]?.text !== "=" || sig[i + 5]?.text !== "nil") continue;
    const base = sig[i].text;
    const key = numberKey(sig[i + 2]);
    if (key === null || !poolEntries.get(base)?.has(key)) continue;
    edits.push({ start: sig[i].start, end: sig[i + 5].end, text: "" });
  }

  // Direct callable evidence. This is role inference only; it does not rename
  // names or replace calls.
  for (let i = 0; i + 1 < sig.length; i++) {
    if (sig[i].kind !== "identifier" || sig[i + 1].text !== "(") continue;
    const name = sig[i].text;
    if (name !== "if" && name !== "for" && name !== "while" && name !== "function") callable.add(name);
  }
  for (let i = 0; i + 3 < sig.length; i++) {
    if ((sig[i].text === "pcall" || sig[i].text === "xpcall") && sig[i + 2]?.kind === "identifier") {
      callable.add(sig[i + 2].text);
    }
  }

  // Propagate simple aliases to a fixed point, including aliases through the
  // recovered pool base. This remains conservative for dynamic table keys.
  for (let i = 0; i + 3 < sig.length; i++) {
    if (sig[i].text !== "local" || sig[i + 1]?.kind !== "identifier" || sig[i + 2]?.text !== "=" || sig[i + 3]?.kind !== "identifier") continue;
    aliases.set(sig[i + 1].text, sig[i + 3].text);
  }
  for (let round = 0; round < sig.length; round++) {
    let changed = false;
    for (const [alias, target] of aliases) {
      if (callable.has(target) && !callable.has(alias)) { callable.add(alias); changed = true; }
    }
    if (!changed) break;
  }

  // Dispatcher evidence is intentionally numeric and self-referential. A
  // variable with this shape must never be inferred as a function by name.
  for (let i = 0; i + 4 < sig.length; i++) {
    if (sig[i].kind !== "identifier" || sig[i + 1]?.text !== "=" ||
        sig[i + 2]?.kind !== "number" || sig[i + 3]?.text !== "-" ||
        sig[i + 4]?.kind !== "identifier" || sig[i + 4].text !== sig[i].text) continue;
    dispatcher.add(sig[i].text);
  }
  for (const name of dispatcher) callable.delete(name);

  const result = edits.length ? applyEdits(src, edits) : src;
  const notes: string[] = [];
  if (edits.length) notes.push(`Removed ${edits.length} Luast nil pool predeclaration(s) shadowed by literal pool data.`);
  if (poolBases.size) notes.push(`Recognized ${poolBases.size} Luast object-pool base(s).`);
  if (callable.size) notes.push(`Inferred ${callable.size} callable alias/name candidate(s) from call sites.`);
  if (dispatcher.size) notes.push(`Protected ${dispatcher.size} numeric dispatcher variable(s) from function inference.`);
  return { result, changed: edits.length, notes, callableNames: [...callable], dispatcherNames: [...dispatcher] };
}

/** Report suspicious rewrites without modifying source or changing semantics. */
export function rejectLuastBadRewrites(src: string): LuastAnalysisResult {
  const suspicious = /\b(?:nil|string|number)\s*\[[^\]]+\]|\b(?:nil|string|number)\s*\([^)]*\)|(?:\b\d+(?:\.\d+)?|\b0\.\d+)\s*\[[^\]]+\]|"(?:[^"\\]|\\.)*"\s*[*/%-]\s*(?:[A-Za-z_]\w*|\d)/g;
  const count = [...src.matchAll(suspicious)].length;
  if (!count) return { result: src, changed: 0, notes: [], callableNames: [], dispatcherNames: [] };
  return { result: src, changed: 0, notes: [`Detected ${count} suspicious Luast rewrite(s); source left unchanged for rollback safety.`], callableNames: [], dispatcherNames: [] };
}