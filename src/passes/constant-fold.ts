// Constant-folding engine for deobfuscated Lua/Luau source.
//
// Obfuscators love to split string literals across concatenation, hide names
// behind _G["..."] / getgenv()["..."], and wrap trivial values in calls like
// string.char / string.byte / string.sub / string.rep / string.reverse /
// string.format / tonumber / tostring / bit32.* . This module folds those
// back into literals so the recovered source is actually readable.
//
// It also performs safe dead-code elimination for `if false then ... end`,
// `if true then X else Y end` → `X`, and `while false do ... end`.
//
// Safety:
//   - Uses the real Lua lexer so it NEVER touches the inside of strings,
//     long strings, comments, or numbers.
//   - Every fold is gated by a try/catch so a single bad pattern cannot
//     break the whole pass.
//   - Returns the original source unchanged on any unexpected error.
//
// The engine is idempotent: running it twice produces the same output as
// running it once (because there is nothing left to fold the second time).

import {
  tokenize,
  LuaToken,
  longBracketLevel,
  findLongBracketClose,
} from "../utils/lua-utils";
import { evalExprFromTokens, evalUnaryFromTokens, constToLua, nextSignificant } from "../utils/const-eval";
import { propagateImmutableLocals } from "./advanced-cleanup";

export interface FoldResult {
  result: string;
  /** Total number of successful folds applied. */
  folded: number;
  /** Human-readable notes for the run. */
  notes: string[];
}

/**
 * Run the full constant-folding pipeline. The pipeline is a fixed sequence
 * of passes; each pass is small and well-tested. Between passes we re-tokenise
 * so later passes see the folded output of earlier ones.
 */
export function foldConstants(src: string, maxPasses = 3): FoldResult {
  let work = src;
  let totalFolded = 0;
  const notes: string[] = [];

  for (let pass = 1; pass <= maxPasses; pass++) {
    let passFolded = 0;
    const before = work;

    // Pass N (new): full const-evaluator noise folding — runs FIRST so
    // later passes see plain literals (#"msg" arithmetic, IIFE strings, ...).
    const n = foldConstEvalNoise(work);
    passFolded += n.folded;
    if (n.folded > 0) notes.push(...n.notes);
    work = n.result;

    const a = foldStringConcatLiterals(work);
    passFolded += a.folded;
    if (a.folded > 0) notes.push(...a.notes);
    work = a.result;

    const b = foldStringLibraryCalls(work);
    passFolded += b.folded;
    if (b.folded > 0) notes.push(...b.notes);
    work = b.result;

    const c = foldNumberStringConv(work);
    passFolded += c.folded;
    if (c.folded > 0) notes.push(...c.notes);
    work = c.result;

    const d = foldBitCalls(work);
    passFolded += d.folded;
    if (d.folded > 0) notes.push(...d.notes);
    work = d.result;

    const e = foldArithmeticLiterals(work);
    passFolded += e.folded;
    if (e.folded > 0) notes.push(...e.notes);
    work = e.result;

    const e2 = foldParensAroundLiteral(work);
    passFolded += e2.folded;
    if (e2.folded > 0) notes.push(...e2.notes);
    work = e2.result;

    const e3 = foldSingleElementTableIndex(work);
    passFolded += e3.folded;
    if (e3.folded > 0) notes.push(...e3.notes);
    work = e3.result;

    const f = foldGlobalIndexing(work);
    passFolded += f.folded;
    if (f.folded > 0) notes.push(...f.notes);
    work = f.result;

    const g = foldDeadCode(work);
    passFolded += g.folded;
    if (g.folded > 0) notes.push(...g.notes);
    work = g.result;

    const h = propagateImmutableLocals(work);
    passFolded += h.changed;
    if (h.changed > 0) notes.push(...h.notes);
    work = h.result;

    totalFolded += passFolded;
    if (work === before) break; // fixed point reached
  }

  return { result: work, folded: totalFolded, notes };
}

// ---------------------------------------------------------------------------
// Pass A: fold "a" .. "b" .. "c" → "abc"
// ---------------------------------------------------------------------------

/** Fold literal-string concatenations like "a" .. "b" .. "c". */
export function foldStringConcatLiterals(src: string): FoldResult {
  const tokens = [...tokenize(src)];
  let folded = 0;
  const notes: string[] = [];
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  let i = 0;
  while (i < tokens.length) {
    const first = tokens[i];
    if (first.kind !== "string" && first.kind !== "longstring") {
      i++;
      continue;
    }
    let j = i + 1;
    const parts: LuaToken[] = [first];
    while (j < tokens.length) {
      while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
      if (j >= tokens.length || tokens[j].kind !== "operator" || tokens[j].text !== "..") break;
      j++;
      while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
      if (j >= tokens.length || (tokens[j].kind !== "string" && tokens[j].kind !== "longstring")) break;
      parts.push(tokens[j]);
      j++;
    }
    if (parts.length < 2) {
      i++;
      continue;
    }
    let combined = "";
    let ok = true;
    for (const p of parts) {
      const v = decodeStringToken(p, src);
      if (v === null) { ok = false; break; }
      combined += v;
    }
    if (!ok) { i = j; continue; }
    const replacement = encodeLuaString(combined);
    // v4.1: never let a fold GROW the file. Merging a chain of payload
    // strings re-encodes every junk byte as \ddd (4 chars/byte), which can
    // be 4× the original span — skip those chains entirely.
    const span = parts[parts.length - 1].end - first.start;
    if (replacement.length > Math.max(64, span * 1.1)) { i = j; continue; }
    edits.push({ start: first.start, end: parts[parts.length - 1].end, replacement });
    folded++;
    i = j;
  }

  const result = applyEdits(src, edits);
  if (folded > 0) notes.push(`Folded ${folded} literal string concatenation chain(s).`);
  return { result, folded, notes };
}

// ---------------------------------------------------------------------------
// Pass B: fold string.<method>(literal, ...)
// ---------------------------------------------------------------------------

/** Fold calls to string.char / string.byte / string.sub / string.rep /
 * string.reverse / string.lower / string.upper / string.format with literal args. */
export function foldStringLibraryCalls(src: string): FoldResult {
  const tokens = [...tokenize(src)];
  let folded = 0;
  const notes: string[] = [];
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "identifier" || t.text !== "string") continue;
    let j = i + 1;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j >= tokens.length || tokens[j].text !== ".") continue;
    j++;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j >= tokens.length || tokens[j].kind !== "identifier") continue;
    const method = tokens[j].text;
    j++;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j >= tokens.length || tokens[j].text !== "(") continue;
    const argEnd = findMatchingParen(tokens, j);
    if (argEnd < 0) continue;
    const args = splitArgs(tokens, j + 1, argEnd);
    const foldedVal = tryFoldStringCall(method, args, src);
    if (foldedVal === null || foldedVal === undefined) continue;
    const replacement = formatLuaValue(foldedVal);
    edits.push({ start: t.start, end: tokens[argEnd].end, replacement });
    folded++;
  }

  const result = applyEdits(src, edits);
  if (folded > 0) notes.push(`Folded ${folded} string.* library call(s).`);
  return { result, folded, notes };
}

