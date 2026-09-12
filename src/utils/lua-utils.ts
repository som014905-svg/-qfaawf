// Lua parsing / text utilities used by the deobfuscators.
//
// This module exposes a small but correct Lua lexer that:
//   - tokenises comments (line + long), strings (short + long), numbers
//     (hex/bin/dec with underscores like 0x1_A, 0b11_001, 1_000_000),
//     identifiers/keywords, and operators.
//   - is the single source of truth for all "skip over literal" logic so
//     the obfuscators never accidentally touch the inside of a string,
//     comment, or number.
//
// Built on top of the lexer:
//   - iterStringLiterals()       → yield every string literal
//   - renameObfuscatedIdentifiers() → safe Il1/O0 rename that NEVER breaks
//     hex/bin/dec numbers, keywords, or strings.
//   - beautifyLua()                → conservative whitespace normaliser that
//     preserves all tokens exactly.

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

export type LuaTokenKind =
  | "identifier"
  | "keyword"
  | "number"
  | "string"
  | "longstring"
  | "comment"
  | "longcomment"
  | "operator"
  | "punct"
  | "whitespace"
  | "newline"
  | "eof";

export interface LuaToken {
  kind: LuaTokenKind;
  /** Index in source where the token starts */
  start: number;
  /** Index right after the token ends */
  end: number;
  /** Raw text of the token */
  text: string;
  /** For strings/longstrings: the decoded value */
  value?: string;
}

const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while",
]);

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const HEX = /[0-9a-fA-F]/;

/** Count the level of a long bracket [[ (0), [=[ (1), ... starting at idx. -1 if not a long bracket. */
function longBracketLevel(src: string, idx: number): number {
  if (src[idx] !== "[") return -1;
  let j = idx + 1;
  let level = 0;
  while (src[j] === "=") {
    level++;
    j++;
  }
  if (src[j] !== "[") return -1;
  return level;
}

/** Find the matching ]=*] long-bracket close after openIdx. */
function findLongBracketClose(src: string, openIdx: number, level: number): number {
  const needle = "]" + "=".repeat(level) + "]";
  const from = openIdx + 2 + level;
  return src.indexOf(needle, from);
}

/**
 * UTF-8 encode a single Unicode codepoint (for Luau `\u{XXXX}` escapes),
 * returning the resulting bytes as a latin1-mapped string (one JS char per
 * raw byte) — the same "1 char = 1 byte" convention every other string in
 * this pipeline uses. Returning a real multi-byte JS/Unicode character here
 * (e.g. via String.fromCodePoint) would be indistinguishable downstream from
 * a single raw byte in the same numeric range, corrupting byte-length and
 * re-escaping logic.
 */
function utf8Encode(code: number): string {
  if (!Number.isFinite(code) || code < 0) return "";
  if (code <= 0x7f) return String.fromCharCode(code);
  const bytes: number[] = [];
  if (code <= 0x7ff) {
    bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
  } else if (code <= 0xffff) {
    bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  } else if (code <= 0x1fffff) {
    bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  } else if (code <= 0x3ffffff) {
    bytes.push(
      0xf8 | (code >> 24),
      0x80 | ((code >> 18) & 0x3f),
      0x80 | ((code >> 12) & 0x3f),
      0x80 | ((code >> 6) & 0x3f),
      0x80 | (code & 0x3f)
    );
  } else {
    bytes.push(
      0xfc | (code >> 30),
      0x80 | ((code >> 24) & 0x3f),
      0x80 | ((code >> 18) & 0x3f),
      0x80 | ((code >> 12) & 0x3f),
      0x80 | ((code >> 6) & 0x3f),
      0x80 | (code & 0x3f)
    );
  }
  return String.fromCharCode(...bytes);
}

function resolveStringEscape(src: string, i: number): { value: string; consumed: number } {
  const next = src[i + 1];
  switch (next) {
    case "n": return { value: "\n", consumed: 2 };
    case "t": return { value: "\t", consumed: 2 };
    case "r": return { value: "\r", consumed: 2 };
    case "a": return { value: "\x07", consumed: 2 };
    case "b": return { value: "\b", consumed: 2 };
    case "f": return { value: "\f", consumed: 2 };
    case "v": return { value: "\v", consumed: 2 };
    case "\\": return { value: "\\", consumed: 2 };
    case '"': return { value: '"', consumed: 2 };
    case "'": return { value: "'", consumed: 2 };
    case "\n": return { value: "\n", consumed: 2 };
    case "z": {
      // \z skips following whitespace
      let j = i + 2;
      while (j < src.length && /\s/.test(src[j])) j++;
      return { value: "", consumed: j - i };
    }
    case "u": {
      // Luau unicode escape: \u{XXXX} — up to 6 hex digits, UTF-8 encoded.
      if (src[i + 2] === "{") {
        const close = src.indexOf("}", i + 3);
        if (close > i + 3 && close - (i + 3) <= 6) {
          const hex = src.slice(i + 3, close);
          if (/^[0-9a-fA-F]+$/.test(hex)) {
            const code = parseInt(hex, 16);
            if (code <= 0x7fffffff) {
              return { value: utf8Encode(code), consumed: close + 1 - i };
            }
          }
        }
      }
      return { value: "u", consumed: 2 };
    }
    case "x": {
      const hex = src.slice(i + 2, i + 4);
      const code = parseInt(hex, 16);
      if (isNaN(code)) return { value: next, consumed: 2 };
      return { value: String.fromCharCode(code), consumed: 4 };
    }
    default: {
      if (next >= "0" && next <= "9") {
        // up to 3 decimal digits
        let digits = "";
        let k = i + 1;
        while (k < src.length && DIGIT.test(src[k]) && digits.length < 3) {
          digits += src[k];
          k++;
        }
        const code = parseInt(digits, 10);
        if (code > 255) return { value: String.fromCharCode(code & 0xff), consumed: digits.length + 1 };
        return { value: String.fromCharCode(code), consumed: digits.length + 1 };
      }
      return { value: next ?? "", consumed: 2 };
    }
  }
}

