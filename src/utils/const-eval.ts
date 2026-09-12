// Constant-expression evaluator for Lua/Luau.
//
// Obfuscators (MoonSec V2/V3, PSU, IronBrew variants, ...) hide constants
// behind arithmetic noise like `(-#"junk message"+803)`, `#{1,{},','}`,
// and IIFE tricks:
//
//   (function(_) return (_ and 'A') or 'B' or 'C' end)((1130/363)==(26))
//
// This module evaluates such expressions to concrete values using a real
// tokenizer (never touches the inside of strings/comments) with Lua
// semantics: and/or truthiness, `..` concat, byte-length `#`, comparison
// rules, number formatting on concat, and IIFE param binding.

import { tokenize, LuaToken } from "./lua-utils";

export type ConstValue =
  | { k: "nil" }
  | { k: "boolean"; v: boolean }
  | { k: "number"; v: number }
  | { k: "string"; v: string }
  | { k: "ident"; v: string }
  | { k: "table"; entries: Array<{ key?: ConstValue; value: ConstValue }> }
  /** function literal `(function(p) return EXPR end)` — call it to evaluate */
  | { k: "func"; params: string[]; bodyStartIdx: number };

export interface EvalOutcome {
  value: ConstValue;
  /** char offset right after the parsed expression */
  endOffset: number;
}

const MAX_EXPR_TOKENS = 400; // refuse pathological expressions

class ParseError extends Error {}

class Parser {
  private i: number;
  private readonly toks: LuaToken[];
  private readonly env: Map<string, ConstValue>;
  private count = 0;

  constructor(
    toks: LuaToken[],
    startIndex: number,
    env: Map<string, ConstValue> = new Map()
  ) {
    this.toks = toks;
    this.i = startIndex;
    this.env = env;
  }

  private peek(offset = 0): LuaToken | undefined {
    let j = this.i;
    let seen = 0;
    while (j < this.toks.length) {
      const t = this.toks[j];
      if (t.kind !== "whitespace" && t.kind !== "newline" && t.kind !== "comment" && t.kind !== "longcomment") {
        if (seen === offset) return t;
        seen++;
      }
      j++;
    }
    return undefined;
  }

  private next(): LuaToken | undefined {
    const t = this.peek();
    if (t) {
      // advance i past this token
      let j = this.i;
      while (j < this.toks.length) {
        const tt = this.toks[j];
        if (tt === t) break;
        j++;
      }
      this.i = j + 1;
    }
    return t;
  }

  private check(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return !!t && t.text === text;
  }

  private expect(text: string): LuaToken {
    const t = this.peek();
    if (!t || t.text !== text) {
      throw new ParseError(`expected '${text}' got '${t?.text ?? "EOF"}'`);
    }
    return this.next()!;
  }

  private budget() {
    if (++this.count > MAX_EXPR_TOKENS) throw new ParseError("expression too large");
  }

  get pos(): number {
    return this.i;
  }

  // expression := or
  parseExpression(): ConstValue {
    return this.parseOr();
  }

  private parseOr(): ConstValue {
    let left = this.parseAnd();
    while (this.check("or")) {
      this.budget();
      this.next();
      const right = this.parseAnd();
      const lTruthy = isTruthy(left);
      left = lTruthy ? left : right;
    }
    return left;
  }

  private parseAnd(): ConstValue {
    let left = this.parseCmp();
    while (this.check("and")) {
      this.budget();
      this.next();
      const right = this.parseCmp();
      const lTruthy = isTruthy(left);
      left = lTruthy ? right : left;
    }
    return left;
  }

  private parseCmp(): ConstValue {
    const left = this.parseConcat();
    const t = this.peek();
    if (
      t &&
      (t.text === "==" || t.text === "~=" || t.text === "<" || t.text === "<=" ||
        t.text === ">" || t.text === ">=")
    ) {
      this.budget();
      this.next();
      const right = this.parseConcat();
      return compareValues(left, right, t.text);
    }
    return left;
  }

  private parseConcat(): ConstValue {
    let left = this.parseAdd();
    while (this.check("..")) {
      this.budget();
      this.next();
      const right = this.parseAdd();
      left = concatValues(left, right);
    }
    return left;
  }