// ---------------------------------------------------------------------------
// Pass C: tonumber / tostring
// ---------------------------------------------------------------------------

export function foldNumberStringConv(src: string): FoldResult {
  const tokens = [...tokenize(src)];
  let folded = 0;
  const notes: string[] = [];
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "identifier") continue;
    if (t.text !== "tonumber" && t.text !== "tostring") continue;
    let j = i + 1;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j >= tokens.length || tokens[j].text !== "(") continue;
    const argEnd = findMatchingParen(tokens, j);
    if (argEnd < 0) continue;
    const args = splitArgs(tokens, j + 1, argEnd);
    const v = tryFoldConv(t.text, args, src);
    if (v === null || v === undefined) continue;
    edits.push({ start: t.start, end: tokens[argEnd].end, replacement: formatLuaValue(v) });
    folded++;
  }

  const result = applyEdits(src, edits);
  if (folded > 0) notes.push(`Folded ${folded} tonumber()/tostring() call(s).`);
  return { result, folded, notes };
}

// ---------------------------------------------------------------------------
// Pass D: bit32 / bit calls
// ---------------------------------------------------------------------------

export function foldBitCalls(src: string): FoldResult {
  const tokens = [...tokenize(src)];
  let folded = 0;
  const notes: string[] = [];
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "identifier") continue;
    if (t.text !== "bit32" && t.text !== "bit") continue;
    let j = i + 1;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j >= tokens.length || tokens[j].text !== ".") continue;
    j++;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j >= tokens.length || tokens[j].kind !== "identifier") continue;
    const method = tokens[j].text;
    j++;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j >= tokens.length || tokens[j].text !== "(") continue;
    const argEnd = findMatchingParen(tokens, j);
    if (argEnd < 0) continue;
    const args = splitArgs(tokens, j + 1, argEnd);
    const v = tryFoldBit(method, args, src);
    if (v === null || v === undefined) continue;
    edits.push({ start: t.start, end: tokens[argEnd].end, replacement: formatLuaValue(v) });
    folded++;
  }

  const result = applyEdits(src, edits);
  if (folded > 0) notes.push(`Folded ${folded} bit32/bit.* call(s).`);
  return { result, folded, notes };
}

// ---------------------------------------------------------------------------
// Pass E: arithmetic on literal numbers
// ---------------------------------------------------------------------------

/**
 * Fold constant arithmetic/comparison expressions with REAL Lua precedence
 * via the const-evaluator (v4 — replaces the JS `Function()` eval that got
 * `7 // 2 * 3` wrong by flooring at the end instead of per-division).
 *   `1 + 2` → 3, `0xFF | 0x0F` → …, `-805 + 0x1A7163bf960` → …,
 *   `7 // 2 * 3` → 9, `2^3^2` → 512, `"a".."b"` handled by Pass A.
 * Only expressions containing at least one operator and evaluating to a
 * scalar literal are rewritten.
 */
export function foldArithmeticLiterals(src: string): FoldResult {
  const tokens = [...tokenize(src)];
  let folded = 0;
  const notes: string[] = [];
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  const FOLD_OPS = new Set([
    "+", "-", "*", "/", "%", "^", "//", "&", "|", "~", "<<", ">>", "..",
    "==", "~=", "<", "<=", ">", ">=", "and", "or", "not", "#",
  ]);

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "eof") break;
    if (t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment") {
      i++;
      continue;
    }
    // candidate start: a number, string, or a unary `-`/`+`/`#` before one.
    const bareLiteral =
      t.kind === "number" || t.kind === "string" || t.kind === "longstring";
    const isCandidateStart =
      bareLiteral ||
      (t.kind === "punct" && (t.text === "-" || t.text === "+") && isUnarySignContext(tokens, i)) ||
      (t.kind === "punct" && t.text === "#");
    if (!isCandidateStart) {
      i++;
      continue;
    }

    // v4 grouping guard: a BARE literal that is the RIGHT operand of a
    // preceding tighter-binding operator must not start a fold —
    // `x - 1 + 2` is `(x-1)+2`, NOT `x-(1+2)`. Operators looser than the
    // arithmetic group (`..`, comparisons, and/or) leave the literal free.
    if (bareLiteral) {
      const pIdx = lastSignificantBefore(tokens, i);
      const p = pIdx >= 0 ? tokens[pIdx] : null;
      const TIGHTER = new Set(["+", "-", "*", "/", "%", "^", "//", "&", "|", "~", "<<", ">>", "not", "#"]);
      if (p && (TIGHTER.has(p.text))) {
        i++;
        continue;
      }
      // a unary -/+ directly before also means an earlier anchor covers it
      if (p && p.kind === "punct" && (p.text === "-" || p.text === "+")) {
        i++;
        continue;
      }
    }

    const ev = evalExprFromTokens(tokens, i);
    if (!ev) {
      i++;
      continue;
    }
    // The expression must contain at least one folding operator between
    // start and end, otherwise it's a bare literal — leave untouched.
    let opCount = 0;
    for (let k = i; k < ev.endIndex && k < tokens.length; k++) {
      const tk = tokens[k];
      if (tk.kind === "whitespace" || tk.kind === "newline" || tk.kind === "comment" || tk.kind === "longcomment") continue;
      if (tk.kind === "operator" || tk.kind === "punct") {
        if (FOLD_OPS.has(tk.text)) opCount++;
      } else if (tk.kind === "keyword" && FOLD_OPS.has(tk.text)) {
        opCount++;
      }
    }
    if (opCount === 0) {
      i = Math.max(ev.endIndex, i + 1);
      continue;
    }
    // Scalar result only (numbers/strings/booleans; ident results may be
    // partial or depend on runtime values).
    if (ev.value.k === "ident" || ev.value.k === "table" || ev.value.k === "func" || ev.value.k === "nil") {
      i = Math.max(ev.endIndex, i + 1);
      continue;
    }
    const lit = constToLua(ev.value);
    if (lit === null || lit === src.slice(t.start, ev.endOffset)) {
      i = Math.max(ev.endIndex, i + 1);
      continue;
    }
    // v4.1 growth guard (same rule as Pass A): a folded string concat must
    // never re-encode junk payload bytes into a LONGER escaped literal.
    const spanLen = ev.endOffset - t.start;
    if (lit.length > Math.max(64, spanLen * 1.1)) {
      i = Math.max(ev.endIndex, i + 1);
      continue;
    }
    // Never fold a numeric result that is not finite (constToLua already
    // refuses those, this is a second guard).
    if (ev.value.k === "number" && !Number.isFinite(ev.value.v)) {
      i = Math.max(ev.endIndex, i + 1);
      continue;
    }
    edits.push({
      start: t.start,
      end: ev.endOffset,
      replacement: spacePad(src, t.start, ev.endOffset, lit),
    });
    folded++;
    i = Math.max(ev.endIndex, i + 1);
  }

  const result = applyEdits(src, edits);
  if (folded > 0) notes.push(`Folded ${folded} literal arithmetic expression(s).`);
  return { result, folded, notes };
}