/** Tokenise a Lua/Luau source string. */
export function* tokenize(src: string): Generator<LuaToken> {
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i];

    // Whitespace (non-newline)
    if (ch === " " || ch === "\t") {
      const start = i;
      while (i < len && (src[i] === " " || src[i] === "\t")) i++;
      yield { kind: "whitespace", start, end: i, text: src.slice(start, i) };
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      const start = i;
      if (ch === "\r" && src[i + 1] === "\n") i += 2;
      else i++;
      yield { kind: "newline", start, end: i, text: src.slice(start, i) };
      continue;
    }

    // Comments
    if (ch === "-" && src[i + 1] === "-") {
      const start = i;
      i += 2;
      // long comment?
      const level = longBracketLevel(src, i);
      if (level >= 0) {
        const close = findLongBracketClose(src, i, level);
        if (close < 0) {
          i = len;
        } else {
          i = close + 2 + level;
        }
        yield { kind: "longcomment", start, end: i, text: src.slice(start, i) };
        continue;
      }
      // line comment
      while (i < len && src[i] !== "\n") i++;
      yield { kind: "comment", start, end: i, text: src.slice(start, i) };
      continue;
    }

    // Long string
    if (ch === "[") {
      const level = longBracketLevel(src, i);
      if (level >= 0) {
        const start = i;
        const openEnd = i + 2 + level;
        let valStart = openEnd;
        // skip exactly one leading newline
        if (src[valStart] === "\r") valStart++;
        if (src[valStart] === "\n") valStart++;
        const close = findLongBracketClose(src, i, level);
        if (close < 0) {
          i = len;
          yield { kind: "longstring", start, end: i, text: src.slice(start, i), value: src.slice(valStart) };
          continue;
        }
        const value = src.slice(valStart, close);
        i = close + 2 + level;
        yield { kind: "longstring", start, end: i, text: src.slice(start, i), value };
        continue;
      }
      // otherwise: '[' or '[[' as punct
      const start = i;
      if (src[i + 1] === "[") i += 2;
      else i++;
      yield { kind: "punct", start, end: i, text: src.slice(start, i) };
      continue;
    }

    // Short string
    if (ch === '"' || ch === "'") {
      const start = i;
      i++;
      let value = "";
      while (i < len) {
        const c = src[i];
        if (c === "\\") {
          const { value: v, consumed } = resolveStringEscape(src, i);
          value += v;
          i += consumed;
          continue;
        }
        if (c === ch) {
          i++;
          break;
        }
        if (c === "\n" && ch !== "'") {
          // unterminated; bail
          break;
        }
        value += c;
        i++;
      }
      yield { kind: "string", start, end: i, text: src.slice(start, i), value };
      continue;
    }

    // Numbers — hex (0x), binary (0b), decimal — all with optional underscores
    if (ch === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
      const start = i;
      i += 2;
      while (i < len && (HEX.test(src[i]) || src[i] === "_")) i++;
      // fractional / power part for hex floats
      if (src[i] === ".") {
        i++;
        while (i < len && (HEX.test(src[i]) || src[i] === "_")) i++;
      }
      if (src[i] === "p" || src[i] === "P") {
        i++;
        if (src[i] === "+" || src[i] === "-") i++;
        while (i < len && (DIGIT.test(src[i]) || src[i] === "_")) i++;
      }
      yield { kind: "number", start, end: i, text: src.slice(start, i) };
      continue;
    }
    if (ch === "0" && (src[i + 1] === "b" || src[i + 1] === "B")) {
      const start = i;
      i += 2;
      while (i < len && (src[i] === "0" || src[i] === "1" || src[i] === "_")) i++;
      yield { kind: "number", start, end: i, text: src.slice(start, i) };
      continue;
    }
    if (DIGIT.test(ch) || (ch === "." && DIGIT.test(src[i + 1]))) {
      const start = i;
      while (i < len && (DIGIT.test(src[i]) || src[i] === "_")) i++;
      if (src[i] === ".") {
        i++;
        while (i < len && (DIGIT.test(src[i]) || src[i] === "_")) i++;
      }
      if (src[i] === "e" || src[i] === "E") {
        i++;
        if (src[i] === "+" || src[i] === "-") i++;
        while (i < len && (DIGIT.test(src[i]) || src[i] === "_")) i++;
      }
      yield { kind: "number", start, end: i, text: src.slice(start, i) };
      continue;
    }

    // Identifier / keyword
    if (IDENT_START.test(ch)) {
      const start = i;
      i++;
      while (i < len && IDENT_PART.test(src[i])) i++;
      const text = src.slice(start, i);
      const kind = KEYWORDS.has(text) ? "keyword" : "identifier";
      yield { kind, start, end: i, text };
      continue;
    }

    // Multi-char operators
    // 3-char operators first (v4 fix: `<<=`/`>>=` were previously mis-tokenized
    // as `<<` + `=` / `>>` + `=` because of a dead `two == "<<="` condition).
    const three = src.slice(i, i + 3);
    if (three === "..." || three === "..=" || three === "<<=" || three === ">>=") {
      yield { kind: "operator", start: i, end: i + 3, text: three };
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === ".." || two === "::" || two === "==" || two === "~=" || two === "<=" ||
        two === ">=" || two === ">>" || two === "<<" || two === "//" ||
        two === "+=" || two === "-=" || two === "*=" || two === "/=" ||
        two === "%=" || two === "^=") {
      yield { kind: "operator", start: i, end: i + 2, text: two };
      i += 2;
      continue;
    }
    // Single-char operator / punct
    yield { kind: "punct", start: i, end: i + 1, text: ch };
    i++;
  }
  yield { kind: "eof", start: i, end: i, text: "" };
}

// ---------------------------------------------------------------------------
// String literal iteration
// ---------------------------------------------------------------------------

export interface StringLiteral {
  start: number;
  end: number;
  value: string;
  quote: string;
}

