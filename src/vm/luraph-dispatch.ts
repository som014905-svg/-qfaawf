// Luraph VM dispatch-tree parser.
//
// Luraph v14.6+ "VM mode" loaders embed an interpreter whose main loop looks
// like:
//
//     while true do local i=(Z[F]); if not(i>=104)then if i>=52 then ... end
//
// where `i` is the fetched opcode, `Z` the opcode column and `F` the virtual
// instruction pointer. The nested if-tree partitions the opcode space; its
// leaves are the handlers. This module locates the fetch site in the raw
// (still-obfuscated) loader source, parses the if-tree and returns a
// opcode → handler-source map, plus a best-effort semantic name per opcode.
//
// All parsing is token-level with proper string/comment skipping so minified
// payload blobs cannot confuse the keyword scanner.

/** Parsed numeric literal (0x/0b/decimal, Luau underscore separators). */
export function parseLuauNumber(text: string): number | null {
  const t = text.replace(/_/g, "");
  if (/^0[xX][0-9a-fA-F]+$/.test(t)) return parseInt(t.slice(2), 16);
  if (/^0[bB][01]+$/.test(t)) return parseInt(t.slice(2), 2);
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return null;
}

export interface FetchSite {
  /** Variable holding the fetched opcode (e.g. `i`). */
  opVar: string;
  /** Opcode column name (e.g. `Z`). */
  opCol: string;
  /** Virtual instruction pointer variable (e.g. `F`). */
  vipVar: string;
  /** Index just after the fetch statement. */
  after: number;
}