// ---------------------------------------------------------------------------
// Pass F: _G["x"] / getgenv()["x"] / debug["x"] resolution
// ---------------------------------------------------------------------------

/** Resolve `_G["loadstring"]` → `_G.loadstring`, `getgenv()["FireServer"]` →
 *  `getgenv().FireServer`. We pick the dot/colon form based on the receiver:
 *  bare globals (e.g. `_G`) use `.name`, call results (e.g. `getgenv()`) use
 *  `.name` too (Lua allows `getgenv().name`). */
export function foldGlobalIndexing(src: string): FoldResult {
  const tokens = [...tokenize(src)];
  let folded = 0;
  const notes: string[] = [];
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  const knownGlobals = new Set([
    "_G", "_ENV", "getgenv", "getfenv", "debug", "os", "math", "table",
    "coroutine", "io", "package", "utf8", "buffer",
  ]);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "identifier") continue;
    if (!knownGlobals.has(t.text)) continue;
    let j = i + 1;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j >= tokens.length || tokens[j].text !== "[") continue;
    const keyTok = tokens[j + 1] ?? tokens[j];
    if (keyTok.kind !== "string" && keyTok.kind !== "longstring") continue;
    let k = j + 2;
    while (k < tokens.length && (tokens[k].kind === "whitespace" || tokens[k].kind === "newline")) k++;
    if (k >= tokens.length || tokens[k].text !== "]") continue;
    const keyVal = decodeStringToken(keyTok, src);
    if (keyVal === null) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyVal)) continue;
    if (isReservedKeyword(keyVal)) continue;
    const close = tokens[k];
    edits.push({ start: t.start, end: close.end, replacement: `${t.text}.${keyVal}` });
    folded++;
    i = k;
  }

  const result = applyEdits(src, edits);
  if (folded > 0) notes.push(`Resolved ${folded} global table indirection (e.g. _G["x"] → _G.x).`);
  return { result, folded, notes };
}

// ---------------------------------------------------------------------------
// Pass G: dead-code elimination
// ---------------------------------------------------------------------------

/** Eliminate obviously-dead branches:
 *    `if false then ... end`           → remove
 *    `if nil   then ... end`           → remove
 *    `if true  then A else B end`     → A
 *    `if true  then A end`             → A
 *    `while false do ... end`         → remove
 *
 *  v4 scope safety: `if true then local x = 1 end` unwrapped to
 *  `local x = 1` would LEAK the local into the enclosing scope (code after
 *  the block that references the same name would capture it). When the kept
 *  body declares locals or functions, we keep a `do ... end` wrapper so
 *  scoping is byte-for-byte identical.
 */
export function foldDeadCode(src: string): FoldResult {
  let work = src;
  let folded = 0;
  const notes: string[] = [];

  // Bounded iteration: stop once a full sweep makes no changes.
  for (let iter = 0; iter < 10; iter++) {
    // 1) `if false then ... end` / `if nil then ... end` → remove
    const r1 = matchBalancedIf(work, (cond) => isFalsyLiteral(cond), /*wantThen*/ false);
    if (r1) {
      work = work.slice(0, r1.start) + work.slice(r1.end);
      folded++;
      continue;
    }
    // 2) `if true then A else B end` → A ; `if true then A end` → A
    const r2 = matchBalancedIf(work, (cond) => cond.trim() === "true", /*wantThen*/ true);
    if (r2 && r2.thenBody !== null) {
      const kept = r2.thenBody;
      // Any `local`/`function` declaration inside the kept body introduces
      // block scope — keep a `do ... end` wrapper so nothing leaks.
      const declaresScope = /\blocal\b|\bfunction\b/.test(kept);
      const replacement = declaresScope ? `do ${kept} end` : kept;
      work = work.slice(0, r2.start) + replacement + work.slice(r2.end);
      folded++;
      continue;
    }
    // 3) `while false do ... end` → remove
    const r3 = matchBalancedWhileFalse(work);
    if (r3) {
      work = work.slice(0, r3.start) + work.slice(r3.end);
      folded++;
      continue;
    }
    break;
  }

  if (folded > 0) notes.push(`Eliminated ${folded} dead-code branch(es).`);
  return { result: work, folded, notes };
}

// ---------------------------------------------------------------------------
// Pass H: unwrap parens around a single literal — `(-805)` → `-805`
// ---------------------------------------------------------------------------

/** `(-805)` → `-805`, `(3.32e2)` → `3.32e2`. Only single number/string
 *  literals (optionally signed) are unwrapped. Skips when followed by `^`
 *  (unary minus binds lower than `^` in Lua, so unwrapping would change
 *  `(-2)^2` into `-2^2`). */
export function foldParensAroundLiteral(src: string): FoldResult {
  const tokens = [...tokenize(src)];
  let folded = 0;
  const notes: string[] = [];
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "punct" || t.text !== "(") continue;
    const close = findMatchingParen(tokens, i);
    if (close < 0) continue;

    let j = i + 1;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j >= close) continue; // empty ()
    let contentStart = j;
    // optional leading sign
    if (tokens[j].kind === "punct" && (tokens[j].text === "-" || tokens[j].text === "+")) {
      j++;
      while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
      contentStart = j; // placeholder; fixed below
    }
    if (j >= close) continue;
    if (tokens[j].kind !== "number" && tokens[j].kind !== "string" && tokens[j].kind !== "longstring") continue;
    const litEnd = tokens[j].end;
    j++;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j !== close) continue; // more than one token inside

    // recompute content start (sign included)
    let s = i + 1;
    while (s < tokens.length && (tokens[s].kind === "whitespace" || tokens[s].kind === "newline")) s++;

    // `^` guard: `(-2)^2` ≠ `-2^2`
    let k = close + 1;
    while (k < tokens.length && (tokens[k].kind === "whitespace" || tokens[k].kind === "newline")) k++;
    if (k < tokens.length && tokens[k].text === "^") continue;

    // Call-syntax guard: `(` preceded by an identifier / literal / closing
    // bracket is a CALL paren (`R((-18308))`), not a grouping paren —
    // unwrapping would turn the call into arithmetic.
    let p = i - 1;
    while (p >= 0 && (tokens[p].kind === "whitespace" || tokens[p].kind === "newline")) p--;
    if (p >= 0) {
      const prev = tokens[p];
      const callish =
        prev.kind === "identifier" || prev.kind === "number" ||
        prev.kind === "string" || prev.kind === "longstring" ||
        prev.text === ")" || prev.text === "]" || prev.text === "}";
      if (callish) continue;
      // `--` guard: unwrapping `(-X)` right after a binary `-` would produce
      // `--X`, which Lua lexes as a comment.
      if (prev.kind === "punct" && prev.text === "-" && tokens[s].text === "-") continue;
    }

    edits.push({
      start: t.start,
      end: tokens[close].end,
      replacement: spacePad(src, t.start, tokens[close].end, src.slice(tokens[s].start, litEnd)),
    });
    folded++;
    i = close;
  }

  const result = applyEdits(src, edits);
  if (folded > 0) notes.push(`Unwrapped ${folded} paren-wrapped literal(s).`);
  return { result, folded, notes };
}