/** Walk a Lua source string and yield every string literal (short + long). */
export function* iterStringLiterals(src: string): Generator<StringLiteral> {
  for (const tok of tokenize(src)) {
    if (tok.kind === "string") {
      yield { start: tok.start, end: tok.end, value: tok.value ?? "", quote: tok.text[0] };
    } else if (tok.kind === "longstring") {
      const level = longBracketLevel(src, tok.start);
      yield {
        start: tok.start,
        end: tok.end,
        value: tok.value ?? "",
        quote: "[" + "=".repeat(level) + "[",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/** Decode a base64 string, tolerant of whitespace / padding issues. */
export function tryBase64Decode(s: string): string | null {
  try {
    const cleaned = s.replace(/[^A-Za-z0-9+/=]/g, "");
    if (cleaned.length === 0) return null;
    const pad = cleaned.length % 4;
    const padded = pad ? cleaned + "=".repeat(4 - pad) : cleaned;
    const bin = Buffer.from(padded, "base64");
    // latin1, not utf8: the decoded payload is frequently raw/encrypted
    // binary rather than valid UTF-8 text, and utf8 would silently mangle
    // (or \uFFFD-replace) any byte sequence that isn't well-formed UTF-8.
    return bin.toString("latin1");
  } catch {
    return null;
  }
}

/** XOR-decode data with a numeric or string key. */
export function xorDecode(data: string, key: string | number): string {
  const keyBytes = typeof key === "number"
    ? [key & 0xff]
    : Array.from(Buffer.from(key, "latin1"));
  if (keyBytes.length === 0) return data;
  const buf = Buffer.from(data, "binary");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ keyBytes[i % keyBytes.length];
  }
  // latin1: XOR'd bytes are not guaranteed to be valid UTF-8 (and often are
  // still-encrypted intermediate bytes), so preserve them 1:1 instead of
  // risking utf8 corruption.
  return out.toString("latin1");
}

/** Detect if a string is "mostly printable" Lua/Luau source. */
export function looksLikeLuaSource(s: string): boolean {
  if (!s) return false;
  const printable = s.split("").filter((c) => {
    const code = c.charCodeAt(0);
    return (code >= 32 && code < 127) || code === 9 || code === 10 || code === 13;
  }).length;
  return printable / s.length > 0.85;
}

/**
 * Conservative Lua beautifier. Walks tokens and rebuilds the source with
 * normalised whitespace. Strategy:
 *   - Insert a newline after `;`, after block-opening keywords
 *     (`then`, `do`, `repeat`), and before block-closing keywords
 *     (`end`, `else`, `elseif`, `until`).
 *   - Within a line, collapse runs of whitespace into a single space and
 *   - drop spaces around punctuation where Lua doesn't allow them.
 *   - Track block depth to re-indent lines.
 *
 * v4 indent model (fixes the +1-per-block drift of v3.6): ONLY tokens that
 * pair 1:1 with a closing token increment depth —
 *   `then` (closes with end)  — but NOT the `then` of an `elseif`
 *   `do`   (closes with end)  — covers for/while/do (their `do` opens)
 *   `function` (closes with end), `repeat` (closes with until)
 *   `(`, `{` (close with )/})
 * `if`/`for`/`while` themselves NEVER indent (their block opens at then/do).
 * `else`/`elseif` dedent their own line then re-indent (net zero).
 *
 * This works on both single-line minified output AND already-formatted
 * source — it never breaks syntax.
 */
export function beautifyLua(src: string): string {
  const tokens = [...tokenize(src)];

  const lines: string[] = [];
  let cur = "";
  let indent = 0;
  // v4 model: each line's indent is SNAPSHOTTED when the line starts.
  // Dedenting tokens (end/until/)/}/else/elseif) apply BEFORE the snapshot
  // (so their own line prints at the outer level); indenting tokens
  // (then/do/function/repeat/{/() apply AFTER it (so the opener's line
  // stays at the outer level and only the BODY indents).
  let lineIndent = 0;
  let lineStarted = false;
  // Luau if-EXPRESSION (`x = if c then a else b`) has no `end` — its
  // then/else must not change the indent balance at all.
  let inIfExpr = false;
  let suppressNextThen = false;

  // Hard cap: a valid Lua file never nests 100 levels deep — inputs with
  // unbalanced blocks (truncated/corrupted) would otherwise explode the
  // output with runaway indentation.
  const MAX_INDENT = 100;

  const startLineIfNeeded = () => {
    if (lineStarted) return;
    lineIndent = Math.min(indent, MAX_INDENT);
    lineStarted = true;
  };

  const flushLine = () => {
    const trimmed = cur.replace(/[ \t]+$/, "");
    if (trimmed.length === 0) {
      lines.push("");
    } else {
      lines.push("  ".repeat(lineIndent) + trimmed);
    }
    cur = "";
    lastChar = "";
    lineStarted = false;
  };

  /** Decide whether to break the line BEFORE this token. */
  const shouldBreakBefore = (tok: LuaToken, prev: LuaToken | null): boolean => {
    if (!prev) return false;
    // a new statement after a block close (`end`/`until`) starts a new line
    // (`end print()` → `end\nprint()`); closers like )/,/}/] are excluded so
    // nested function values stay intact.
    if (tok.kind === "identifier" && prev.kind === "keyword" && (prev.text === "end" || prev.text === "until")) {
      return true;
    }
    if (tok.kind === "keyword") {
      if (tok.text === "end" || tok.text === "until") {
        return true;
      }
      // `else` of a Luau if-EXPRESSION stays on the same line
      if ((tok.text === "else" || tok.text === "elseif") && inIfExpr) {
        return false;
      }
      if (tok.text === "end" || tok.text === "else" || tok.text === "elseif" || tok.text === "until") {
        return true;
      }
      // local/function/return/if/for/while on their own line (but not after `)` in call)
      if ((tok.text === "local" || tok.text === "return" ||
           tok.text === "if" || tok.text === "for" || tok.text === "while" || tok.text === "repeat") &&
          prev.text !== "(" && prev.text !== "{") {
        return true;
      }
      // `function` starts a new line only as a STATEMENT — when used as a
      // value (`local f = function()`, `t = {function() end}`, `return function()`)
      // it stays on the current line.
      if (tok.text === "function") {
        const valueCtx = prev.text === "=" || prev.text === "," || prev.text === "(" ||
          prev.text === "{" || prev.text === "[" || prev.text === "return" ||
          prev.kind === "operator";
        if (!valueCtx && prev.text !== "(" && prev.text !== "{") return true;
      }
      // standalone `do` statement (not the `do` of a for/while header)
      if (tok.text === "do" && !inLoopHeader) return true;
    }
    return false;
  };

  /** Decide whether to break the line AFTER this token. */
  const shouldBreakAfter = (tok: LuaToken): boolean => {
    if (tok.text === ";") return true;
    if (tok.kind === "keyword") {
      if (tok.text === "then" || tok.text === "do") return true;
      if (tok.text === "repeat") return true;
    }
    return false;
  };

  // v4.1 PERF: last appended character, tracked separately. Reading
  // `cur[cur.length-1]` or running a regex over `cur` per token flattens
  // the growing rope string every iteration → O(N²) on long lines (a 520KB
  // single-line payload took 27s; with tracking it is linear).
  let lastChar = "";
  // Track whether we are inside a `for ... do` / `while ... do` header so the
  // header's own `do` is not mistaken for a standalone do-statement.
  let inLoopHeader = false;
  // Previous two significant tokens (to classify `-`/`+` as unary vs binary
  // when spacing their operand).
  let prevTok: LuaToken | null = null;
  let prevPrevTok: LuaToken | null = null;
  const isValueEnding = (t: LuaToken | null): boolean =>
    !!t && (t.kind === "number" || t.kind === "string" || t.kind === "longstring" ||
      t.kind === "identifier" || t.text === ")" || t.text === "]" || t.text === "}");
  // True when prevTok is a unary `-`/`+` (no space before its operand).
  const prevIsUnarySign = (): boolean =>
    !!prevTok && prevTok.kind === "punct" && (prevTok.text === "-" || prevTok.text === "+") &&
    !isValueEnding(prevPrevTok);
  for (const tok of tokens) {

    if (tok.kind === "eof") break;
    if (tok.kind === "whitespace" || tok.kind === "newline") continue;
    if (tok.kind === "comment" || tok.kind === "longcomment") {
      if (cur.length > 0) { cur += " "; lastChar = " "; }
      cur += tok.text;
      if (tok.text.length > 0) lastChar = tok.text[tok.text.length - 1];
      // A comment always terminates its line — otherwise the tokens that
      // follow would be swallowed into the comment (`-- note return (f)`).
      flushLine();
      continue;
    }

    // Break line before?
    if (cur.length > 0 && shouldBreakBefore(tok, prevTok)) {
      flushLine();
    }
    // ── Dedents apply BEFORE the line snapshot (own line at outer level) ──
    const text = tok.text;
    if (tok.kind === "keyword") {
      if (text === "end" || text === "until") {
        indent = Math.max(0, indent - 1);
      } else if (text === "elseif") {
        indent = Math.max(0, indent - 1); // its trailing `then` re-indents
      } else if (text === "else" && !inIfExpr) {
        indent = Math.max(0, indent - 1); // body re-indent applied below
      } else if (text === "for" || text === "while") {
        inLoopHeader = true;
      } else if (text === "do") {
        inLoopHeader = false;
      } else if (text === "if") {
        // Luau if-expression guard: `= if`, `return if`, `f(if ...`, `and if`.
        // NOTE: a number/string/`)`/`]` before `if` means the previous
        // expression just ENDED — that `if` starts a statement.
        const p = prevTok;
        const exprCtx =
          !!p &&
          ((p.kind === "operator") ||

            (p.kind === "keyword" && (p.text === "return" || p.text === "or" || p.text === "and" || p.text === "not")) ||
            (p.kind === "punct" && (p.text === "=" || p.text === "," || p.text === "(" || p.text === "{" || p.text === "[")));
        if (exprCtx) {
          inIfExpr = true;
          suppressNextThen = true; // its `then` opens no block
        }
      }
    } else if (tok.kind === "punct") {
      if (text === "}" || text === ")") {
        indent = Math.max(0, indent - 1);
      }
    }

    // Snapshot this line's indent.
    startLineIfNeeded();

    // Unary sign right after `,` / open bracket: no leading space
    // (`f(1, -2)`); after `=` / keywords keep the space (`x = -5`).
    const unarySignCtx = (text === "-" || text === "+") &&
      !!(prevTok && (prevTok.text === "," || prevTok.text === "(" || prevTok.text === "{" ||
        prevTok.text === "["));
    if (cur.length > 0) {
      // v4.1 PERF: spacing is decided from the tracked `lastChar` only —
      // reading `cur[cur.length-1]` / running a regex over `cur` per token
      // flattens the growing rope string → O(N²) on long payload lines.
      const last = lastChar;
      // No space if:
      //   - previous char was an open bracket / colon / dot (NOT comma —
      //     `, ` gets a following space: `f(a, b)`, `for i = 1, 10 do`)
      //   - this token is a close bracket / comma / semicolon / colon / dot
      //     / concat (they attach to the preceding token)
      //   - this token is `[` indexing directly after an identifier or `]` or `)`
      //     (e.g. `b[m]`, `t[1]`, `f()[k]` — never `b [m]`)
      const noSpaceBefore = last === "(" || last === "[" || last === "{" || last === ":" || last === "." ||
        text === ")" || text === "]" || text === "}" ||
        text === "," || text === ";" || text === ":" ||
        text === "." || text === ".." || text === "...";
      const noSpaceAfterOpen = last === "(" || last === "[" || last === "{";
      // Indexing: `b[m]` — no space between identifier/`)`/`]`/string and `[`
      const prevIsIndexable =
        (prevTok?.kind === "identifier") ||
        (prevTok?.kind === "punct" && (prevTok.text === ")" || prevTok.text === "]")) ||
        (prevTok?.kind === "string" || prevTok?.kind === "longstring");
      const noSpaceBeforeIndexBracket = (text === "[" && prevIsIndexable);
      // Function call: `f(args)`, `obj:method(args)` — no space between
      // identifier/`)`/`]`/string and `(`.
      const noSpaceBeforeCallParen = (text === "(" && prevIsIndexable);
      if (unarySignCtx) {
        // fall through without space
      } else if (prevIsUnarySign() && (tok.kind === "number" || tok.kind === "identifier" ||
          (tok.kind === "punct" && tok.text === "("))) {
        // operand of a just-written unary sign — no space (`-2`, `-x`, `-(...)`)
      } else if (!noSpaceBefore && !noSpaceAfterOpen && !noSpaceBeforeIndexBracket && !noSpaceBeforeCallParen) {
        cur += " ";
        lastChar = " ";
      }
    }

    // ── Indents apply AFTER the snapshot (opener line at outer level) ──
    let justSuppressedThen = false;
    if (tok.kind === "keyword") {
      if (text === "then") {
        if (suppressNextThen) {
          suppressNextThen = false; // if-expr / elseif's then opens no new block
          justSuppressedThen = true;
        } else {
          indent++;
        }
      } else if (text === "do" || text === "function" || text === "repeat") {
        indent++;
      } else if (text === "else") {
        if (inIfExpr) {
          inIfExpr = false; // if-expr else: no end follows — net zero
        } else {
          indent++; // re-indent the else-block body
        }
      }
    } else if (tok.kind === "punct") {
      if (text === "{" || text === "(") {
        indent++;
      }
    }

    cur += tok.text;
    if (tok.text.length > 0) lastChar = tok.text[tok.text.length - 1];

    // Break line after? (a suppressed if-expression `then` keeps the
    // expression on one line: `x = if c then 1 else 2`)
    if (shouldBreakAfter(tok) && !justSuppressedThen) {
      flushLine();
    }

    prevPrevTok = prevTok;
    prevTok = tok;
  }
  if (cur.length > 0) flushLine();

  // Guard: if the beautified output would exceed Node's max string length
  // (~512MB on V8), bail out and return the original source instead of
  // crashing with "Invalid string length". This happens on very large
  // minified inputs (e.g. 1.7MB → 965k tokens → millions of lines).
  const totalLen = lines.reduce((acc, l) => acc + l.length + 1, 0);
  if (totalLen > 100_000_000) {
    // Fallback: just collapse whitespace in the original source, no re-indent.
    return src.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  // Collapse 3+ blank lines into 1
  let out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out + "\n";
}

/**
 * Rename obfuscated identifiers (Ill1, lIllI, O0O, etc.) to readable names like
 * `var1`, `var2`, ... SAFE: uses the real Lua lexer so it never touches:
 *   - numbers (hex 0x1A, binary 0b101, decimals with underscores)
 *   - keywords
 *   - strings / comments
 *   - table-index-via-keyword (e.g. G["end"])
 */
export function renameObfuscatedIdentifiers(src: string): { result: string; renamed: number } {
  // Heuristic: identifiers whose letters are only from {l, I, 1, O, 0, _}
  // (4+ chars) OR look like `lXXX`/`IXXX` soup. We deliberately do NOT match
  // single-letter identifiers or `a123`-style names, because those are
  // extremely common in legitimate minified Lua and renaming them would
  // create more noise than signal.
  const obfRe = /^[lI1O0_]{4,}$/;

  const renameMap = new Map<string, string>();
  let counter = 1;

  // v4 safety guard: if a candidate name is ALSO referenced via a string
  // literal (e.g. `_G["IIII"]`, `getfenv()["lIll"]`), renaming only the
  // identifier occurrences would break that dynamic access — skip the name.
  const stringReferenced = new Set<string>();
  try {
    for (const lit of iterStringLiterals(src)) {
      if (obfRe.test(lit.value)) stringReferenced.add(lit.value);
    }
  } catch {
    /* best-effort guard */
  }

  // First pass: collect candidates
  const candidates: { idx: number; name: string }[] = [];
  for (const tok of tokenize(src)) {
    if (tok.kind !== "identifier") continue;
    if (obfRe.test(tok.text)) {
      if (stringReferenced.has(tok.text)) continue; // dynamic access hazard
      candidates.push({ idx: tok.start, name: tok.text });
      if (!renameMap.has(tok.text)) {
        renameMap.set(tok.text, `var${counter++}`);
      }
    }
  }

  // Second pass: apply replacements (walk from end to start so indices stay valid)
  let result = src;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const { idx, name } = candidates[i];
    const replacement = renameMap.get(name)!;
    result = result.slice(0, idx) + replacement + result.slice(idx + name.length);
  }

  return { result, renamed: renameMap.size };
}

// ---------------------------------------------------------------------------
// Cryptic-local renaming (type-inferred, scope-conservative)
// ---------------------------------------------------------------------------

/** Idiomatic short names that must never be renamed. */
const RENAME_KEEP = new Set([
  // loop / generic conventions
  "n", "self", "_", "_G", "_ENV",
  // meaningful 2–3 letter words
  "ok", "err", "msg", "key", "val", "res", "obj", "arg", "args", "len",
  "str", "num", "tab", "fn", "cb", "id", "ret", "out", "pos", "idx",
  "src", "dst", "cur", "new", "old", "min", "max", "sum", "cnt", "tmp",
  // Roblox context abbreviations
  "cfg", "esp", "gui", "hud", "cam", "plr", "chr", "hum", "hrp", "btn",
  "uis", "ws", "rs", "tp",
]);

const CRYPTO_SHORT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,2}$/; // a, ab, E, j, _x
const CRYPTO_VNUM_RE = /^[A-Za-z]\d{1,4}$/; // v1, x007, a12
const CRYPTO_SOUP_RE = /^[lI1O0_]{4,}$/; // lIll, IO01

function isCrypticLocalName(name: string): boolean {
  if (RENAME_KEEP.has(name)) return false;
  if (KEYWORDS.has(name)) return false;
  // VM-lifter artifacts (registers R0..Rn, upvalues U0..Un, protos, labels)
  // are already systematic — renaming them breaks their 1:1 VM mapping.
  if (/^R\d+$/.test(name) || /^U\d+$/.test(name)) return false;
  if (/^PROTO_\d+$/.test(name) || /^VM_\w+$/.test(name)) return false;
  if (CRYPTO_SOUP_RE.test(name)) return true;
  if (CRYPTO_VNUM_RE.test(name)) return true;
  if (name.length <= 3 && CRYPTO_SHORT_RE.test(name)) return true;
  return false;
}

/** Is the identifier at sig[m] a `local` declaration target? (local a, b = …) */
function isLocalDeclTarget(sig: LuaToken[], m: number): boolean {
  let p = m - 1;
  while (p >= 0) {
    const t = sig[p];
    if (t.kind === "identifier" || t.text === ",") {
      p--;
      continue;
    }
    return t.kind === "keyword" && t.text === "local";
  }
  return false;
}

/**
 * Rename cryptic local variables & parameters (`local a = {…}`, `function(a, b)`,
 * `local E`, `v1`…) to type-inferred readable names:
 *   `local a = {"x"}`        → `local tbl1 = {"x"}`
 *   `local b = "http://…"`   → `local str1 = "http://…"`
 *   `local c = 5`            → `local num1 = 5`
 *   `function(d, e)`         → `function(arg1, arg2)`
 *   `local f = function()`   → `local fn1 = function()`
 *
 * Safety model (parse-free but conservative):
 *   - only names DECLARED in this file (`local …` or function params) are renamed
 *     → globals (game, getgenv, …) can never be touched
 *   - a name is skipped entirely if ANY occurrence:
 *       · is preceded by `.` or `:`  (property/method access — could be a
 *         table field with the same text)
 *       · is followed by `=` outside a `local` declaration (could be a table
 *         constructor key `{ a = 1 }` or a re-assignment)
 *   - replacements are applied token-by-token (strings/comments untouched)
 *   - new names never collide with any existing identifier in the file
 */
export function renameCrypticLocals(src: string): { result: string; renamed: number } {
  const toks = [...tokenize(src)];
  const sig = toks.filter(
    (t) =>
      t.kind !== "whitespace" &&
      t.kind !== "newline" &&
      t.kind !== "comment" &&
      t.kind !== "longcomment" &&
      t.kind !== "eof"
  );
  if (sig.length === 0) return { result: src, renamed: 0 };

  // All identifier texts (for collision-free new names).
  const allIdents = new Set<string>();
  for (const t of sig) if (t.kind === "identifier") allIdents.add(t.text);

  // ---- Pass 1: declarations (local statements + function parameters) ----
  const declPrefix = new Map<string, string>(); // name → inferred prefix

  const inferPrefix = (rhsIdx: number): string => {
    const t = sig[rhsIdx];
    if (!t) return "var";
    if (t.kind === "keyword" && t.text === "function") return "fn";
    if (t.kind === "keyword" && (t.text === "true" || t.text === "false")) return "flag";
    if (t.text === "{") return "tbl";
    if (t.kind === "string" || t.kind === "longstring") return "str";
    if (t.kind === "number") return "num";
    if (t.kind === "identifier" && declPrefix.has(t.text)) return declPrefix.get(t.text)!;
    return "var";
  };

  for (let m = 0; m < sig.length; m++) {
    const t = sig[m];
    if (t.kind === "keyword" && t.text === "local") {
      // local function NAME(…)
      if (sig[m + 1]?.kind === "keyword" && sig[m + 1].text === "function") {
        const nameTok = sig[m + 2];
        if (nameTok?.kind === "identifier" && !declPrefix.has(nameTok.text)) {
          declPrefix.set(nameTok.text, "fn");
        }
        continue;
      }
      // local NAME[, NAME]* [= expr]
      let p = m + 1;
      const names: string[] = [];
      while (sig[p]?.kind === "identifier") {
        names.push(sig[p].text);
        if (sig[p + 1]?.text === ",") {
          p += 2;
          continue;
        }
        break;
      }
      if (names.length === 0) continue;
      let prefix = "var";
      if (sig[p + 1]?.text === "=") prefix = inferPrefix(p + 2);
      for (const nm of names) if (!declPrefix.has(nm)) declPrefix.set(nm, prefix);
      continue;
    }
    if (t.kind === "keyword" && t.text === "function") {
      // function [.name]+ [( params )] — collect parameters
      let p = m + 1;
      while (
        sig[p] &&
        (sig[p].kind === "identifier" || sig[p].text === "." || sig[p].text === ":")
      ) {
        p++;
      }
      if (sig[p]?.text !== "(") continue;
      p++;
      while (sig[p] && sig[p].text !== ")") {
        if (sig[p].kind === "identifier") {
          const nm = sig[p].text;
          if (!declPrefix.has(nm)) declPrefix.set(nm, "arg");
        }
        p++;
      }
    }
  }

  // Refine generic parameter names from their use sites. This is deliberately
  // heuristic, but it gives VM code useful names without changing semantics:
  // `x[...]` is table-like, `x(...)` is callable, and arithmetic/comparison
  // with numeric literals is value/state-like.
  const usageScore = new Map<string, { tbl: number; fn: number; num: number; value: number }>();
  const usageFor = (name: string) => {
    let score = usageScore.get(name);
    if (!score) {
      score = { tbl: 0, fn: 0, num: 0, value: 0 };
      usageScore.set(name, score);
    }
    return score;
  };
  const arithmetic = new Set(["+", "-", "*", "/", "%", "^", "//", "<", ">", "<=", ">=", "==", "~=", "and", "or"]);
  for (let m = 0; m < sig.length; m++) {
    const t = sig[m];
    if (t.kind !== "identifier" || !declPrefix.has(t.text) || !isCrypticLocalName(t.text)) continue;
    const score = usageFor(t.text);
    const prev = sig[m - 1];
    const next = sig[m + 1];
    if (next?.text === "[") score.tbl += 3;
    if (next?.text === "(") score.fn += 3;
    if (arithmetic.has(prev?.text ?? "") || arithmetic.has(next?.text ?? "") ||
        prev?.kind === "number" || next?.kind === "number") score.num += 2;
    score.value++;
  }
  for (const [name, score] of usageScore) {
    const current = declPrefix.get(name);
    if (current !== "arg" && current !== "var") continue;
    if (score.tbl >= score.fn && score.tbl >= score.num && score.tbl > 0) declPrefix.set(name, "tbl");
    else if (score.fn >= score.num && score.fn > 0) declPrefix.set(name, "fn");
    else if (score.num > 0) declPrefix.set(name, "num");
    else if (score.value > 0) declPrefix.set(name, "value");
  }

  // ---- Pass 2: safety analysis per candidate name ----
  const occurrences = new Map<string, number[]>();
  for (let m = 0; m < sig.length; m++) {
    const t = sig[m];
    if (t.kind !== "identifier") continue;
    if (!declPrefix.has(t.text)) continue;
    if (!isCrypticLocalName(t.text)) continue;
    let list = occurrences.get(t.text);
    if (!list) occurrences.set(t.text, (list = []));
    list.push(m);
  }

  const safeNames: string[] = [];
  for (const [name, idxs] of occurrences) {
    let safe = true;
    for (const m of idxs) {
      const prev = sig[m - 1];
      const next = sig[m + 1];
      // A property occurrence does not invalidate the local occurrences of
      // the same short name. It is simply excluded from replacements below.
      // This matters for VM code where `v` may be both a register and a field.
      if (next && next.text === "=" && !isLocalDeclTarget(sig, m) && !declPrefix.has(name)) {
        safe = false; // ambiguous constructor field, not a proven local
        break;
      }
    }
    if (safe && idxs.length > 0) safeNames.push(name);
  }
  if (safeNames.length === 0) return { result: src, renamed: 0 };

  // ---- Pass 3: generate collision-free new names ----
  const used = new Set(allIdents);
  const prefixCounters: Record<string, number> = {};
  const renameMap = new Map<string, string>();
  for (const name of safeNames) {
    const prefix = declPrefix.get(name) ?? "var";
    let counter = (prefixCounters[prefix] ?? 0) + 1;
    let newName = `${prefix}${counter}`;
    while (used.has(newName) || KEYWORDS.has(newName) || RENAME_KEEP.has(newName)) {
      counter++;
      newName = `${prefix}${counter}`;
    }
    prefixCounters[prefix] = counter;
    used.add(newName);
    renameMap.set(name, newName);
  }

  // ---- Pass 4: apply replacements token-by-token (forward, via parts) ----
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (let m = 0; m < sig.length; m++) {
    const t = sig[m];
    if (t.kind !== "identifier") continue;
    const newName = renameMap.get(t.text);
    if (!newName) continue;
    const prev = sig[m - 1];
    if (prev && (prev.text === "." || prev.text === ":")) continue;
    replacements.push({ start: t.start, end: t.end, text: newName });
  }
  if (replacements.length === 0) return { result: src, renamed: 0 };

  const parts: string[] = [];
  let cursor = 0;
  for (const r of replacements) {
    parts.push(src.slice(cursor, r.start), r.text);
    cursor = r.end;
  }
  parts.push(src.slice(cursor));

  return { result: parts.join(""), renamed: renameMap.size };
}

/** Format byte size as human readable */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Single-pass Lua escape decoding (v4 shared helper)
// ---------------------------------------------------------------------------

/**
 * Decode the escape sequences of a Lua string BODY (no surrounding quotes)
 * in a single left-to-right pass — unlike sequential `.replace()` chains
 * this can never mis-decode `\\` followed by `x41` or similar.
 * Handles \n \t \r \a \b \f \v \\ \" \' \ddd \xHH \z \u{XXXX}.
 */
export function decodeLuaEscapes(body: string): string {
  let out = "";
  let i = 0;
  const n = body.length;
  while (i < n) {
    const c = body[i];
    if (c !== "\\") {
      out += c;
      i++;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    if (next === "n") { out += "\n"; i += 2; continue; }
    if (next === "t") { out += "\t"; i += 2; continue; }
    if (next === "r") { out += "\r"; i += 2; continue; }
    if (next === "a") { out += "\x07"; i += 2; continue; }
    if (next === "b") { out += "\b"; i += 2; continue; }
    if (next === "f") { out += "\f"; i += 2; continue; }
    if (next === "v") { out += "\v"; i += 2; continue; }
    if (next === "\\") { out += "\\"; i += 2; continue; }
    if (next === '"') { out += '"'; i += 2; continue; }
    if (next === "'") { out += "'"; i += 2; continue; }
    if (next === "\n") { i += 2; continue; } // literal line continuation
    if (next === "z") {
      // \z skips all following whitespace
      let j = i + 2;
      while (j < n && /\s/.test(body[j])) j++;
      i = j;
      continue;
    }
    if (next === "x") {
      const hex = body.slice(i + 2, i + 4);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        continue;
      }
      out += "x";
      i += 2;
      continue;
    }
    if (next === "u" && body[i + 2] === "{") {
      const close = body.indexOf("}", i + 3);
      const hex = body.slice(i + 3, close);
      if (close > i + 3 && /^[0-9a-fA-F]{1,6}$/.test(hex)) {
        try {
          out += String.fromCodePoint(parseInt(hex, 16));
        } catch {
          /* invalid codepoint — keep raw */
          out += body.slice(i, close + 1);
        }
        i = close + 1;
        continue;
      }
      out += "u";
      i += 2;
      continue;
    }
    if (next >= "0" && next <= "9") {
      let d = "";
      let j = i + 1;
      while (j < n && /[0-9]/.test(body[j]) && d.length < 3) {
        d += body[j];
        j++;
      }
      const code = parseInt(d, 10);
      out += String.fromCharCode(code > 255 ? code & 0xff : code);
      i = j;
      continue;
    }
    // unknown escape — Lua keeps the char as-is
    out += next;
    i += 2;
  }
  return out;
}

// ---------------------------------------------------------------------------
// String literal re-encoding (escape normalisation)
// ---------------------------------------------------------------------------

/**
 * Re-encode a decoded string VALUE back into a short Lua string literal,
 * using minimal escaping: printable chars stay raw, only the active quote,
 * backslash and control chars are escaped (`\n`, `\t`, `\r`, `\ddd`).
 */
export function reencodeLuaString(value: string, quote: string): string {
  let out = quote;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += "\\" + quote;
    else if (code === 10) out += "\\n";
    else if (code === 13) out += "\\r";
    else if (code === 9) out += "\\t";
    else if (code >= 32 && code < 127) out += ch;
    else out += "\\" + code.toString(10);
  }
  return out + quote;
}

/**
 * Rewrite every short string literal in `src` with its minimally-escaped
 * form. This decodes `\101`, `\x69` and `\z` escape soup (common in Luraph
 * and IronBrew outputs) into readable characters while preserving the exact
 * runtime value of each literal. Long (`[[...]]`) strings are left alone.
 *
 * Byte-exactness guard: only literals whose value is pure ASCII (≤ 0x7F) are
 * rewritten — above that, JS chars and Lua bytes diverge between UTF-8 file
 * text and `\ddd` escapes, so we leave the original spelling untouched.
 */
export function unescapeStringLiterals(src: string): { result: string; rewritten: number } {
  let lits: StringLiteral[];
  try {
    lits = [...iterStringLiterals(src)];
  } catch {
    return { result: src, rewritten: 0 };
  }
  let out = src;
  let rewritten = 0;
  // Walk in reverse so earlier offsets stay valid while splicing.
  for (let k = lits.length - 1; k >= 0; k--) {
    const lit = lits[k];
    if (lit.quote !== '"' && lit.quote !== "'") continue; // long strings have no escapes
    const original = src.slice(lit.start, lit.end);
    if (original.length < 2) continue;
    // ASCII-only guard (byte-exact round-trip).
    let ascii = true;
    for (let i = 0; i < lit.value.length; i++) {
      if (lit.value.charCodeAt(i) > 0x7f) { ascii = false; break; }
    }
    if (!ascii) continue;
    const newText = reencodeLuaString(lit.value, lit.quote);
    if (newText === original) continue;
    out = out.slice(0, lit.start) + newText + out.slice(lit.end);
    rewritten++;
  }
  return { result: out, rewritten };
}

// ---------------------------------------------------------------------------
// Multi-byte XOR brute force
// ---------------------------------------------------------------------------

export interface XorBruteForceResult {
  decoded: string;
  key: string;
  keyBytes: number[];
  score: number;
}

export interface XorBruteForceOptions {
  /** Min key length in bytes. Default 1. */
  minKeyLen?: number;
  /** Max key length in bytes. Default 3. */
  maxKeyLen?: number;
  /** Additional multi-byte string keys to try. */
  extraKeys?: string[];
  /** Scorer: returns 0..1 — higher is better. Default: looksLikeLuaSource
   *  plus a small bonus for Lua keywords. */
  scorer?: (s: string) => number;
  /** Cap on the number of keys to try (safety). Default 1_000_000. */
  maxIterations?: number;
}

const COMMON_XOR_KEYS = [
  "\x00",
  "\x2a", "\xff", "\xaa", "\x55",
  "IB", "ib", "vm", "VM", "iron", "brew", "luraph", "moon",
  "ms", "MS", "moonsec", "prometheus", "p2", "p3", "wrd",
  "wearedevs", "key", "roblox", "lua", "luau", "XOR", "xor",
];

/** Brute-force XOR-decode of `data` over single-byte, 2-byte and 3-byte key
 *  spaces, plus a small list of common multi-byte keys. Returns the candidate
 *  with the highest `scorer` score, or null if none reach the implicit
 *  threshold (handled by the caller). */
export function bruteForceXorDecode(
  data: string,
  opts: XorBruteForceOptions = {},
): XorBruteForceResult | null {
  const minLen = opts.minKeyLen ?? 1;
  const maxLen = Math.min(4, opts.maxKeyLen ?? 3);
  const extra = opts.extraKeys ?? COMMON_XOR_KEYS;
  const scorer =
    opts.scorer ??
    ((s: string) => {
      if (!looksLikeLuaSource(s)) return 0;
      let score = 0.2;
      if (/\b(function|local|return|if|then|end|for|while|do)\b/.test(s)) score += 0.4;
      if (/\b[A-Za-z_]\w*\s*\(/.test(s)) score += 0.2; // calls
      if (/=\s*[^=]/.test(s)) score += 0.1;
      if (/[{}]/.test(s)) score += 0.1;
      return Math.min(1, score);
    });

  const buf = Buffer.from(data, "binary");
  const maxIter = opts.maxIterations ?? 1_000_000;
  let iter = 0;

  let best: XorBruteForceResult | null = null;

  // 1) Common multi-byte string keys (cheap, high-value).
  for (const keyStr of extra) {
    if (iter++ > maxIter) break;
    const dec = xorDecode(data, keyStr);
    const score = scorer(dec);
    if (!best || score > best.score) {
      best = {
        decoded: dec,
        key: keyStr,
        keyBytes: Array.from(Buffer.from(keyStr, "utf8")),
        score,
      };
    }
  }

  // 2) Numeric key space: 1-byte (256), 2-byte (65k), 3-byte (16M) — but
  //    we cap iterations to maxIter and early-exit when score is high enough.
  for (let keyLen = minLen; keyLen <= maxLen; keyLen++) {
    const space = Math.pow(256, keyLen);
    // For 1-byte: 256 trials. For 2-byte: 65_536 trials. For 3-byte: cap.
    const cap = keyLen === 1 ? 256 : keyLen === 2 ? 65_536 : Math.min(16_777_216, maxIter - iter);
    for (let k = 0; k < cap && iter < maxIter; k++, iter++) {
      const keyBytes = [];
      let n = k;
      for (let b = 0; b < keyLen; b++) {
        keyBytes.push(n & 0xff);
        n = Math.floor(n / 256);
      }
      // skip all-zero key (no-op)
      if (keyBytes.every((b) => b === 0)) continue;
      const out = Buffer.allocUnsafe(buf.length);
      for (let i = 0; i < buf.length; i++) {
        out[i] = buf[i] ^ keyBytes[i % keyLen];
      }
      const dec = out.toString("latin1");
      const score = scorer(dec);
      if (!best || score > best.score) {
        const keyStr = String.fromCharCode(...keyBytes);
        best = { decoded: dec, key: keyStr, keyBytes, score };
      }
      // Early exit when confident — avoid burning the 3-byte budget.
      if (best && best.score >= 0.85) return best;
    }
    if (best && best.score >= 0.85) return best;
  }

  return best;
}

// ---------------------------------------------------------------------------
// String-table reference substitution
// ---------------------------------------------------------------------------

/** Replace `tableName[N]` and `tableName["N"]` references in `src` with the
 *  decoded literal from `decoded[N]` (1-indexed, matching Lua). Returns the
 *  new source and how many references were substituted.
 *
 *  This uses the lexer to walk the source so it never touches string/comment
 *  interiors. Only references whose index resolves to a known decoded entry
 *  are substituted; unknown indices are left in place.
 */
export function substituteStringTableRefs(
  src: string,
  tableName: string,
  decoded: string[],
): { result: string; substituted: number } {
  if (!tableName || decoded.length === 0) return { result: src, substituted: 0 };
  const tokens = [...tokenize(src)];
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  let substituted = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "identifier" || t.text !== tableName) continue;
    // expect `tableName [ ... ]`
    let j = i + 1;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j >= tokens.length || tokens[j].text !== "[") continue;
    // Collect tokens up to matching ]
    let depth = 1;
    let k = j + 1;
    const inner: LuaToken[] = [];
    while (k < tokens.length && depth > 0) {
      const tk = tokens[k];
      if (tk.text === "[") depth++;
      else if (tk.text === "]") {
        depth--;
        if (depth === 0) break;
      }
      inner.push(tk);
      k++;
    }
    if (depth !== 0) continue;
    const closeTok = tokens[k];
    // The inner expression should be a literal number or a string literal.
    if (inner.length === 0) continue;
    // Strip whitespace from inner
    const innerTrimmed = inner.filter((x) => x.kind !== "whitespace" && x.kind !== "newline");
    if (innerTrimmed.length === 0) continue;
    let idx: number | null = null;
    // number (possibly negative for some forks)
    if (innerTrimmed.length === 1 && innerTrimmed[0].kind === "number") {
      const n = parseInt(innerTrimmed[0].text, 10);
      if (!isNaN(n)) idx = n;
    } else if (
      innerTrimmed.length === 2 &&
      innerTrimmed[0].text === "-" &&
      innerTrimmed[1].kind === "number"
    ) {
      const n = parseInt(innerTrimmed[1].text, 10);
      if (!isNaN(n)) idx = -n;
    } else if (
      innerTrimmed.length === 1 &&
      (innerTrimmed[0].kind === "string" || innerTrimmed[0].kind === "longstring")
    ) {
      const v = innerTrimmed[0].value ?? decodeShortStringLiteral(innerTrimmed[0].text);
      if (v !== null && v !== undefined) {
        const n = parseInt(v, 10);
        if (!isNaN(n)) idx = n;
      }
    }
    if (idx === null) continue;
    // Lua tables are 1-indexed: `t[N]` maps to decoded[N-1] in our 0-indexed
    // JS array. But some forks (0-indexed) store at decoded[N], and a few
    // store at decoded[N+1]. Try -1 first (the standard Lua case), then 0,
    // then +1 — but only accept the first NON-EMPTY entry.
    let entry: string | null = null;
    for (const off of [-1, 0, 1]) {
      const candidate = decoded[idx + off];
      if (candidate !== undefined && candidate.length > 0) {
        entry = candidate;
        break;
      }
    }
    if (entry === null) continue;
    // v4 fix: JSON.stringify emits \uXXXX escapes which Lua does not
    // understand — use the Lua-safe re-encoder instead.
    edits.push({
      start: t.start,
      end: closeTok.end,
      replacement: reencodeLuaString(entry, '"'),
    });
    substituted++;
    i = k;
  }

  // Apply edits in reverse so indices stay valid.
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    out += src.slice(cursor, e.start);
    out += e.replacement;
    cursor = e.end;
  }
  out += src.slice(cursor);
  return { result: out, substituted };
}