/** Locate the interpreter's instruction fetch: `while true do local i=(Z[F]);`. */
export function findInstructionFetch(src: string): FetchSite | null {
  const re = /while true do local (\w+)\s*=\s*\(?\s*(\w+)\s*\[\s*(\w+)\s*\]\s*\)?\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const [full, opVar, opCol, vipVar] = m;
    // The dispatch tree must start right after with a condition on the opVar.
    const rest = src.slice(m.index + full.length, m.index + full.length + 120);
    if (new RegExp(`^\\s*if\\s+(?:not\\s*\\(?\\s*)?${opVar}\\s*(>=|<|==|~=)`).test(rest)) {
      return { opVar, opCol, vipVar, after: m.index + full.length };
    }
    if (new RegExp(`^\\s*if\\s+not?\\s*\\(?\\s*${opVar}\\s*(>=|<|==|~=)`).test(rest)) {
      return { opVar, opCol, vipVar, after: m.index + full.length };
    }
  }
  // Relaxed: any `local X=(Y[Z]);` followed by an if on X.
  const re2 = /local (\w+)\s*=\s*\(\s*(\w+)\s*\[\s*(\w+)\s*\]\s*\)\s*;/g;
  while ((m = re2.exec(src)) !== null) {
    const [full, opVar, opCol, vipVar] = m;
    const rest = src.slice(m.index + full.length, m.index + full.length + 80);
    if (new RegExp(`^\\s*if\\s+(not\\s*\\(?\\s*${opVar}|${opVar})\\s*(>=|<|==|~=`).test(rest)) {
      return { opVar, opCol, vipVar, after: m.index + full.length };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token-level block scanner (skips strings & comments)
// ─────────────────────────────────────────────────────────────────────────────

const KEYWORDS = new Set([
  "if",
  "then",
  "elseif",
  "else",
  "end",
  "while",
  "for",
  "do",
  "function",
  "repeat",
  "until",
  "return",
  "local",
  "break",
  "continue",
]);

interface Tok {
  kind: "word" | "keyword" | "punct" | "str";
  text: string;
  pos: number;
}

/** Tokenize Lua source, keeping identifiers/keywords, skipping string and
 * comment contents (kept as single `str` tokens so they cannot be mistaken
 * for keywords). */
export function tokenizeLua(src: string, start = 0, end = src.length): Tok[] {
  const toks: Tok[] = [];
  let i = start;
  const push = (kind: Tok["kind"], text: string, pos: number): void => {
    toks.push({ kind, text, pos });
  };
  while (i < end) {
    const c = src[i];
    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    // comments
    if (c === "-" && src[i + 1] === "-") {
      if (src[i + 2] === "[") {
        const eq = /^-(\s*)\[=*\[/.exec(src.slice(i));
        if (eq) {
          const level = (eq[0].match(/=/g) ?? []).length;
          const close = "]" + "=".repeat(level) + "]";
          const j = src.indexOf(close, i + eq[0].length);
          i = j < 0 ? end : j + close.length;
          continue;
        }
      }
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? end : nl + 1;
      continue;
    }
    // long strings
    if (c === "[") {
      const lm = /^\[=*\[/.exec(src.slice(i, i + 16));
      if (lm) {
        const level = (lm[0].match(/=/g) ?? []).length;
        const close = "]" + "=".repeat(level) + "]";
        const j = src.indexOf(close, i + lm[0].length);
        const stop = j < 0 ? end : j + close.length;
        push("str", src.slice(i, stop), i);
        i = stop;
        continue;
      }
    }
    // quoted strings
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < end) {
        if (src[j] === "\\") j += 2;
        else if (src[j] === c) {
          j++;
          break;
        } else j++;
      }
      push("str", src.slice(i, j), i);
      i = j;
      continue;
    }
    // identifiers / keywords
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < end && /[A-Za-z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      push(KEYWORDS.has(w) ? "keyword" : "word", w, i);
      i = j;
      continue;
    }
    // numbers (glue digits so `0x34` stays one token)
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < end && /[0-9a-fA-FxX_.]/.test(src[j])) j++;
      // don't swallow trailing dots that belong to method calls (rare in minified)
      while (j > i + 1 && src[j - 1] === ".") j--;
      push("punct", src.slice(i, j), i);
      i = j;
      continue;
    }
    push("punct", c, i);
    i++;
  }
  return toks;
}

// ─────────────────────────────────────────────────────────────────────────────
// If-tree parsing
// ─────────────────────────────────────────────────────────────────────────────

/** Find `then` and the matching `end` of the `if` statement starting at
 * tokIdx (which must be the `if` keyword). Returns token indices. */
function scanIf(toks: Tok[], ifIdx: number): { thenIdx: number; endIdx: number } | null {
  let thenIdx = -1;
  let depth = 1; // the `if` we start with
  for (let i = ifIdx + 1; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind !== "keyword") continue;
    switch (t.text) {
      case "then":
        if (thenIdx < 0) thenIdx = i;
        break;
      case "if":
      case "do":
      case "function":
      case "repeat":
        depth++;
        break;
      case "until":
        depth--;
        break;
      case "end":
        depth--;
        if (depth === 0) {
          if (thenIdx < 0) return null;
          return { thenIdx, endIdx: i };
        }
        break;
      default:
        break;
    }
  }
  return null;
}

export interface DispatchRange {
  lo: number;
  hi: number;
}

export interface OpcodeHandler {
  opcode: number;
  /** Raw (minified) handler source. */
  text: string;
  /** Classified mnemonic (e.g. "JMP", "GETTABLE_K") or null. */
  name: string | null;
}

/**
 * Parse the dispatch tree following a fetch site. Returns handlers for every
 * opcode whose leaf could be isolated. Range coverage is best-effort: junk
 * branches that never execute may swallow some opcode ids.
 */
export function parseDispatchTree(
  src: string,
  fetch: FetchSite,
  maxBytes = 30_000,
): { handlers: Map<number, string>; fetchVar: string } {
  const handlers = new Map<number, string>();
  const toks = tokenizeLua(src, fetch.after, Math.min(src.length, fetch.after + maxBytes));
  if (toks.length === 0 || toks[0].text !== "if") return { handlers, fetchVar: fetch.opVar };

  const tokText = (from: number, to: number): string => {
    if (from >= to || from >= toks.length || to <= 0) return "";
    const startPos = toks[from].pos;
    const lastTok = toks[Math.min(to - 1, toks.length - 1)];
    return src.slice(startPos, lastTok.pos + lastTok.text.length);
  };

  /** Max opcodes a single leaf handler may cover — wider catch-all ranges
   * (junk/never-executed branches) stay unresolved. */
  const LEAF_RANGE_CAP = 512;

  const walk = (tokStart: number, range: DispatchRange): void => {
    if (range.lo > range.hi) return;
    if (tokStart >= toks.length || toks[tokStart].kind !== "keyword" || toks[tokStart].text !== "if") {
      // leaf: whole region is handler text — covers every opcode in the range
      if (range.hi - range.lo < LEAF_RANGE_CAP) {
        const end = findStatementEnd(toks, tokStart);
        const text = tokText(tokStart, end);
        for (let op = range.lo; op <= range.hi; op++) handlers.set(op, text);
      }
      return;
    }
    const ext = scanIf(toks, tokStart);
    if (!ext) return;
    const condText = tokText(tokStart + 1, ext.thenIdx);
    const split = classifyCondition(condText, fetch.opVar);
    if (!split) {
      // not a dispatch condition — whole if is handler code
      if (range.hi - range.lo < LEAF_RANGE_CAP) {
        const text = tokText(tokStart, ext.endIdx + 1);
        for (let op = range.lo; op <= range.hi; op++) handlers.set(op, text);
      }
      return;
    }
    const thenIdx = ext.thenIdx;
    const { op, k } = split;
    // Determine token ranges for then/else branches.
    const endIdx = ext.endIdx;
    let thenTokEnd = -1;
    let elseTokStart = -1;
    let scanningDepth = 0;
    for (let i = thenIdx + 1; i < endIdx; i++) {
      const t = toks[i];
      if (t.kind !== "keyword") continue;
      if (t.text === "if" || t.text === "do" || t.text === "function" || t.text === "repeat") scanningDepth++;
      else if (t.text === "end" || t.text === "until") scanningDepth--;
      else if (scanningDepth === 0 && (t.text === "else" || t.text === "elseif")) {
        thenTokEnd = i;
        elseTokStart = i + 1;
        break;
      }
    }
    if (thenTokEnd < 0) thenTokEnd = endIdx;

    // Branch ranges depend on the comparison:
    //   `i >= K`  → then=[K,hi], else=[lo,K-1]
    //   `i < K`   → then=[lo,K-1], else=[K,hi]
    //   `i == K`  → then=[K,K], else=[lo,K-1]+[K+1,hi]
    //   `i ~= K`  → then=[lo,K-1]+[K+1,hi], else=[K,K]
    let thenRange: DispatchRange | null = null;
    let elseRange: DispatchRange | null = null;
    let thenExtra: DispatchRange | null = null;
    let elseExtra: DispatchRange | null = null;
    switch (op) {
      case ">=":
        thenRange = { lo: k, hi: range.hi };
        elseRange = { lo: range.lo, hi: k - 1 };
        break;
      case "<":
        thenRange = { lo: range.lo, hi: k - 1 };
        elseRange = { lo: k, hi: range.hi };
        break;
      case ">":
        thenRange = { lo: k + 1, hi: range.hi };
        elseRange = { lo: range.lo, hi: k };
        break;
      case "<=":
        thenRange = { lo: range.lo, hi: k };
        elseRange = { lo: k + 1, hi: range.hi };
        break;
      case "==":
        thenRange = { lo: k, hi: k };
        elseRange = { lo: range.lo, hi: k - 1 };
        elseExtra = { lo: k + 1, hi: range.hi };
        break;
      case "~=":
        thenRange = { lo: range.lo, hi: k - 1 };
        thenExtra = { lo: k + 1, hi: range.hi };
        elseRange = { lo: k, hi: k };
        break;
      default:
        return;
    }

    // then-branch tokens start right after `then` — but nested if-statements
    // inside the then-branch belong to it, so we re-locate using thenTokEnd.
    if (thenRange && thenRange.lo <= thenRange.hi) walk(thenIdx + 1, thenRange);
    if (thenExtra && thenExtra.lo <= thenExtra.hi) walk(thenIdx + 1, thenExtra);
    if (elseRange && elseTokStart >= 0 && elseRange.lo <= elseRange.hi) walk(elseTokStart, elseRange);
    if (elseExtra && elseTokStart >= 0 && elseExtra.lo <= elseExtra.hi) walk(elseTokStart, elseExtra);
    // empty-range branches (lo>hi): nothing to do
  };

  walk(0, { lo: 0, hi: 4095 });
  return { handlers, fetchVar: fetch.opVar };
}

function findStatementEnd(toks: Tok[], start: number): number {
  // walk to the matching `end` of whatever block starts here, or next `;`/`end`
  let depth = 0;
  for (let i = start; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind !== "keyword") continue;
    if (t.text === "if" || t.text === "do" || t.text === "function" || t.text === "repeat") depth++;
    else if (t.text === "until" || t.text === "end") {
      depth--;
      if (depth <= 0) return i;
    } else if (depth === 0 && t.text === "else") return i;
  }
  return Math.min(toks.length, start + 40);
}