// ---------------------------------------------------------------------------
// Pass I: unwrap `({EXPR})[1]` → EXPR (single-element table constructor)
// ---------------------------------------------------------------------------

/** `({25.0})[1]` → `25.0`, `({-805+0x1A7163bf960})[1]` → `-805+0x1A7163bf960`.
 *  Obfuscators (mcr4, VM soup) wrap constants in 1-element table constructors
 *  indexed [1]. The table build + index is pure, so unwrapping is safe.
 *  Only unwraps when the index is the literal `1` and the table body has a
 *  single top-level element (no `,`/`;` separators at depth 0). */
export function foldSingleElementTableIndex(src: string): FoldResult {
  const tokens = [...tokenize(src)];
  let folded = 0;
  const notes: string[] = [];
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "punct" || t.text !== "(") continue;
    const close = findMatchingParen(tokens, i);
    if (close < 0) continue;

    // inside must be a single `{ ... }` table constructor
    let j = i + 1;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    if (j >= tokens.length || tokens[j].kind !== "punct" || tokens[j].text !== "{") continue;
    const braceClose = findMatchingBrace(tokens, j);
    if (braceClose < 0 || braceClose >= close) continue;
    // nothing but ws between `}` and `)`
    let k = braceClose + 1;
    while (k < tokens.length && (tokens[k].kind === "whitespace" || tokens[k].kind === "newline")) k++;
    if (k !== close) continue;

    // after `)` must come `[ 1 ]`
    k = close + 1;
    while (k < tokens.length && (tokens[k].kind === "whitespace" || tokens[k].kind === "newline")) k++;
    if (k >= tokens.length || tokens[k].text !== "[") continue;
    k++;
    while (k < tokens.length && (tokens[k].kind === "whitespace" || tokens[k].kind === "newline")) k++;
    if (k >= tokens.length || tokens[k].kind !== "number") continue;
    const idxNum = parseLuaNumber(tokens[k].text);
    if (idxNum !== 1) continue;
    k++;
    while (k < tokens.length && (tokens[k].kind === "whitespace" || tokens[k].kind === "newline")) k++;
    if (k >= tokens.length || tokens[k].text !== "]") continue;
    const bracketEnd = tokens[k];

    // table body: single top-level element — walk from j+1 to braceClose-1,
    // tracking nesting; bail on `,`/`;` at depth 0.
    let a = j + 1;
    while (a < tokens.length && (tokens[a].kind === "whitespace" || tokens[a].kind === "newline")) a++;
    if (a >= braceClose) continue; // empty table
    const contentStart = tokens[a].start;
    let depth = 0;
    let b = a;
    let contentEnd = -1;
    let single = true;
    while (b < braceClose) {
      const tk = tokens[b];
      if (tk.kind === "punct" || tk.kind === "operator") {
        if (tk.text === "(" || tk.text === "{" || tk.text === "[") depth++;
        else if (tk.text === ")" || tk.text === "}" || tk.text === "]") depth--;
        else if (depth === 0 && (tk.text === "," || tk.text === ";")) { single = false; break; }
      }
      if (tk.kind !== "whitespace" && tk.kind !== "newline") contentEnd = tk.end;
      b++;
    }
    if (!single || contentEnd < 0) continue;
    // skip if the element is an explicit key-value form `[k]=v` at top level
    const contentText = src.slice(contentStart, contentEnd).trim();
    if (/^\[\s*(?:"(?:\\.|[^"\\])*"|'[^']*'|[A-Za-z0-9_]+)\s*\]\s*=/.test(contentText)) continue;

    // `--` guard: `X` starting with `-` right after a binary `-` would form a comment.
    // Call-syntax guard: `(` preceded by identifier/literal/closing-bracket is
    // a call paren (`f({X})[1]`), not a grouping paren.
    let p = i - 1;
    while (p >= 0 && (tokens[p].kind === "whitespace" || tokens[p].kind === "newline")) p--;
    if (p >= 0) {
      const prev = tokens[p];
      const callish =
        prev.kind === "identifier" || prev.kind === "number" ||
        prev.kind === "string" || prev.kind === "longstring" ||
        prev.text === ")" || prev.text === "]" || prev.text === "}";
      if (callish) continue;
      if (prev.kind === "punct" && prev.text === "-" && contentText.startsWith("-")) continue;
    }

    edits.push({
      start: t.start,
      end: bracketEnd.end,
      replacement: spacePad(src, t.start, bracketEnd.end, contentText),
    });
    folded++;
    i = k;
  }

  const result = applyEdits(src, edits);
  if (folded > 0) notes.push(`Unwrapped ${folded} single-element table index ({{{expr}}}[1]).`);
  return { result, folded, notes };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pad a replacement with spaces when it would otherwise fuse with a
 *  neighbouring word character. Removing brackets can otherwise turn
 *  `if(575)` → `if575` (one identifier!) or `({0xA})[1]end` → `0xAend`
 *  (hex number eats the `e`). */
function spacePad(src: string, start: number, end: number, replacement: string): string {
  let out = replacement;
  if (start > 0 && /[A-Za-z0-9_]/.test(src[start - 1])) out = " " + out;
  if (end < src.length && /[A-Za-z0-9_]/.test(src[end])) out = out + " ";
  return out;
}

/** Whether the punct token at index i (a `-`/`+`) is in unary position. */
function isUnarySignContext(tokens: LuaToken[], i: number): boolean {
  let p = i - 1;
  while (p >= 0 && (tokens[p].kind === "whitespace" || tokens[p].kind === "newline")) p--;
  if (p < 0) return true;
  const t = tokens[p];
  if (t.kind === "number" || t.kind === "string" || t.kind === "longstring" || t.kind === "identifier") return false;
  if (t.text === ")" || t.text === "]" || t.text === "}") return false;
  return true; // operators, punctuation, keywords → unary context
}