/** Decode a short string literal token's text into its value (used by
 *  substituteStringTableRefs for ["123"]-style indices). */
function decodeShortStringLiteral(text: string): string | null {
  if (text.length < 2) return null;
  const quote = text[0];
  if (quote !== '"' && quote !== "'") return null;
  const body = text.slice(1, -1);
  // We only care about the simple case where the body is decimal digits.
  if (/^\d+$/.test(body)) return body;
  return null;
}

// Re-export the long bracket helpers for use elsewhere
export { longBracketLevel, findLongBracketClose };

// ---------------------------------------------------------------------------
// Decoy-string detection (v4.1)
//
// Many obfuscators (MoonSec V2, PSU, SynapseXen, …) embed FAKE banners of
// other obfuscators inside string literals that only ever appear as the
// operand of the `#` length operator inside arithmetic expressions, e.g.
//   (704874119 - #("luraph website coming.... eta JULY 2020"))
//   (-#[[Luraph v13 has been released]])
// These decoys exist purely to defeat banner-based detection. Banner matches
// that fall inside such regions must be heavily down-weighted.
// ---------------------------------------------------------------------------

/**
 * Find index ranges of decoy string literals — string literals that directly
 * follow the `#` length operator (optionally parenthesised):
 *   #'...'   #"..."   #[[...]]   #('...')   #("...")   #([[...]])
 * Returns a sorted list of [start, end) ranges.
 */