  private parseAdd(): ConstValue {
    let left = this.parseMul();
    for (;;) {
      if (this.check("+")) {
        this.budget();
        this.next();
        const right = this.parseMul();
        left = arith(left, right, "+");
      } else if (this.check("-")) {
        this.budget();
        this.next();
        const right = this.parseMul();
        left = arith(left, right, "-");
      } else break;
    }
    return left;
  }

  private parseMul(): ConstValue {
    let left = this.parseUnary();
    for (;;) {
      if (this.check("*")) {
        this.budget();
        this.next();
        const right = this.parseUnary();
        left = arith(left, right, "*");
      } else if (this.check("/")) {
        this.budget();
        this.next();
        const right = this.parseUnary();
        left = arith(left, right, "/");
      } else if (this.check("%")) {
        this.budget();
        this.next();
        const right = this.parseUnary();
        left = arith(left, right, "%");
      } else if (this.check("//")) {
        // Luau/Lua 5.3+ floor division
        this.budget();
        this.next();
        const right = this.parseUnary();
        left = arith(left, right, "//");
      } else if (this.check("&") || this.check("|") || this.check("~") ||
          this.check("<<") || this.check(">>")) {
        // Luau bitwise operators bind like the mul group (left-assoc)
        this.budget();
        const op = this.next()!;
        const right = this.parseUnary();
        left = bitop(left, right, op.text);
      } else break;
    }
    return left;
  }

  parseUnary(): ConstValue {
    if (this.check("-")) {
      this.budget();
      this.next();
      const v = this.parseUnary();
      if (v.k === "number") return { k: "number", v: -v.v };
      return { k: "ident", v: "(-" + display(v) + ")" };
    }
    if (this.check("#")) {
      this.budget();
      this.next();
      const v = this.parseUnary();
      if (v.k === "string") return { k: "number", v: byteLength(v.v) };
      if (v.k === "table") {
        // length = number of array-part entries
        let n = 0;
        for (const e of v.entries) if (e.key === undefined) n++;
        return { k: "number", v: n };
      }
      return { k: "ident", v: "#" + display(v) };
    }
    if (this.check("~")) {
      // Luau unary bitwise-not
      this.budget();
      this.next();
      const v = this.parseUnary();
      if (v.k === "number" && Number.isInteger(v.v)) {
        return { k: "number", v: ~v.v };
      }
      return { k: "ident", v: "~" + display(v) };
    }
    if (this.check("not")) {
      this.budget();
      this.next();
      const v = this.parseUnary();
      return { k: "boolean", v: !isTruthy(v) };
    }
    return this.parsePow();
  }

  private parsePow(): ConstValue {
    let base = this.parsePrimary();
    if (this.check("^")) {
      this.budget();
      this.next();
      const exp = this.parseUnary();
      base = arith(base, exp, "^");
    }
    // call a function value: (function(p) return EXPR end)(args)
    while (base.k === "func" && this.check("(")) {
      this.budget();
      this.next();
      const args: ConstValue[] = [];
      while (!this.check(")")) {
        args.push(this.parseExpression());
        if (this.check(",")) this.next();
      }
      this.expect(")");
      const childEnv = new Map(this.env);
      for (let i = 0; i < base.params.length; i++) {
        childEnv.set(base.params[i], args[i] ?? { k: "nil" });
      }
      const sub = new Parser(this.toks, base.bodyStartIdx, childEnv);
      base = sub.parseExpression();
    }
    // method calls on constant strings: ('X'):find('f'), ('ab'):rep(3), ...
    while (this.check(":")) {
      this.budget();
      this.next();
      const name = this.next();
      if (!name || name.kind !== "identifier") throw new ParseError("bad method name");
      this.expect("(");
      const args: ConstValue[] = [];
      while (!this.check(")")) {
        args.push(this.parseExpression());
        if (this.check(",")) this.next();
      }
      this.expect(")");
      base = stringMethod(base, name.text, args);
    }
    return base;
  }