/** Find the index of the `}` matching the `{` at token index i. -1 if none. */
function findMatchingBrace(tokens: LuaToken[], i: number): number {
  let depth = 0;
  for (let k = i; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind === "punct" || t.kind === "operator") {
      if (t.text === "{") depth++;
      else if (t.text === "}") {
        depth--;
        if (depth === 0) return k;
      }
    }
  }
  return -1;
}

interface BalancedIfMatch {
  start: number;
  end: number;
  cond: string;
  thenBody: string | null;
  elseBody: string | null;
}

/** Find the first `if <cond> then ... end` whose <cond> satisfies `pred`.
 *  Returns positions of the whole `if ... end` block.
 *  When `wantThen` is true, also captures the then/else bodies (trimmed). */
function matchBalancedIf(
  src: string,
  pred: (cond: string) => boolean,
  wantThen: boolean
): BalancedIfMatch | null {
  const tokens = [...tokenize(src)];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== "keyword" || tokens[i].text !== "if") continue;
    let j = i + 1;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    const condStart = j;
    while (j < tokens.length && !(tokens[j].kind === "keyword" && tokens[j].text === "then")) j++;
    if (j >= tokens.length) continue;
    const cond = src.slice(tokens[condStart].start, tokens[j].start).trim();
    if (!pred(cond)) continue;

    // Walk to matching `end`, tracking nested blocks. We also detect the
    // FIRST `else` at depth 1 (so `elseif` chains are not handled — they
    // remain in place, which is safe).
    //
    // Block openers in Lua: `if`, `function`, `do` (closes with `end`) and
    // `repeat` (closes with `until`). `for`/`while` are NOT openers — their
    // block is opened by the trailing `do`. `then`/`else`/`elseif` are
    // syntax, not openers.
    let depth = 1;
    let k = j + 1;
    let elseIdx = -1;
    while (k < tokens.length && depth > 0) {
      const tk = tokens[k];
      if (tk.kind === "keyword") {
        if (tk.text === "if" || tk.text === "function" || tk.text === "do") {
          depth++;
        } else if (tk.text === "repeat") {
          depth++;
        } else if (tk.text === "until") {
          depth--;
        } else if (tk.text === "end") {
          depth--;
          if (depth === 0) break;
        } else if (depth === 1 && tk.text === "else" && elseIdx < 0) {
          elseIdx = k;
        }
        // `elseif` at depth 1 means the if is NOT a simple then/else — bail.
        else if (depth === 1 && tk.text === "elseif" && elseIdx < 0) {
          elseIdx = -2; // sentinel
          break;
        }
      }
      k++;
    }
    if (depth !== 0) continue;
    if (elseIdx === -2) continue; // elseif chain
    const blockEnd = k; // index of closing `end`

    let thenBody: string | null = null;
    let elseBody: string | null = null;
    if (wantThen) {
      if (elseIdx >= 0) {
        thenBody = src.slice(tokens[j].end, tokens[elseIdx].start).trim();
        elseBody = src.slice(tokens[elseIdx].end, tokens[blockEnd].start).trim();
      } else {
        thenBody = src.slice(tokens[j].end, tokens[blockEnd].start).trim();
      }
    }
    return {
      start: tokens[i].start,
      end: tokens[blockEnd].end,
      cond,
      thenBody,
      elseBody,
    };
  }
  return null;
}

function matchBalancedWhileFalse(src: string): { start: number; end: number } | null {
  const tokens = [...tokenize(src)];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== "keyword" || tokens[i].text !== "while") continue;
    let j = i + 1;
    while (j < tokens.length && (tokens[j].kind === "whitespace" || tokens[j].kind === "newline")) j++;
    const condStart = j;
    while (j < tokens.length && !(tokens[j].kind === "keyword" && tokens[j].text === "do")) j++;
    if (j >= tokens.length) continue;
    const cond = src.slice(tokens[condStart].start, tokens[j].start).trim();
    if (cond !== "false" && cond !== "nil") continue;
    let depth = 1;
    let k = j + 1;
    while (k < tokens.length && depth > 0) {
      const tk = tokens[k];
      if (tk.kind === "keyword") {
        // `for`/`while` are NOT openers — their trailing `do` is.
        if (tk.text === "if" || tk.text === "function" ||
            tk.text === "do" || tk.text === "repeat") depth++;
        else if (tk.text === "until") depth--;
        else if (tk.text === "end") depth--;
      }
      k++;
    }
    if (depth !== 0) continue;
    return { start: tokens[i].start, end: tokens[k - 1].end };
  }
  return null;
}

function isFalsyLiteral(s: string): boolean {
  const t = s.trim();
  return t === "false" || t === "nil";
}

function isReservedKeyword(s: string): boolean {
  const KW = new Set([
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
    "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
    "true", "until", "while",
  ]);
  return KW.has(s);
}

/** Parse a Lua numeric literal into a JS number. Handles 0x.., 0b.., decimal
 *  with underscores, hex floats (best effort). */
function parseLuaNumber(text: string): number | null {
  const t = text.replace(/_/g, "");
  if (/^0[xX][0-9a-fA-F]*\.?[0-9a-fA-F]+([pP][+-]?\d+)?$/.test(t)) {
    const pIdx = t.search(/[pP]/);
    let mantHex = pIdx >= 0 ? t.slice(0, pIdx) : t;
    let exp = 0;
    if (pIdx >= 0) {
      const e = t.slice(pIdx + 1);
      exp = parseInt(e, 10);
    }
    if (mantHex.startsWith("0x") || mantHex.startsWith("0X")) mantHex = mantHex.slice(2);
    const dot = mantHex.indexOf(".");
    if (dot >= 0) {
      const ip = mantHex.slice(0, dot) || "0";
      const fp = mantHex.slice(dot + 1);
      const v = parseInt(ip, 16) + parseInt(fp || "0", 16) / Math.pow(16, fp.length);
      return v * Math.pow(2, exp);
    }
    return parseInt(mantHex, 16) * Math.pow(2, exp);
  }
  if (/^0[bB][01]+$/.test(t)) return parseInt(t.slice(2), 2);
  if (/^-?\d+\.?\d*([eE][+-]?\d+)?$/.test(t) || /^-?\.\d+/.test(t)) {
    const n = Number(t);
    return isFinite(n) ? n : null;
  }
  return null;
}

function formatLuaNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  let s = String(n);
  if (s.includes("e")) return s;
  if (s.indexOf(".") >= 0) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
}