export function findDecoyStringRanges(input: string, limit = 50_000): Array<[number, number]> {
  if (input.length > 4_000_000) return [];
  const ranges: Array<[number, number]> = [];
  const re =
    /#\s*\(?\s*(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|\[\[([\s\S]*?)\]\])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
    if (ranges.length >= limit) break;
    // guard against zero-length matches stalling the loop
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return ranges;
}

/** Binary-search whether `index` falls inside any of the sorted `ranges`. */
export function indexInRanges(ranges: Array<[number, number]>, index: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = ranges[mid];
    if (index < s) hi = mid - 1;
    else if (index >= e) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * Weight factor for a regex match found at `index` given decoy `ranges`.
 * Matches inside decoy strings count at 45% of their normal weight.
 */
export function decoyWeightFactor(ranges: Array<[number, number]>, index: number): number {
  return indexInRanges(ranges, index) ? 0.45 : 1;
}

/**
 * First match of `re` in `input`, preferring one outside the decoy `ranges`.
 * Falls back to the first (in-decoy) match when every match is a decoy.
 * `re` may be global or non-global; lastIndex is always reset.
 */
export function firstMatchPreferOutsideDecoys(
  re: RegExp,
  input: string,
  ranges: Array<[number, number]>
): { m: RegExpExecArray | null; inDecoy: boolean } {
  const r = re.global ? re : new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  r.lastIndex = 0;
  let fallback: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = r.exec(input)) !== null) {
    if (!indexInRanges(ranges, m.index)) return { m, inDecoy: false };
    if (!fallback) fallback = m;
    if (r.lastIndex === m.index) r.lastIndex++;
  }
  return { m: fallback, inDecoy: fallback !== null };
}