  private parsePrimary(): ConstValue {
    this.budget();
    const t = this.peek();
    if (!t) throw new ParseError("unexpected EOF");

    // number
    if (t.kind === "number") {
      this.next();
      return { k: "number", v: parseLuaNumber(t.text) };
    }
    // string
    if (t.kind === "string" || t.kind === "longstring") {
      this.next();
      return { k: "string", v: t.value ?? "" };
    }
    // bare function literal (v4: expressions starting directly at
    // `function`, e.g. the IIFE body inside `(function(x) return ... end)(...)`
    // when the evaluator is entered from INSIDE the parens)
    if (t.kind === "keyword" && t.text === "function") {
      const f = this.parseFunctionLiteral();
      return { k: "func", params: f.params, bodyStartIdx: f.bodyStartIdx };
    }
    // nil / true / false
    if (t.kind === "keyword" && (t.text === "nil" || t.text === "true" || t.text === "false")) {
      this.next();
      if (t.text === "nil") return { k: "nil" };
      return { k: "boolean", v: t.text === "true" };
    }
    // ( expr )  — or a parenthesised function literal
    if (t.text === "(") {
      this.next();
      if (this.check("function")) {
        const f = this.parseFunctionLiteral();
        this.expect(")");
        return { k: "func", params: f.params, bodyStartIdx: f.bodyStartIdx };
      }
      const inner = this.parseExpression();
      this.expect(")");
      return inner;
    }
    // { table }
    if (t.text === "{") {
      return this.parseTable();
    }
    // identifier (env lookup)
    if (t.kind === "identifier") {
      this.next();
      const bound = this.env.get(t.text);
      if (bound) return bound;
      return { k: "ident", v: t.text };
    }
    throw new ParseError(`cannot evaluate '${t.text}'`);
  }

  /** Parse `function(params) return EXPR ;? end` — consumes the `function` keyword. */
  private parseFunctionLiteral(): { params: string[]; bodyStartIdx: number } {
    this.expect("function");
    this.expect("(");
    const params: string[] = [];
    while (!this.check(")")) {
      const p = this.next();
      if (!p || p.kind !== "identifier") throw new ParseError("bad param");
      params.push(p.text);
      if (this.check(",")) this.next();
    }
    this.expect(")");
    // body must be exactly: return EXPR ;? end
    this.expect("return");
    const bodyStartIdx = this.i;
    this.parseExpression(); // discover where the body ends (values discarded)
    if (this.check(";")) this.next();
    this.expect("end");
    return { params, bodyStartIdx };
  }

  private parseTable(): ConstValue {
    this.expect("{");
    const entries: Array<{ key?: ConstValue; value: ConstValue }> = [];
    while (!this.check("}")) {
      this.budget();
      let key: ConstValue | undefined;
      if (this.check("[")) {
        this.next();
        key = this.parseExpression();
        this.expect("]");
        this.expect("=");
      }
      const value = this.parseExpression();
      entries.push({ key, value });
      if (this.check(",") || this.check(";")) this.next();
    }
    this.expect("}");
    return { k: "table", entries };
  }
}

// ---------------------------------------------------------------------------
// value helpers
// ---------------------------------------------------------------------------

function isTruthy(v: ConstValue): boolean {
  if (v.k === "nil") return false;
  if (v.k === "boolean") return v.v;
  return true; // numbers, strings, idents, tables are truthy
}

function byteLength(s: string): number {
  // The pipeline is byte-transparent (1 JS char = 1 raw Lua byte, see
  // cli.ts/utils/fetcher.ts), so the JS string length already equals the
  // Lua byte length. Using Buffer.byteLength(s, "utf8") here would overcount
  // every non-ASCII byte (encoding it as if it were a real UTF-8 codepoint),
  // producing a wrong folded `#s` result.
  return s.length;
}

/** Lua number → string (for concat and literal output). Mimics %.14g. */
export function luaNumToString(n: number): string {
  if (!Number.isFinite(n)) return "(math.huge)"; // caller must refuse to fold
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
  // %.14g — 14 significant digits, trimmed
  let s = n.toPrecision(14);
  if (s.includes("e")) {
    // JS: 1e+21 ; Lua: 1e+21 → normalise exponent digits (strip leading zeros)
    s = s.replace(/e([+-])(\d+)/, (_m, sign: string, digits: string) => `e${sign}${Number(digits)}`);
    // integral mantissa in exponent form: 1.0000000000000e+15 → 1e+15
    if (/^-?\d+(\.0+)?e/.test(s)) s = s.replace(/\.0+e/, "e");
  } else if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
    if (s === "" || s === "-") s = "0";
  }
  return s;
}