/** Decode a string/longstring token's value from the source. */
function decodeStringToken(tok: LuaToken, src: string): string | null {
  if (tok.kind === "string") {
    if (tok.value !== undefined) return tok.value;
    return decodeShortString(tok.text);
  }
  if (tok.kind === "longstring") {
    if (tok.value !== undefined) return tok.value;
    const level = longBracketLevel(src, tok.start);
    if (level < 0) return null;
    const close = findLongBracketClose(src, tok.start, level);
    if (close < 0) return null;
    let valStart = tok.start + 2 + level;
    if (src[valStart] === "\r") valStart++;
    if (src[valStart] === "\n") valStart++;
    return src.slice(valStart, close);
  }
  return null;
}

function decodeShortString(text: string): string | null {
  if (text.length < 2) return null;
  const quote = text[0];
  if (quote !== '"' && quote !== "'") return null;
  const body = text.slice(1, -1);
  let out = "";
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "\\") {
      const next = body[i + 1];
      if (next === "n") { out += "\n"; i += 2; continue; }
      if (next === "t") { out += "\t"; i += 2; continue; }
      if (next === "r") { out += "\r"; i += 2; continue; }
      if (next === '"') { out += '"'; i += 2; continue; }
      if (next === "'") { out += "'"; i += 2; continue; }
      if (next === "\\") { out += "\\"; i += 2; continue; }
      const hex = body.slice(i + 1).match(/^x([0-9a-fA-F]{2})/);
      if (hex) { out += String.fromCharCode(parseInt(hex[1], 16)); i += 4; continue; }
      const dec = body.slice(i + 1).match(/^(\d{1,3})/);
      if (dec) { out += String.fromCharCode(parseInt(dec[1], 10) & 0xff); i += 1 + dec[1].length; continue; }
      out += next ?? "";
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Re-encode a string as a safe Lua short literal (double-quoted) if it is
 *  mostly printable; otherwise as a long-bracket string.
 *  Byte-safety: the whole pipeline treats strings as latin1-mapped byte
 *  arrays (1 JS char = 1 raw Lua byte, see cli.ts/utils/fetcher.ts), so a
 *  char code in 0-255 is emitted as a single `\ddd` byte escape. Only a
 *  genuine >0xFF codepoint (which should no longer arise now that Luau
 *  `\u{}` escapes are pre-expanded to UTF-8 bytes at parse time — see
 *  utils/lua-utils.ts#utf8Encode) falls back to UTF-8 byte expansion. */
export function encodeLuaString(s: string): string {
  if (s.includes("\x00") || s.includes("\x1bLuaP")) {
    let level = 0;
    while (s.includes("]" + "=".repeat(level) + "]")) level++;
    return "[" + "=".repeat(level) + "[" + s + "]" + "=".repeat(level) + "]";
  }
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 32 || code === 127) out += `\\${code}`;
    else if (code > 0xff) {
      // Defensive fallback only: a real multi-byte codepoint slipped through.
      for (const b of Buffer.from(ch, "utf8")) out += `\\${b}`;
    } else if (code > 0x7f) out += `\\${code}`;
    else out += ch;
  }
  out += '"';
  return out;
}

function formatLuaValue(v: unknown): string {
  if (typeof v === "string") return encodeLuaString(v);
  if (typeof v === "number") return formatLuaNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === null || v === undefined) return "nil";
  return String(v);
}