interface ConditionSplit {
  op: ">=" | "<" | ">" | "<=" | "==" | "~=";
  k: number;
}

/** If the condition is a dispatch test on the opcode variable, extract it. */
function classifyCondition(condText: string, opVar: string): ConditionSplit | null {
  const c = condText.replace(/\s+/g, " ").trim();
  // strip outer parens
  let s = c;
  let changed = true;
  while (changed) {
    changed = false;
    if (s.startsWith("(") && s.endsWith(")")) {
      // ensure the parens wrap the whole condition
      let d = 0;
      let wrap = true;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === "(") d++;
        else if (s[i] === ")") {
          d--;
          if (d === 0 && i < s.length - 1) {
            wrap = false;
            break;
          }
        }
      }
      if (wrap) {
        s = s.slice(1, -1);
        changed = true;
      }
    }
  }
  const neg = /^not\b\s*\(?\s*/.exec(s);
  let body = s;
  const negate = Boolean(neg);
  if (neg) {
    body = s.slice(neg[0].length);
    if (neg[0].includes("(")) body = body.replace(/\)\s*$/, "");
  }
  body = body.trim().replace(/^\(/, "").replace(/\)$/, "").trim();
  const m = new RegExp(`^${opVar}\\s*(>=|<=|==|~=|>|<)\\s*(0[xXbB][0-9a-fA-F_]+|\\d[\\d_]*)$`).exec(body);
  if (!m) return null;
  const k = parseLuauNumber(m[2]);
  if (k === null) return null;
  let op = m[1] as ConditionSplit["op"];
  if (negate) {
    const inv: Record<string, string> = { ">=": "<", "<": ">=", ">": "<=", "<=": ">", "==": "~=", "~=": "==" };
    op = inv[op] as ConditionSplit["op"];
  }
  return { op, k };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler classification → semantic opcode names
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise handler source for matching. */
function norm(h: string): string {
  return h.replace(/\s+/g, " ").replace(/;\s*/g, "; ").trim();
}