function display(v: ConstValue): string {
  switch (v.k) {
    case "nil": return "nil";
    case "boolean": return v.v ? "true" : "false";
    case "number": return luaNumToString(v.v);
    case "string": return JSON.stringify(v.v);
    case "ident": return v.v;
    case "table": return "{...}";
    case "func": return "function";
  }
}

function concatValues(a: ConstValue, b: ConstValue): ConstValue {
  const as = a.k === "string" ? a.v : a.k === "number" ? luaNumToString(a.v) : null;
  const bs = b.k === "string" ? b.v : b.k === "number" ? luaNumToString(b.v) : null;
  if (as === null || bs === null) {
    return { k: "ident", v: `${display(a)} .. ${display(b)}` };
  }
  return { k: "string", v: as + bs };
}

function arith(a: ConstValue, b: ConstValue, op: string): ConstValue {
  if (a.k === "number" && b.k === "number") {
    let v: number;
    switch (op) {
      case "+": v = a.v + b.v; break;
      case "-": v = a.v - b.v; break;
      case "*": v = a.v * b.v; break;
      case "/":
        // v4: 1/0 = inf in Lua but emitting `inf`/`math.huge` from folding is
        // not byte-safe — refuse to fold non-finite division results.
        if (b.v === 0) return { k: "ident", v: `(${display(a)} / ${display(b)})` };
        v = a.v / b.v; break;
      case "%":
        // Lua modulo follows the DIVISION result sign (floored), like JS `%`
        if (b.v === 0) return { k: "ident", v: `(${display(a)} % ${display(b)})` };
        v = a.v - Math.floor(a.v / b.v) * b.v; break;
      case "//":
        // floored division (Lua 5.3+/Luau)
        if (b.v === 0) return { k: "ident", v: `(${display(a)} // ${display(b)})` };
        v = Math.floor(a.v / b.v); break;
      case "^": v = Math.pow(a.v, b.v); break;
      default:
        return { k: "ident", v: `(${display(a)} ${op} ${display(b)})` };
    }
    if (!Number.isFinite(v)) {
      // inf/NaN results are valid Lua values but not representable as safe
      // numeric literals — keep the expression instead.
      return { k: "ident", v: `(${display(a)} ${op} ${display(b)})` };
    }
    return { k: "number", v };
  }
  return { k: "ident", v: `(${display(a)} ${op} ${display(b)})` };
}

/** Luau bitwise ops on integer values (32-bit semantics like bit32). */
function bitop(a: ConstValue, b: ConstValue, op: string): ConstValue {
  if (a.k === "number" && b.k === "number" && Number.isInteger(a.v) && Number.isInteger(b.v)) {
    const x = a.v | 0;
    const y = b.v | 0;
    let v: number;
    switch (op) {
      case "&": v = (x & y) >>> 0; break;
      case "|": v = (x | y) >>> 0; break;
      case "~": v = (x ^ y) >>> 0; break; // binary ~ = xor in Lua
      case "<<": v = (x << (y & 31)) >>> 0; break;
      case ">>": v = (x >>> (y & 31)) >>> 0; break;
      default:
        return { k: "ident", v: `(${display(a)} ${op} ${display(b)})` };
    }
    return { k: "number", v: v };
  }
  return { k: "ident", v: `(${display(a)} ${op} ${display(b)})` };
}