/** Find the index in `tokens` of the `)` that closes the `(` at tokens[openIdx]. */
function findMatchingParen(tokens: LuaToken[], openIdx: number): number {
  let depth = 0;
  for (let k = openIdx; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.text === "(") depth++;
    else if (t.text === ")") {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** Split a token range [start, end) into argument groups separated by top-level commas. */
function splitArgs(tokens: LuaToken[], start: number, end: number): LuaToken[][] {
  const args: LuaToken[][] = [];
  let cur: LuaToken[] = [];
  let depth = 0;
  for (let k = start; k < end; k++) {
    const t = tokens[k];
    if (t.kind === "whitespace" || t.kind === "newline") continue;
    if (t.text === "(" || t.text === "{" || t.text === "[") depth++;
    else if (t.text === ")" || t.text === "}" || t.text === "]") depth--;
    if (depth === 0 && t.text === ",") {
      if (cur.length > 0) args.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  if (cur.length > 0) args.push(cur);
  return args;
}

/** Parse a token group (one argument) into a JS literal value, if possible.
 *  Returns `undefined` when the argument is non-literal (identifier/table/call). */
function argToValue(toks: LuaToken[], src: string): unknown {
  if (toks.length === 0) return null;
  let sign = 1;
  let k = 0;
  while (k < toks.length && toks[k].text === "-") {
    sign = -sign;
    k++;
  }
  if (k >= toks.length) return null;
  const t = toks[k];
  if (t.kind === "string" || t.kind === "longstring") {
    const v = decodeStringToken(t, src);
    return sign < 0 ? null : v;
  }
  if (t.kind === "number") {
    if (k + 1 !== toks.length) return null;
    const n = parseLuaNumber(t.text);
    return n === null ? null : sign * n;
  }
  if (t.kind === "keyword") {
    if (t.text === "true" && k + 1 === toks.length) return true;
    if (t.text === "false" && k + 1 === toks.length) return false;
    if (t.text === "nil" && k + 1 === toks.length) return null;
  }
  return undefined;
}

function tryFoldStringCall(method: string, args: LuaToken[][], src: string): unknown {
  const vals = args.map((a) => argToValue(a, src));
  try {
    switch (method) {
      case "char": {
        if (vals.length === 0) return null;
        let out = "";
        for (const v of vals) {
          // Lua string.char accepts 0..255 only — larger codes are a runtime
          // error in Lua; folding them would silently change semantics.
          if (typeof v !== "number" || v < 0 || v > 255 || !Number.isInteger(v)) return null;
          out += String.fromCharCode(v);
        }
        return out;
      }
      case "byte": {
        if (vals.length === 0) return null;
        const s = vals[0];
        if (typeof s !== "string" || s.length === 0) return null;
        const i = typeof vals[1] === "number" ? vals[1] : 1;
        const j = typeof vals[2] === "number" ? vals[2] : i;
        const start = Math.max(0, Math.min(s.length, i - 1));
        const end = Math.max(0, Math.min(s.length, j));
        if (start >= end) return null;
        const codes = [...s.slice(start, end)].map((c) => c.charCodeAt(0));
        // v4: multi-byte string.byte returns MULTIPLE values in Lua — folding
        // to a comma-joined string would corrupt call sites. Single only.
        if (codes.length !== 1) return null;
        return codes[0];
      }
      case "sub": {
        if (vals.length < 2) return null;
        const s = vals[0];
        const i = vals[1];
        if (typeof s !== "string" || typeof i !== "number") return null;
        let j = typeof vals[2] === "number" ? vals[2] : -1;
        const len = s.length;
        const start = i < 0 ? len + i + 1 : i;
        let end = j < 0 ? len + j + 1 : j;
        const s2 = Math.max(1, start);
        const e2 = Math.min(len, end);
        if (s2 > e2) return "";
        return s.slice(s2 - 1, e2);
      }
      case "rep": {
        if (vals.length < 2) return null;
        const s = vals[0];
        const n = vals[1];
        if (typeof s !== "string" || typeof n !== "number" || n < 0) return null;
        if (n > 1_000_000) return null;
        return s.repeat(Math.floor(n));
      }
      case "reverse": {
        if (vals.length < 1) return null;
        const s = vals[0];
        if (typeof s !== "string") return null;
        return [...s].reverse().join("");
      }
      case "lower": {
        if (vals.length < 1) return null;
        const s = vals[0];
        if (typeof s !== "string") return null;
        return s.toLowerCase();
      }
      case "upper": {
        if (vals.length < 1) return null;
        const s = vals[0];
        if (typeof s !== "string") return null;
        return s.toUpperCase();
      }
      case "format": {
        if (vals.length < 1) return null;
        const fmt = vals[0];
        if (typeof fmt !== "string") return null;
        if (/%q/i.test(fmt)) return null;
        try {
          return luaFormat(fmt, vals.slice(1));
        } catch {
          return null;
        }
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** A small, safe subset of Lua's string.format. Throws on unsupported. */
function luaFormat(fmt: string, args: unknown[]): string {
  let out = "";
  let i = 0;
  let ai = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== "%") { out += c; i++; continue; }
    i++;
    if (fmt[i] === "%") { out += "%"; i++; continue; }
    while (i < fmt.length && /[-# 0]/.test(fmt[i])) i++;
    while (i < fmt.length && /\d/.test(fmt[i])) i++;
    if (fmt[i] === ".") {
      i++;
      while (i < fmt.length && /\d/.test(fmt[i])) i++;
    }
    const conv = fmt[i];
    if (!conv) throw new Error("bad format");
    i++;
    const arg = args[ai++];
    switch (conv) {
      case "s":
        if (typeof arg !== "string" && typeof arg !== "number") throw new Error("bad %s");
        out += String(arg);
        break;
      case "d": case "i": case "u":
        if (typeof arg !== "number") throw new Error("bad %d");
        out += String(Math.trunc(arg));
        break;
      case "x":
        if (typeof arg !== "number") throw new Error("bad %x");
        out += Math.trunc(arg).toString(16);
        break;
      case "X":
        if (typeof arg !== "number") throw new Error("bad %X");
        out += Math.trunc(arg).toString(16).toUpperCase();
        break;
      case "o":
        if (typeof arg !== "number") throw new Error("bad %o");
        out += Math.trunc(arg).toString(8);
        break;
      case "f": case "g": case "e": case "E":
        if (typeof arg !== "number") throw new Error("bad %f");
        out += Number(arg).toString();
        break;
      case "c":
        if (typeof arg !== "number") throw new Error("bad %c");
        out += String.fromCharCode(arg & 0xff);
        break;
      case "q": throw new Error("%q unsupported");
      default: throw new Error("unknown conv " + conv);
    }
  }
  return out;
}

function tryFoldConv(fn: string, args: LuaToken[][], src: string): unknown {
  // Only fold scalar literal arguments here. Complex expressions such as
  // `tostring(42 + 1)` are handled by the general constant evaluator; treating
  // an unsupported argument as Lua nil would silently change program semantics.
  if (args.some((a) => a.filter((t) => t.kind !== "whitespace" && t.kind !== "newline").length !== 1)) return undefined;
  const vals = args.map((a) => argToValue(a, src));
  try {
    if (fn === "tonumber") {
      const v = vals[0];
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const base = typeof vals[1] === "number" ? vals[1] : 10;
        if (base < 2 || base > 36) return null; // Lua errors — keep the expr
        const trimmed = v.trim();
        // Lua: tonumber("") / whitespace-only → nil
        if (trimmed === "") return null;
        if (base !== 10) {
          // v4: honour the base for non-decimal (tonumber("ff", 16) → 255)
          const body = trimmed.replace(/^[+-]/, "");
          if (!/^[0-9a-fA-F]+$/.test(body)) return null;
          const n = parseInt(trimmed, base);
          return Number.isFinite(n) ? n : null;
        }
        // base 10 (Luau accepts 0x); rejects "inf"/"nan"/garbage
        if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(trimmed)) {
          const n = parseInt(trimmed, 16);
          return Number.isFinite(n) ? n : null;
        }
        if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return null;
        const n = Number(trimmed);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    }
    if (fn === "tostring") {
      const v = vals[0];
      if (typeof v === "string") return v;
      if (typeof v === "number") return formatLuaNumber(v);
      if (typeof v === "boolean") return v ? "true" : "false";
      if (v === null) return "nil";
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

function tryFoldBit(method: string, args: LuaToken[][], src: string): unknown {
  const vals = args.map((a) => argToValue(a, src));
  if (vals.some((v) => typeof v !== "number")) return null;
  const ns = vals as number[];
  try {
    switch (method) {
      case "band":
        if (ns.length < 2) return null;
        return ns.reduce((a, b) => (a & b) >>> 0);
      case "bor":
        if (ns.length < 2) return null;
        return ns.reduce((a, b) => (a | b) >>> 0);
      case "bxor":
        if (ns.length < 2) return null;
        return ns.reduce((a, b) => (a ^ b) >>> 0);
      case "bnot":
        if (ns.length !== 1) return null;
        return (~ns[0]) >>> 0;
      case "lshift": {
        if (ns.length !== 2) return null;
        const n = ns[0] >>> 0;
        const s = ns[1] | 0;
        return (n << (s & 31)) >>> 0;
      }
      case "rshift": {
        if (ns.length !== 2) return null;
        const n = ns[0] >>> 0;
        const s = ns[1] | 0;
        return (n >>> (s & 31)) >>> 0;
      }
      case "arshift": {
        if (ns.length !== 2) return null;
        const n = ns[0] | 0;
        const s = ns[1] | 0;
        return (n >> (s & 31)) | 0;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Apply a set of non-overlapping edits to source, in reverse order. */
function applyEdits(
  src: string,
  edits: Array<{ start: number; end: number; replacement: string }>
): string {
  if (edits.length === 0) return src;
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const kept: typeof sorted = [];
  let lastEnd = -1;
  for (const e of sorted) {
    if (e.start < lastEnd) continue;
    kept.push(e);
    lastEnd = e.end;
  }
  let out = "";
  let cursor = 0;
  for (const e of kept) {
    out += src.slice(cursor, e.start);
    out += e.replacement;
    cursor = e.end;
  }
  out += src.slice(cursor);
  return out;
}

// ---------------------------------------------------------------------------
// Pass N: constant-expression noise folding via the const evaluator
// ---------------------------------------------------------------------------

/**
 * Fold obfuscator constant-noise expressions using the full const evaluator:
 *
 *   (-#"junk message"+803)        →  798
 *   (102+-#{1,'nil',(function()... end)(),{},','})-95 → 4   (unparenthesised tails too)
 *   (function(_) return (_ and 'A') or 'B' end)((1/3)==(26))  →  'B'
 *   ('\115\116'):rep(2)           →  'stst'
 *
 * Only side-effect-free expressions are folded (arithmetic, concat, length,
 * comparisons, and/or, IIFEs whose body is a single return, string methods).
 */
export function foldConstEvalNoise(src: string): FoldResult {
  if (src.length > 12_000_000) return { result: src, folded: 0, notes: [] };
  let tokens: LuaToken[];
  try {
    tokens = [...tokenize(src)];
  } catch {
    return { result: src, folded: 0, notes: [] };
  }

  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  let folded = 0;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "eof") break;
    if (t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment") {
      i++;
      continue;
    }

    // candidate: '(' starting a parenthesised constant expression, or a
    // bare '#' length expression.
    let exprStartIdx = -1;
    let openTok = t;
    let unaryOnly = false;
    if (t.text === "(") {
      // Call-syntax guard: when the '(' directly follows a callable value
      // (identifier / string / ')' / ']' / '}') it is a CALL paren — folding
      // `t(0x01)` → `t 1` would destroy the call. Only fold grouping parens.
      const prevIdx = lastSignificantBefore(tokens, i);
      const pt = prevIdx >= 0 ? tokens[prevIdx] : null;
      const wordLike = !!pt && /^[A-Za-z_][A-Za-z0-9_]*$/.test(pt.text);
      const isCallParen =
        !!pt &&
        (wordLike ||
          pt.kind === "string" ||
          pt.kind === "longstring" ||
          pt.text === ")" ||
          pt.text === "]" ||
          pt.text === "}" ||
          pt.text === "...");
      if (!isCallParen) {
        // IIFE: `(function(p) return EXPR end)(args)` — start the evaluation
        // AT the paren so the parser consumes the whole call (parsePow
        // invokes function values when directly followed by `(`).
        const afterParen = nextSignificant(tokens, i + 1);
        const isIife = afterParen >= 0 && tokens[afterParen].kind === "keyword" && tokens[afterParen].text === "function";
        exprStartIdx = isIife ? i : i + 1;
      }
    } else if (t.text === "#") {
      const target = nextSignificant(tokens, i + 1);
      if (target >= 0 && (tokens[target].kind === "string" || tokens[target].kind === "longstring" || tokens[target].text === "{")) {
        exprStartIdx = i; // evaluate ONLY the unary `#expr` (v4: never let
        openTok = t;      // the parse run past it — see evalUnaryFromTokens)
        unaryOnly = true;
      }
    }
    if (exprStartIdx < 0) {
      i++;
      continue;
    }

    const startedAtParen = t.text === "(" && exprStartIdx === i;
    const ev = unaryOnly ? evalUnaryFromTokens(tokens, exprStartIdx) : evalExprFromTokens(tokens, exprStartIdx);
    if (!ev) {
      i++;
      continue;
    }
    const value = ev.value;
    if (value.k === "ident" || value.k === "table" || value.k === "func" || value.k === "nil") {
      i++;
      continue;
    }
    if (value.k === "number" && !Number.isFinite(value.v)) {
      i++;
      continue;
    }
    const lit = constToLua(value);
    if (lit === null) {
      i++;
      continue;
    }

    if (openTok.text === "#") {
      // bare # expr — replace from '#' to the end of the evaluated expression
      edits.push({
        start: t.start,
        end: ev.endOffset,
        replacement: padReplacement(src, t.start, ev.endOffset, lit),
      });
      folded++;
      i = ev.endIndex;
      continue;
    }

    if (startedAtParen) {
      // IIFE: the parser consumed `(function…end)(args)` entirely — replace
      // the whole call with the computed value.
      edits.push({
        start: t.start,
        end: ev.endOffset,
        replacement: padReplacement(src, t.start, ev.endOffset, lit),
      });
      folded++;
      i = ev.endIndex;
      continue;
    }

    // parenthesised expr: the next significant token must close the paren
    const closeIdx = nextSignificant(tokens, ev.endIndex);
    if (closeIdx < 0 || tokens[closeIdx].text !== ")") {
      i++;
      continue;
    }
    // guard: don't rewrite when the ')' is directly called / indexed /
    // string-suffixed, e.g. `(function() end)()` (never foldable anyway) or
    // `(5)(...)`, `(x)[k]`, `("a"):upper()` leftovers.
    const after = nextSignificant(tokens, closeIdx + 1);
    if (after >= 0) {
      const at = tokens[after];
      if (
        at.text === "(" ||
        at.text === "{" ||
        at.text === "[" ||
        at.kind === "string" ||
        at.kind === "longstring"
      ) {
        i++;
        continue;
      }
    }
    // also guard `foo((expr))`-style call args? those are fine — inner parens.
    edits.push({
      start: t.start,
      end: tokens[closeIdx].end,
      replacement: padReplacement(src, t.start, tokens[closeIdx].end, lit),
    });
    folded++;
    i = closeIdx + 1;
  }

  const result = applyEdits(src, edits);
  const notes =
    folded > 0 ? [`Folded ${folded} constant-noise expression(s) (len/IIFE/arith).`] : [];
  return { result, folded, notes };
}

function lastSignificantBefore(toks: LuaToken[], index: number): number {
  for (let j = Math.min(index - 1, toks.length - 1); j >= 0; j--) {
    const t = toks[j];
    if (t.kind === "eof") continue;
    if (t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment") continue;
    return j;
  }
  return -1;
}

/** Ensure a folded literal cannot fuse with neighbouring tokens:
 *  `if(false)then` → `if false then` (not `iffalsethen`),
 *  `-(-5)` → `- -5` (not `--5` which would start a comment). */
function padReplacement(
  src: string,
  start: number,
  end: number,
  lit: string
): string {
  let out = lit;
  const prevChar = start > 0 ? src[start - 1] : "";
  const nextChar = end < src.length ? src[end] : "";
  if (prevChar && /[A-Za-z0-9_]/.test(prevChar) && /^[A-Za-z0-9_]/.test(out)) {
    out = " " + out;
  }
  if (prevChar === "-" && out.startsWith("-")) {
    out = " " + out;
  }
  if (nextChar && /[A-Za-z0-9_]/.test(nextChar) && /[A-Za-z0-9_]$/.test(out)) {
    out = out + " ";
  }
  if (nextChar === "-" && out.endsWith("-")) {
    out = out + " ";
  }
  return out;
}