interface Rule {
  name: string;
  re: RegExp;
}

/**
 * Pattern rules for Luraph VM handlers (v14.6–v14.8 family). Matched against
 * the normalised handler text; first hit wins. Register/operand letters vary
 * between samples, so patterns use back-references for the column letters.
 */
const RULES: Rule[] = [
  { name: "RETURN", re: /^return true,/ },
  { name: "RETURN_VOID", re: /^return;$/ },
  { name: "RETURN_VARARG", re: /^return false,/ },
  { name: "JMP", re: /^(?:else\s*)?F=\(?m\[F\]\)?;?\s*$/ },
  { name: "JEQ", re: /if\s+f\[(\w)\[F\]\]==f\[(\w)\[F\]\]\s*then\s+F=m\[F\]/ },
  { name: "LOADK", re: /f\[\w\[F\]\]=t\[F\]/ },
  { name: "NEWTABLE", re: /f\[\w\[F\]\]=\{\}/ },
  { name: "NOT", re: /f\[\w\[F\]\]=\(not f\[\w\[F\]\]\)/ },
  { name: "GETTABLE_K", re: /f\[\w\[F\]\]=\(f\[\w\[F\]\]\[t\[F\]\]\)/ },
  { name: "SETTABLE_K", re: /\(f\[\w\[F\]\]\)\[t\[F\]\]=/ },
  { name: "GETUPVAL", re: /I=\(D\[r\[F\]\]\)/ },
  { name: "SETUPVAL", re: /I\[3\]\[I\[0?X?2\]\]=f\[/ },
  { name: "CALL0", re: /d=\(\w\[F\]\);\(?f\[d\]\)\(\);/ },
  { name: "CALL1", re: /I=\(r\[F\]\);\(f\[I\]\)\(f\[I\+1\]\);/ },
  { name: "ADDK", re: /f\[\w\[F\]\]=\(f\[\w\[F\]\]\+p\[F\]\)/ },
  { name: "SUB_R", re: /f\[\w\[F\]\]=\(f\[\w\[F\]\]-f\[\w\[F\]\]\)/ },
  { name: "MODK", re: /f\[\w\[F\]\]=f\[\w\[F\]\]%p\[F\]/ },
  { name: "DIVK", re: /f\[\w\[F\]\]=f\[\w\[F\]\]\/J\[F\]/ },
  { name: "NE", re: /f\[\w\[F\]\]=\(p\[F\]~=t\[F\]\)/ },
  { name: "GT", re: /f\[\w\[F\]\]=p\[F\]>J\[F\]/ },
  { name: "GE", re: /f\[\w\[F\]\]=\(p\[F\]>=t\[F\]\)/ },
  { name: "NEQ_R", re: /f\[\w\[F\]\]=f\[\w\[F\]\]~=f\[\w\[F\]\]/ },
  { name: "EQ_JMP", re: /if\s+f\[\w\[F\]\]==J\[F\]\s*then\s*else\s*F=/ },
  { name: "LT_JMP", re: /if\s+not\s*\(not\s*\(J\[F\]<=f\[\w\[F\]\]\)\)\s*then\s*else\s*F=/ },
  { name: "VARARG_LOAD", re: /for\s+\w+=0?X?0*1,r\[F\]do/ },
  { name: "NEW_TABLE", re: /z=\(r\[F\]\);e=\{\}/ },
  { name: "GETFIELD_SELF", re: /z=\(f\);e=m\[F\];z=\(z\[e\]\)/ },
  { name: "SELF_CALL", re: /e=f;C=\(r\[F\]\);e=e\[C\]/ },
  { name: "CONCAT", re: /e=e\(\w,\w,\w\)/ },
  { name: "CLOSE_UPVALS", re: /for\s+\w,\w\s+in\s+A\s+do/ },
];

/** Best-effort semantic name for a handler. */
export function classifyHandler(handler: string): string | null {
  const h = norm(handler);
  if (!h) return null;
  for (const r of RULES) {
    if (r.re.test(h)) return r.name;
  }
  return null;
}