/** Fold constant string method calls: ('X'):find('f'), ('ab'):rep(3), ... */
function stringMethod(recv: ConstValue, name: string, args: ConstValue[]): ConstValue {
  if (recv.k !== "string") throw new ParseError(`method on non-string`);
  const s = recv.v;
  const num = (i: number, dflt?: number): number | undefined => {
    const a = args[i];
    if (a === undefined) return dflt;
    if (a.k !== "number") throw new ParseError("non-number arg");
    return a.v;
  };
  const str = (i: number): string => {
    const a = args[i];
    if (a === undefined) throw new ParseError("missing arg");
    if (a.k !== "string") throw new ParseError("non-string arg");
    return a.v;
  };
  switch (name) {
    case "len":
      return { k: "number", v: byteLength(s) };
    case "lower":
      return { k: "string", v: s.toLowerCase() };
    case "upper":
      return { k: "string", v: s.toUpperCase() };
    case "reverse":
      return { k: "string", v: [...s].reverse().join("") };
    case "rep": {
      const n = num(0, 1)!;
      const sep = args[1]?.k === "string" ? (args[1] as { v: string }).v : "";
      // v4 resource guard: rep with a huge count would OOM — refuse to fold.
      const count = Math.max(0, Math.trunc(n));
      if (count * Math.max(1, s.length + sep.length) > 1_000_000) {
        throw new ParseError("string:rep too large");
      }
      return { k: "string", v: new Array(count).fill(s).join(sep) };
    }
    case "sub": {
      const len = s.length;
      let i = Math.trunc(num(0, 1) ?? 1);
      let j = Math.trunc(num(1, len) ?? len);
      if (i < 0) i = Math.max(len + i + 1, 1);
      else if (i === 0) i = 1;
      if (j < 0) j = len + j + 1;
      else if (j > len) j = len;
      if (i > j) return { k: "string", v: "" };
      return { k: "string", v: s.slice(i - 1, j) };
    }
    case "byte": {
      const i = Math.trunc(num(0, 1) ?? 1) - 1;
      if (i < 0 || i >= s.length) return { k: "nil" };
      return { k: "number", v: s.charCodeAt(i) };
    }
    case "find": {
      const pat = str(0);
      const init = Math.trunc(num(1, 1) ?? 1) - 1;
      const idx = s.indexOf(pat, Math.max(0, init));
      if (idx < 0) return { k: "nil" };
      return { k: "number", v: idx + 1 };
    }
    default:
      throw new ParseError(`unsupported method '${name}'`);
  }
}

function compareValues(a: ConstValue, b: ConstValue, op: string): ConstValue {
  // Lua: different types are never equal (except number coercion of strings)
  let eq: boolean | undefined;
  if (a.k === "number" && b.k === "number") eq = a.v === b.v;
  else if (a.k === "string" && b.k === "string") eq = a.v === b.v;
  else if (a.k === "boolean" && b.k === "boolean") eq = a.v === b.v;
  else if (a.k === "nil" && b.k === "nil") eq = true;
  else if (a.k === "ident" && b.k === "ident" && a.v === b.v) eq = true;
  else eq = false;
  if (op === "==") return { k: "boolean", v: eq };
  if (op === "~=") return { k: "boolean", v: !eq };
  // ordering — numbers and strings only
  if (a.k === "number" && b.k === "number") {
    switch (op) {
      case "<": return { k: "boolean", v: a.v < b.v };
      case "<=": return { k: "boolean", v: a.v <= b.v };
      case ">": return { k: "boolean", v: a.v > b.v };
      case ">=": return { k: "boolean", v: a.v >= b.v };
    }
  }
  if (a.k === "string" && b.k === "string") {
    switch (op) {
      case "<": return { k: "boolean", v: a.v < b.v };
      case "<=": return { k: "boolean", v: a.v <= b.v };
      case ">": return { k: "boolean", v: a.v > b.v };
      case ">=": return { k: "boolean", v: a.v >= b.v };
    }
  }
  return { k: "ident", v: `(${display(a)} ${op} ${display(b)})` };
}

export function parseLuaNumber(text: string): number {
  const t = text.replace(/_/g, "");
  if (/^0[xX]/.test(t)) {
    // hex float: 0x1.8p3 (mantissa × 2^exp)
    const m = /^0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]+))?(?:[pP]([+-]?\d+))?$/.exec(t);
    if (m) {
      const ip = m[1] ? parseInt(m[1], 16) : 0;
      const fp = m[2] ? parseInt(m[2], 16) / Math.pow(16, m[2].length) : 0;
      const exp = m[3] ? parseInt(m[3], 10) : 0;
      return (ip + fp) * Math.pow(2, exp);
    }
    return parseInt(t, 16);
  }
  if (/^0[bB]/.test(t)) return parseInt(t.slice(2), 2);
  return parseFloat(t);
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Evaluate the constant expression starting at (or just after) `offset`.
 * Returns the value and the char offset right after the expression, or
 * null when the expression is not statically evaluable.
 */
export function evalExprAt(src: string, offset: number): EvalOutcome | null {
  try {
    const toks = [...tokenize(src)];
    // find first significant token at/after offset
    let start = -1;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.kind === "eof") break;
      if (t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment") continue;
      if (t.end > offset) {
        // token overlapping or after offset
        if (t.start >= offset || (t.start < offset && t.end > offset)) {
          start = i;
          break;
        }
      }
    }
    if (start < 0) return null;
    const p = new Parser(toks, start);
    const value = p.parseExpression();
    // find the end offset of the last consumed token
    let endOffset = offset;
    for (let i = 0; i < p.pos && i < toks.length; i++) {
      const t = toks[i];
      if (t.kind === "eof") break;
      if (t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment") continue;
      endOffset = t.end;
    }
    return { value, endOffset };
  } catch {
    return null;
  }
}

/**
 * Evaluate ONLY a unary expression (`-x`, `#s`, `not x`, `~n`, and its
 * operand chain) starting at `startIndex` — the parser will NOT continue
 * with binary operators. This is required when anchoring a fold at a unary
 * operator: letting the parse continue (`#s + 1`) would swallow tokens that
 * Lua binds looser than the unary, changing semantics
 * (`x - #"a" + 1` ≠ `x - (#"a" + 1)`).
 */
export function evalUnaryFromTokens(
  toks: LuaToken[],
  startIndex: number
): { value: ConstValue; endIndex: number; endOffset: number } | null {
  try {
    const p = new Parser(toks, startIndex);
    const value = p.parseUnary();
    const lastConsumed = toks[p.pos - 1];
    if (!lastConsumed) return null;
    return { value, endIndex: p.pos, endOffset: lastConsumed.end };
  } catch {
    return null;
  }
}

/**
 * Evaluate the constant expression starting at token index `startIndex`
 * of a pre-tokenized source. Returns the value plus the token index right
 * after the expression (raw index, may point at whitespace) and the char
 * offset of the last consumed token's end.
 */
export function evalExprFromTokens(
  toks: LuaToken[],
  startIndex: number
): { value: ConstValue; endIndex: number; endOffset: number } | null {
  try {
    const p = new Parser(toks, startIndex);
    const value = p.parseExpression();
    const lastConsumed = toks[p.pos - 1];
    if (!lastConsumed) return null;
    return { value, endIndex: p.pos, endOffset: lastConsumed.end };
  } catch {
    return null;
  }
}

/** Skip whitespace/comment tokens forward from index i; returns significant token index or -1. */
export function nextSignificant(toks: LuaToken[], i: number, direction: 1 | -1 = 1): number {
  let j = i;
  while (j >= 0 && j < toks.length) {
    const t = toks[j];
    if (t.kind === "eof") return -1;
    if (t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment") {
      j += direction;
      continue;
    }
    return j;
  }
  return -1;
}

/** Format a ConstValue as Lua source text (for inlining). */
export function constToLua(v: ConstValue): string | null {
  switch (v.k) {
    case "nil": return "nil";
    case "boolean": return v.v ? "true" : "false";
    case "number":
      // v4: never emit inf/NaN — they are not valid Lua numeric literals.
      if (!Number.isFinite(v.v)) return null;
      return luaNumToString(v.v);
    case "string": return reencodeLuaLiteral(v.v);
    case "ident": return /^[A-Za-z_]\w*$/.test(v.v) ? v.v : null;
    case "table": return null;
    case "func": return null;
  }
}

/** Encode a string as a single-line Lua literal (prefer double quotes). */
export function reencodeLuaLiteral(value: string): string {
  const hasDq = value.includes('"');
  const hasSq = value.includes("'");
  let quote = '"';
  if (hasDq && !hasSq) quote = "'";
  let out = quote;
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === quote || ch === "\\") {
      out += "\\" + ch;
    } else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) {
      out += "\\" + code.toString(10).padStart(3, "0");
    } else if (code > 0xff) {
      // Defensive fallback only: a real multi-byte codepoint slipped through
      // (should not happen post-fix — see utils/lua-utils.ts#utf8Encode).
      const bytes = Buffer.from(ch, "utf8");
      for (const b of bytes) out += "\\" + b.toString(10).padStart(3, "0");
    } else if (code > 0x7f) {
      // Already a raw byte under the pipeline's latin1 convention.
      out += "\\" + code.toString(10).padStart(3, "0");
    } else {
      out += ch;
    }
  }
  return out + quote;
}
