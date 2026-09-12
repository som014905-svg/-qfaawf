// Ironveil V1 deobfuscator.
//
// Ironveil (memcpython/ironveil, discord.gg/qteAQmfJmP builds) is a from-source
// obfuscator that:
//   1. splits the compiled payload into several base64 string-literal
//      fragments (their concatenation order is shuffled per build),
//   2. XOR-encrypts the joined bytes with an xorshift32 keystream,
//   3. LZW-compresses the plaintext before encryption,
//   4. serialises the AST as a compact tagged text format (Z/T/F/N/S/A/O),
//   5. re-encodes every node's type tag ("opcode") through a small stateful
//      cipher whose keystream depends on the node's position within its
//      enclosing function and a per-build salt/seed pair, and
//   6. stores name/string tables as XOR'd literal arrays, optionally permuted
//      by a linear-congruential-style stride/offset pair.
//
// Everything below is a static, non-executing re-derivation of that pipeline:
// no Ironveil runtime or Lua interpreter is invoked. Opcode-to-name maps are
// NOT hardcoded — each build re-derives them from the salts embedded in that
// same build, with a small permutation search when multiple assignments are
// structurally valid (mirrors how the obfuscator's own salts are randomised
// per compile).

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult } from "../types";
import { beautifyLua, renameObfuscatedIdentifiers } from "../utils/lua-utils";
import { validateLuaSource } from "../utils/validate";

// ---------------------------------------------------------------------------
// xorshift32 keystream
// ---------------------------------------------------------------------------

function xorshift32Next(state: number): number {
  let x = state >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

// ---------------------------------------------------------------------------
// Payload byte-stream: XOR decrypt + LZW decompress + tagged-text deserialize
// ---------------------------------------------------------------------------

function xorDecryptBytes(buf: Buffer, key: number): Buffer {
  let state = ((key ^ 0x13579bdf) >>> 0) || 0x9e3779b9;
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) {
    state = xorshift32Next(state);
    const mask = ((state & 0xff) + ((key + (i + 1) * 29) & 0xff)) & 0xff;
    out[i] = buf[i] ^ mask;
  }
  return out;
}

/** LZW decompression: 16-bit big-endian codes, 256=reset, 257=end. */
function lzwDecompress(buf: Buffer): string {
  const codes: number[] = [];
  for (let i = 0; i + 1 < buf.length; i += 2) codes.push((buf[i] << 8) | buf[i + 1]);

  const RESET = 256;
  const END = 257;
  let dict: string[] = [];
  let nextCode = 258;
  let prev: string | null = null;
  const out: string[] = [];

  const resetDict = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict[i] = String.fromCharCode(i);
    nextCode = 258;
    prev = null;
  };
  resetDict();

  for (const code of codes) {
    if (code === RESET) {
      resetDict();
      continue;
    }
    if (code === END) break;
    let entry: string;
    if (code < nextCode && dict[code] !== undefined) entry = dict[code];
    else if (code === nextCode && prev !== null) entry = prev + prev[0];
    else throw new Error("ironveil: corrupt LZW stream");
    out.push(entry);
    if (prev !== null) dict[nextCode++] = prev + entry[0];
    prev = entry;
  }
  return out.join("");
}

/** Rolling checksum used to validate the decompressed payload against a build-embedded hash. */
function payloadChecksum(text: string, seed: number): number {
  let h = (seed ^ 0xa5a5a5a5) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h = (h + (text.charCodeAt(i) & 0xff) + (((i + 1) * 97) >>> 0)) >>> 0;
    h = (h ^ (h << 13)) >>> 0;
    h = h ^ (h >>> 7);
    h = (h ^ (h << 17)) >>> 0;
  }
  return h >>> 0;
}

type JsonLike = null | boolean | number | string | JsonLike[] | { [k: string]: JsonLike };

/** Deserialize the tagged text format: Z=null T=true F=false N=num S=hex-string A=array O=object. */
function deserializeTagged(s: string): JsonLike {
  let i = 0;
  const readUntil = (delim: string): string => {
    const start = i;
    while (s[i] !== delim) i++;
    const v = s.slice(start, i);
    i++;
    return v;
  };
  const readValue = (): JsonLike => {
    const tag = s[i++];
    switch (tag) {
      case "Z":
        return null;
      case "T":
        return true;
      case "F":
        return false;
      case "N":
        return Number(readUntil(";"));
      case "S": {
        const len = Number(readUntil(":")) || 0;
        const hex = s.slice(i, i + len);
        i += len;
        const bytes: number[] = [];
        for (let j = 0; j < hex.length; j += 2) bytes.push(parseInt(hex.slice(j, j + 2), 16) || 0);
        return Buffer.from(bytes).toString("utf8");
      }
      case "A": {
        const len = Number(readUntil("[")) || 0;
        const arr: JsonLike[] = [];
        for (let j = 0; j < len; j++) arr.push(readValue());
        i++; // closing marker
        return arr;
      }
      case "O": {
        const len = Number(readUntil("{")) || 0;
        const obj: { [k: string]: JsonLike } = {};
        for (let j = 0; j < len; j++) {
          const k = readValue();
          obj[String(k)] = readValue();
        }
        i++;
        return obj;
      }
      default:
        throw new Error(`ironveil: bad tag '${tag}' at offset ${i - 1}`);
    }
  };
  return readValue();
}

function extractPayload(
  base64Joined: string,
  key: number,
  hashSeed: number,
  expectedHash?: number
): JsonLike {
  const raw = Buffer.from(base64Joined, "base64");
  const decrypted = xorDecryptBytes(raw, key);
  const text = lzwDecompress(decrypted);
  const actual = payloadChecksum(text, hashSeed);
  if (expectedHash !== undefined && (actual >>> 0) !== (expectedHash >>> 0)) {
    throw new Error("ironveil: checksum mismatch");
  }
  return deserializeTagged(text);
}

// ---------------------------------------------------------------------------
// Fragment extraction + salt extraction from the obfuscated source
// ---------------------------------------------------------------------------

function* iterStringLiteralsRaw(src: string): Generator<string> {
  let i = 0;
  let inStr = false;
  let quote = "";
  let esc = false;
  let start = 0;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === quote) {
        yield src.slice(start + 1, i);
        inStr = false;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      start = i;
    }
    i++;
  }
}

function findBase64Fragments(src: string): string[] {
  const frags: string[] = [];
  for (const lit of iterStringLiteralsRaw(src)) {
    if (lit.length >= 80 && /^[A-Za-z0-9+/=]+$/.test(lit)) frags.push(lit);
  }
  return frags;
}

interface SaltTriple {
  payloadKey: number;
  payloadHashSeed: number;
  payloadHash: number;
}

function findSaltTriple(src: string): SaltTriple | null {
  // Primary shape: ,KEY)....,SEED)~=HASH
  const primary = /,(\d{5,12})\)[^,]{1,400},(\d{5,12})\)~=(\d{5,12})/.exec(src);
  if (primary) {
    return {
      payloadKey: parseInt(primary[1], 10) >>> 0,
      payloadHashSeed: parseInt(primary[2], 10) >>> 0,
      payloadHash: parseInt(primary[3], 10) >>> 0,
    };
  }
  // Fallback: locate `(SEED)...~=HASH` and take the nearest preceding `,KEY)` as the key.
  const fallbackRe = /\((\d{5,12})\)[^~]{1,400}~=(\d{5,12})/g;
  let m: RegExpExecArray | null;
  while ((m = fallbackRe.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 300), m.index);
    const keyMatches = [...before.matchAll(/,(\d{5,12})\)/g)];
    if (keyMatches.length > 0) {
      const last = keyMatches[keyMatches.length - 1];
      return {
        payloadKey: parseInt(last[1], 10) >>> 0,
        payloadHashSeed: parseInt(m[1], 10) >>> 0,
        payloadHash: parseInt(m[2], 10) >>> 0,
      };
    }
  }
  return null;
}

/** Try every small permutation (n<=8) of the fragment list until decode+checksum succeeds. */
function assembleFragments(frags: string[], key: number, hashSeed: number, expectedHash: number): string {
  if (frags.length === 0) throw new Error("ironveil: no base64 fragments found");
  if (frags.length === 1) return frags[0];

  const tryDecode = (b64: string): boolean => {
    try {
      const raw = Buffer.from(b64, "base64");
      const decrypted = xorDecryptBytes(raw, key);
      const text = lzwDecompress(decrypted);
      return (payloadChecksum(text, hashSeed) >>> 0) === (expectedHash >>> 0);
    } catch {
      return false;
    }
  };

  const sequential = frags.join("");
  if (tryDecode(sequential)) return sequential;

  if (frags.length <= 8) {
    for (const order of permutations([...frags.keys()])) {
      const candidate = order.map((idx) => frags[idx]).join("");
      if (tryDecode(candidate)) return candidate;
    }
  }
  // Best effort: fall back to source order even if the checksum won't validate
  // (extractPayload() will surface a clear error rather than silently lying).
  return sequential;
}

function* permutations(arr: number[]): Generator<number[]> {
  if (arr.length <= 1) {
    yield arr;
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.filter((_, j) => j !== i);
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

// ---------------------------------------------------------------------------
// Opcode salt derivation (binary / unary / expr / stmt / lval / field tags)
// ---------------------------------------------------------------------------

const OP_MASK = 0xffff;
const BINARY_NAMES = ["+", "-", "*", "/", "%", "^", "..", "==", "~=", "<", "<=", ">", ">=", "&", "|", "~", "<<", ">>"];
const UNARY_NAMES = ["-", "not", "#", "~"];
const EXPR_NAMES = ["id", "str", "num", "bool", "nil", "vararg", "binary", "unary", "member", "call", "table", "function", "mini"];
const STMT_NAMES = ["local", "assign", "expr", "return", "if", "while", "repeat", "fornum", "forin", "break", "continue", "do", "func"];

/** Per-(seed,key,salt) keystream parameters shared by the static salt-map builder and the stateful per-node decoder. */
function opcodeKeystream(seq: number, key: number, salt: number) {
  const mixed = (key + seq * 149 + salt * 53) & OP_MASK;
  const m = (mixed ^ (((seq * 17) + (salt * 29)) & OP_MASK)) & OP_MASK;
  const sp = (((key >>> (seq & 7)) ^ (((seq * 97) + (salt * 11)) & OP_MASK))) & OP_MASK;
  const sh = ((seq + salt + (key % 7)) % 15) + 1;
  const a = (sp + salt + seq * 3) & OP_MASK;
  const ma = (m + sp + sh) & OP_MASK;
  return { m, sh, a, ma };
}

function rotl16(v: number, shift: number): number {
  const s = shift & 15;
  if (s === 0) return v & OP_MASK;
  return (((v << s) | (v >>> (16 - s))) & OP_MASK) >>> 0;
}
function rotr16(v: number, shift: number): number {
  const s = shift & 15;
  if (s === 0) return v & OP_MASK;
  return (((v >>> s) | (v << (16 - s))) & OP_MASK) >>> 0;
}

function decodeStaticOpcode(encoded: number, seq: number, key: number, salt: number): number {
  const ks = opcodeKeystream(seq, key, salt);
  let r = (encoded ^ ks.ma) & OP_MASK;
  r = (r - ks.a + 0x10000) & OP_MASK;
  r = rotr16(r, ks.sh);
  r = (r ^ ks.m) & OP_MASK;
  return r >>> 0;
}

function deriveFunctionKey(opcodeSeed: number, fnIndex: number): number {
  const v = (opcodeSeed + fnIndex * 977 + fnIndex * 131) & OP_MASK;
  return v === 0 ? 1 : v;
}

/** Build a static encoded-value -> name map from the [encoded, [seq, ...]] spec list embedded per-build. */
function buildStaticOpcodeMap(specs: Array<[number, [number, ...unknown[]]]>, defSeed: number, salt: number, names: string[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const [encoded, meta] of specs) {
    const seq = meta[0];
    m.set(decodeStaticOpcode(encoded, seq, defSeed, salt), names[seq - 1]);
  }
  return m;
}

interface DecodeSalts {
  lval: number;
  field: number;
  expr: number;
  stmt: number;
  binary: number;
  unary: number;
  defBinary: number;
  defUnary: number;
  defExpr: number;
  defStmt: number;
}

function makeSalts(nodeSalts: number[], binUnarySalts: number[], defaults: number[]): DecodeSalts {
  return {
    lval: nodeSalts[0] || 0,
    field: nodeSalts[1] || 0,
    expr: nodeSalts[2] || 0,
    stmt: nodeSalts[3] || 0,
    binary: binUnarySalts[0] || 0,
    unary: binUnarySalts[1] || 0,
    defBinary: defaults[0] || 0,
    defUnary: defaults[1] || 0,
    defExpr: defaults[2] || 0,
    defStmt: defaults[3] || 0,
  };
}

function saltsValid(
  salts: DecodeSalts,
  defSeed: number,
  binarySpecs: Array<[number, [number, ...unknown[]]]>,
  exprSpecs: Array<[number, [number, ...unknown[]]]>,
  stmtSpecs: Array<[number, [number, ...unknown[]]]>
): boolean {
  try {
    const bm = buildStaticOpcodeMap(binarySpecs, defSeed, salts.defBinary, BINARY_NAMES);
    const em = buildStaticOpcodeMap(exprSpecs, defSeed, salts.defExpr, EXPR_NAMES);
    const sm = buildStaticOpcodeMap(stmtSpecs, defSeed, salts.defStmt, STMT_NAMES);
    return (
      [...bm.values()].every((n) => BINARY_NAMES.includes(n)) &&
      [...em.values()].every((n) => EXPR_NAMES.includes(n)) &&
      [...sm.values()].every((n) => STMT_NAMES.includes(n)) &&
      bm.size > 0 &&
      em.size > 0 &&
      sm.size > 0
    );
  } catch {
    return false;
  }
}

/** Extract candidate node/bin-unary/default salt values by matching the source's helper-call shapes. */
function extractSaltCandidates(src: string): { dec: number[]; decB: number[]; def: number[] } {
  const seen = new Set<number>();
  const add = (arr: number[], v: number) => {
    if (v > 0 && v <= 65535 && !seen.has(v)) {
      seen.add(v);
      arr.push(v);
    }
  };
  const d1: number[] = [];
  const d2: number[] = [];
  const df: number[] = [];
  for (const m of src.matchAll(/\[1\],\s*\w{1,3}\[1\],\s*\w{1,3},\s*(\d{1,5}),\s*\w{1,3}\[3\],\s*\w{1,3}\[5\]/g)) add(d1, parseInt(m[1], 10));
  for (const m of src.matchAll(/\[2\],\s*\w{1,3}\[2\],\s*\w{1,3},\s*(\d{1,5}),\s*\w{1,3}\[4\],\s*\w{1,3}\[6\]/g)) add(d2, parseInt(m[1], 10));
  for (const m of src.matchAll(/\[1\],\s*\w{1,3},\s*\w{1,3},\s*(\d{1,5})\)/g)) add(df, parseInt(m[1], 10));
  return { dec: d1, decB: d2, def: df };
}

function resolveDecodeSalts(
  candidates: { dec: number[]; decB: number[]; def: number[] },
  defSeed: number,
  binarySpecs: Array<[number, [number, ...unknown[]]]>,
  exprSpecs: Array<[number, [number, ...unknown[]]]>,
  stmtSpecs: Array<[number, [number, ...unknown[]]]>
): DecodeSalts {
  const initial = makeSalts(candidates.dec, candidates.decB, candidates.def);
  if (saltsValid(initial, defSeed, binarySpecs, exprSpecs, stmtSpecs)) return initial;

  const n = Math.min(candidates.def.length, 4);
  for (const perm of permutations([...Array(n).keys()])) {
    const s = makeSalts(candidates.dec, candidates.decB, perm.map((i) => candidates.def[i]));
    if (saltsValid(s, defSeed, binarySpecs, exprSpecs, stmtSpecs)) return s;
  }
  return initial;
}

// ---------------------------------------------------------------------------
// Stateful per-node IR opcode decoding
// ---------------------------------------------------------------------------

interface RoleMaps {
  binary: Map<number, string>;
  unary: Map<number, string>;
  expr: Map<number, string>;
  stmt: Map<number, string>;
  lval: Map<number, string>;
  field: Map<number, string>;
}

interface DecodeState {
  nodeSeq: number;
  opSeq: number;
  prevNode: number;
  prevOp: number;
  nodeHash: number;
  opHash: number;
}

function mixState(prev: number, hash: number, seq: number, salt: number): number {
  return (prev * 131 + hash * 17 + salt + seq) & OP_MASK;
}
function advanceHash(hash: number, delta: number, seq: number, salt: number): number {
  return (hash * 257 + delta + salt + seq) & OP_MASK;
}

function decodeNodeOpcode(encoded: number, key: number, salt: number, st: DecodeState): number {
  st.nodeSeq += 1;
  const raw = decodeStaticOpcode(encoded, st.nodeSeq, key, salt);
  const mixer = mixState(st.prevNode, st.nodeHash, st.nodeSeq, salt);
  const resolved = (raw ^ mixer) & OP_MASK;
  st.prevNode = resolved;
  st.nodeHash = advanceHash(st.nodeHash, resolved, st.nodeSeq, salt);
  return resolved;
}
function decodeOpOpcode(encoded: number, key: number, salt: number, st: DecodeState): number {
  st.opSeq += 1;
  const raw = decodeStaticOpcode(encoded, st.opSeq, key, salt);
  const mixer = mixState(st.prevOp, st.opHash, st.opSeq, salt);
  const resolved = (raw ^ mixer) & OP_MASK;
  st.prevOp = resolved;
  st.opHash = advanceHash(st.opHash, resolved, st.opSeq, salt);
  return resolved;
}

// IR nodes are plain heterogeneous arrays, mirroring the wire format.
type Ir = any[];

function roleName(map: Map<number, string>, code: number, fallback: string): string {
  return map.get(code) ?? `${fallback}_${code}`;
}

function decodeExpr(e: Ir | null, key: number, st: DecodeState, salts: DecodeSalts, rm: RoleMaps): Ir | null {
  if (!e || !Array.isArray(e)) return e;
  const a = e.slice();
  const rawTag = decodeNodeOpcode(a[0], key, salts.expr, st);
  const name = roleName(rm.expr, rawTag, "expr");
  a[0] = name;
  switch (name) {
    case "binary":
      a[1] = roleName(rm.binary, decodeOpOpcode(a[1], key, salts.binary, st), "bin");
      a[2] = decodeExpr(a[2], key, st, salts, rm);
      a[3] = decodeExpr(a[3], key, st, salts, rm);
      break;
    case "unary":
      a[1] = roleName(rm.unary, decodeOpOpcode(a[1], key, salts.unary, st), "un");
      a[2] = decodeExpr(a[2], key, st, salts, rm);
      break;
    case "member":
      a[1] = decodeExpr(a[1], key, st, salts, rm);
      if (a[3] === 1) a[2] = decodeExpr(a[2], key, st, salts, rm);
      break;
    case "call":
      a[1] = decodeExpr(a[1], key, st, salts, rm);
      a[2] = (a[2] as Ir[]).map((x) => decodeExpr(x, key, st, salts, rm));
      break;
    case "table":
      a[1] = (a[1] as Ir[]).map((f) => decodeField(f, key, st, salts, rm));
      break;
  }
  return a;
}

function decodeLvalue(lv: Ir, key: number, st: DecodeState, salts: DecodeSalts, rm: RoleMaps): Ir {
  const a = lv.slice();
  const rawTag = decodeNodeOpcode(a[0], key, salts.lval, st);
  let name = rm.lval.get(rawTag);
  if (!name) {
    name = lv.length === 2 ? "id" : "member";
    rm.lval.set(rawTag, name);
  }
  a[0] = name;
  if (a[0] === "member") {
    a[1] = decodeExpr(a[1], key, st, salts, rm);
    if (a[3] === 1) a[2] = decodeExpr(a[2], key, st, salts, rm);
  }
  return a;
}

function decodeField(f: Ir, key: number, st: DecodeState, salts: DecodeSalts, rm: RoleMaps): Ir {
  const a = f.slice();
  const rawTag = decodeNodeOpcode(a[0], key, salts.field, st);
  let name = rm.field.get(rawTag);
  if (!name) {
    if (f.length === 2) name = "array";
    else if (typeof f[1] === "number") name = "record";
    else name = "general";
    rm.field.set(rawTag, name);
  }
  a[0] = name;
  if (a[0] === "array") a[1] = decodeExpr(a[1], key, st, salts, rm);
  else if (a[0] === "record") a[2] = decodeExpr(a[2], key, st, salts, rm);
  else {
    a[1] = decodeExpr(a[1], key, st, salts, rm);
    a[2] = decodeExpr(a[2], key, st, salts, rm);
  }
  return a;
}

function decodeStmt(s: Ir, key: number, st: DecodeState, salts: DecodeSalts, rm: RoleMaps): Ir {
  const a = s.slice();
  const rawTag = decodeNodeOpcode(a[0], key, salts.stmt, st);
  const name = roleName(rm.stmt, rawTag, "stmt");
  a[0] = name;
  switch (name) {
    case "local":
      a[2] = (a[2] as Ir[]).map((e) => decodeExpr(e, key, st, salts, rm));
      break;
    case "assign":
      a[1] = (a[1] as Ir[]).map((lv) => decodeLvalue(lv, key, st, salts, rm));
      a[2] = (a[2] as Ir[]).map((e) => decodeExpr(e, key, st, salts, rm));
      break;
    case "expr":
      a[1] = decodeExpr(a[1], key, st, salts, rm);
      break;
    case "return":
      a[1] = (a[1] as Ir[]).map((e) => decodeExpr(e, key, st, salts, rm));
      break;
    case "if":
      a[1] = (a[1] as Array<[Ir, Ir[]]>).map(([c, body]) => [
        decodeExpr(c, key, st, salts, rm),
        body.map((x) => decodeStmt(x, key, st, salts, rm)),
      ]);
      if (a[2]) a[2] = (a[2] as Ir[]).map((x) => decodeStmt(x, key, st, salts, rm));
      break;
    case "while":
      a[1] = decodeExpr(a[1], key, st, salts, rm);
      a[2] = (a[2] as Ir[]).map((x) => decodeStmt(x, key, st, salts, rm));
      break;
    case "repeat":
      a[1] = (a[1] as Ir[]).map((x) => decodeStmt(x, key, st, salts, rm));
      a[2] = decodeExpr(a[2], key, st, salts, rm);
      break;
    case "fornum":
      a[2] = decodeExpr(a[2], key, st, salts, rm);
      a[3] = decodeExpr(a[3], key, st, salts, rm);
      if (a[4]) a[4] = decodeExpr(a[4], key, st, salts, rm);
      a[5] = (a[5] as Ir[]).map((x) => decodeStmt(x, key, st, salts, rm));
      break;
    case "forin":
      a[2] = (a[2] as Ir[]).map((e) => decodeExpr(e, key, st, salts, rm));
      a[3] = (a[3] as Ir[]).map((x) => decodeStmt(x, key, st, salts, rm));
      break;
    case "do":
      a[1] = (a[1] as Ir[]).map((x) => decodeStmt(x, key, st, salts, rm));
      break;
    case "func":
      a[2] = decodeLvalue(a[2], key, st, salts, rm);
      break;
  }
  return a;
}

interface DecodedFn {
  params: number[];
  vararg: boolean;
  body: Ir[];
}

function decodeFunction(raw: Ir, opcodeSeed: number, fnIndex: number, salts: DecodeSalts, rm: RoleMaps): DecodedFn {
  const params = Array.isArray(raw[0]) ? raw[0] : [];
  const rawBody: Ir[] = Array.isArray(raw[1]) ? raw[1] : [];
  const vararg = raw[2] === 1;
  const key = deriveFunctionKey(opcodeSeed, fnIndex);
  const st: DecodeState = { nodeSeq: 0, opSeq: 0, prevNode: 0, prevOp: 0, nodeHash: 0, opHash: 0 };
  const body = rawBody.map((x) => decodeStmt(x, key, st, salts, rm));
  return { params, vararg, body };
}

interface DecodedIr {
  entry: number;
  fns: DecodedFn[];
}

function decodeIr(payload: JsonLike[], salts: DecodeSalts, rm: RoleMaps): DecodedIr {
  const entry = payload[1] as unknown as number;
  const rawFns = payload[2] as unknown as Ir[];
  const meta = payload[3] as unknown as [number, ...unknown[]];
  const opcodeSeed = meta[0];
  const fns = rawFns.map((f, i) => decodeFunction(f, opcodeSeed, i + 1, salts, rm));
  return { entry, fns };
}

// ---------------------------------------------------------------------------
// Dead-branch trimming (opaque `if <literal-false>` wrappers left by codegen)
// ---------------------------------------------------------------------------

function isLiteralFalseCondition(cond: Ir | null): boolean {
  if (!cond || !Array.isArray(cond)) return false;
  if (cond[0] === "bool" && cond[1] !== 1) return true;
  if (cond[0] === "mini" && Array.isArray(cond[1]) && cond[1].length === 1) {
    const step = cond[1][0];
    if (Array.isArray(step) && step[0] === 4 && step[1] !== 1) return true;
  }
  return false;
}

function trimDeadIfs(stmts: Ir[] | null | undefined): Ir[] | null | undefined {
  if (!stmts) return stmts;
  if (!Array.isArray(stmts)) return stmts;
  for (let i = 0; i < stmts.length; i++) {
    const x = stmts[i];
    if (!x) continue;
    if (x[0] === "if" && x[1] && x[1].length === 1 && (!x[2] || x[2].length === 0)) {
      const cond = x[1][0][0];
      if (isLiteralFalseCondition(cond)) {
        stmts.splice(i, 1);
        i--;
        continue;
      }
    }
    stmts[i] = visitStmtForTrim(x);
  }
  return stmts;
}

function visitStmtForTrim(x: Ir): Ir {
  if (!x || typeof x[0] !== "string") return x;
  if (x[0] === "if") {
    if (x[1]) x[1].forEach((c: [Ir, Ir[]]) => { c[1] = trimDeadIfs(c[1]) as Ir[]; });
    if (x[2]) x[2] = trimDeadIfs(x[2]) as Ir[];
  } else if (["while", "repeat", "fornum", "forin", "do"].includes(x[0])) {
    const idx = x[0] === "while" ? 2 : x[0] === "repeat" ? 1 : x[0] === "fornum" ? 5 : x[0] === "forin" ? 3 : 1;
    if (x[idx]) x[idx] = trimDeadIfs(x[idx]);
  }
  return x;
}

// ---------------------------------------------------------------------------
// Name/string table extraction (XOR'd literal arrays, optionally permuted)
// ---------------------------------------------------------------------------

function xorDecodeTableEntry(escaped: string, key: number): string {
  const bytes = Buffer.alloc(escaped.length);
  for (let i = 0; i < escaped.length; i++) {
    bytes[i] = (escaped.charCodeAt(i) ^ ((key + i + 1) & 0xff)) & 0xff;
  }
  return bytes.toString("utf8");
}

function unescapeLuaString(x: string): string {
  return x.replace(/\\(\d{1,3})|\\n|\\r|\\t|\\"|\\\\|\\0/g, (m, d) => {
    if (d !== undefined) return String.fromCharCode(parseInt(d, 10));
    if (m === "\\n") return "\n";
    if (m === "\\r") return "\r";
    if (m === "\\t") return "\t";
    if (m === '\\"') return '"';
    if (m === "\\\\") return "\\";
    if (m === "\\0") return "\0";
    return m;
  });
}

function joinAdjacentStringLiteral(expr: string): string {
  const parts: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) parts.push(unescapeLuaString(m[1]));
  return parts.join("");
}

function extractPermutedTable(block: string, prefix: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `([a-zA-Z0-9_]+)\\[\\{((?:"(?:[^"\\\\]|\\\\.)*"\\s*(?:\\.\\.\\s*"(?:[^"\\\\]|\\\\.)*"\\s*)*)),\\s*(\\d+)\\s*\\}\\]`,
    "g"
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    if (m[1] === prefix) out.push(xorDecodeTableEntry(joinAdjacentStringLiteral(m[2]), parseInt(m[3], 10)));
  }
  return out;
}

/** Recover the (permuted) name/string tables the obfuscator embeds as XOR'd literal arrays. */
function extractNamesAndStrings(src: string): { names: string[]; strings: string[] } {
  // The tables live on a well-known source line in most builds; fall back to
  // a whole-source scan for forks that reformat the wrapper.
  const line = src.split("\n")[3] || src;
  const w8 = line.indexOf("W[8]={");
  const w9 = line.indexOf("W[9]={");

  let rawStrings: string[] = [];
  let names: string[] = [];

  if (w8 > -1) {
    const end = w9 > w8 ? w9 : w8 + 8000;
    const block = line.slice(w8, end);
    const prefixMatch = /W\[8\]=\{(\w+)\[/.exec(block);
    rawStrings = extractPermutedTable(block, prefixMatch ? prefixMatch[1] : "f80");
  }
  if (w9 > -1) {
    const block = line.slice(w9, w9 + 20000);
    const prefixMatch = /W\[9\]=\{(\w+)\[/.exec(block);
    names = extractPermutedTable(block, prefixMatch ? prefixMatch[1] : "g80");
  }

  if (rawStrings.length === 0 && names.length === 0) {
    const byPrefix = new Map<string, string[]>();
    const re = /([a-zA-Z0-9_]+)\[\{\s*((?:"(?:[^"\\]|\\.)*"\s*(?:\.\.\s*"(?:[^"\\]|\\.)*"\s*)*))\s*,\s*(\d+)\s*\}\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (!byPrefix.has(m[1])) byPrefix.set(m[1], []);
      byPrefix.get(m[1])!.push(xorDecodeTableEntry(joinAdjacentStringLiteral(m[2]), parseInt(m[3], 10)));
    }
    const keys = [...byPrefix.keys()];
    rawStrings = byPrefix.get(keys[0]) || [];
    names = byPrefix.get(keys[1]) || [];
  }

  // Permutation stride/offset: W[10]/W[11] pick out `stride`/`offset` from a
  // couple of self-evaluating IIFE shapes the obfuscator uses across builds.
  const evalPair = (idx: 10 | 11): number => {
    const patterns = [
      { re: new RegExp(`\\[${idx}\\]=\\(\\(function\\(\\)return\\s+(\\d+)\\s+end\\)\\(\\)-(\\d+)\\)`), fn: (a: number, b: number) => a - b },
      { re: new RegExp(`\\[${idx}\\]=\\(\\((\\d+)\\)-\\((\\d+)\\)\\)`), fn: (a: number, b: number) => a - b },
      { re: new RegExp(`W\\[${idx}\\]=\\(\\(\\(\\(\\((\\d+)\\)\\+(\\d+)\\)-\\2\\)/(\\d+)\\)\\)`), fn: (a: number, _b: number, c?: number) => Math.floor(a / (c || 1)) },
    ];
    for (const p of patterns) {
      const m = p.re.exec(line);
      if (m) return p.fn(parseInt(m[1], 10), parseInt(m[2], 10), m[3] !== undefined ? parseInt(m[3], 10) : undefined);
    }
    return idx === 10 ? 1 : 0;
  };
  const stride = evalPair(10);
  const offset = evalPair(11);

  let strings = rawStrings;
  if (rawStrings.length > 0 && (stride !== 1 || offset !== 0)) {
    const total = rawStrings.length * 3;
    strings = new Array(total);
    for (let a = 1; a <= total; a++) strings[a - 1] = rawStrings[((a - 1) * stride + offset) % rawStrings.length];
  }
  return { names, strings };
}

// ---------------------------------------------------------------------------
// IR -> Lua codegen
// ---------------------------------------------------------------------------

const BIN_SYMS = BINARY_NAMES;
const UN_SYMS = UNARY_NAMES;
const PRECEDENCE: Record<string, number> = {
  or: 1, and: 2, "<": 3, "<=": 3, ">": 3, ">=": 3, "==": 3, "~=": 3,
  "..": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "#": 7, not: 7, "^": 8,
};

function needsParens(outerOp: string, innerOp: string | null, isRhs: boolean): boolean {
  const p = PRECEDENCE[outerOp] || 0;
  const cp = PRECEDENCE[innerOp || ""] || 0;
  if (cp === 0) return false;
  if (p > cp) return true;
  if (p === cp && isRhs && outerOp !== "^") return true;
  return false;
}

function operatorOf(node: Ir | null): string | null {
  if (!node || !Array.isArray(node)) return null;
  if (node[0] === "binary") return typeof node[1] === "string" ? node[1] : BIN_SYMS[(node[1] || 1) - 1] || "?";
  if (node[0] === "unary") return typeof node[1] === "string" ? node[1] : UN_SYMS[(node[1] || 1) - 1] || "?";
  return null;
}

function luaStringLiteral(s: string | undefined): string {
  if (s === undefined || s === null) return '""';
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
}

class LuaCodegen {
  indent = 0;
  constructor(private names: string[], private strings: string[]) {}

  private name(ref: number): string {
    return this.names[ref - 1] || `_n${ref}`;
  }
  private str(ref: number): string | undefined {
    return this.strings[ref - 1];
  }
  private pad(): string {
    return "  ".repeat(this.indent);
  }

  expr(e: Ir | null, fns: DecodedFn[]): string {
    if (!e || !Array.isArray(e)) return "?";
    const [t, ...a] = e;
    switch (t) {
      case "id":
        return this.name(a[0]);
      case "str":
        return luaStringLiteral(this.str(a[0]));
      case "num":
        return String(a[0]);
      case "bool":
        return a[0] === 1 ? "true" : "false";
      case "nil":
        return "nil";
      case "vararg":
        return "...";
      case "binary": {
        const op = typeof a[0] === "string" ? a[0] : BIN_SYMS[(a[0] || 1) - 1] || "?";
        const [lhs, rhs] = [a[1], a[2]];
        const l = this.expr(lhs, fns);
        const r = this.expr(rhs, fns);
        const wl = lhs && needsParens(op, operatorOf(lhs), false);
        const wr = rhs && needsParens(op, operatorOf(rhs), true);
        return `${wl ? "(" + l + ")" : l} ${op} ${wr ? "(" + r + ")" : r}`;
      }
      case "unary": {
        const op = typeof a[0] === "string" ? a[0] : UN_SYMS[(a[0] || 1) - 1] || "?";
        const operand = this.expr(a[1], fns);
        const sp = /[a-z]/.test(op) ? " " : "";
        return `${op}${sp}${operand}`;
      }
      case "member": {
        const base = this.expr(a[0], fns);
        if (a[2] === 1) return `${base}[${this.expr(a[1], fns)}]`;
        return `${base}.${this.name(a[1])}`;
      }
      case "call": {
        const [callee, args, isMethod] = [a[0], a[1] || [], a[2] === 1];
        if (isMethod && Array.isArray(callee) && callee[0] === "member" && callee[2] !== 1) {
          const obj = this.expr(callee[1], fns);
          const method = this.name(callee[2]);
          return `${obj}:${method}(${(args as Ir[]).map((x) => this.expr(x, fns)).join(", ")})`;
        }
        return `${this.expr(callee, fns)}(${(args as Ir[]).map((x) => this.expr(x, fns)).join(", ")})`;
      }
      case "table": {
        const fields = a[0] || [];
        if (fields.length === 0) return "{}";
        return `{${(fields as Ir[]).map((x) => this.field(x, fns)).join(", ")}}`;
      }
      case "function": {
        const fn = fns[a[0] - 1];
        if (!fn) return "function(...) end";
        return this.funcExpr(fn, fns);
      }
      case "mini":
        return this.miniStack(a[0], fns);
      default:
        return "nil";
    }
  }

  private field(f: Ir, fns: DecodedFn[]): string {
    const [t, ...a] = f;
    if (t === "array") return this.expr(a[0], fns);
    if (t === "record") return `${this.name(a[0])} = ${this.expr(a[1], fns)}`;
    return `[${this.expr(a[0], fns)}] = ${this.expr(a[1], fns)}`;
  }

  /** Reverse-Polish table used by a handful of constant-folded mini-expressions. */
  private miniStack(ops: Array<[number, ...unknown[]]> | null, fns: DecodedFn[]): string {
    if (!ops || !ops.length) return "nil";
    const stack: Array<{ v: string; op: string | null }> = [];
    for (const ins of ops) {
      const code = ins[0];
      if (code === 1) stack.push({ v: this.name(ins[1] as number), op: null });
      else if (code === 2) stack.push({ v: luaStringLiteral(this.str(ins[1] as number)), op: null });
      else if (code === 3) stack.push({ v: String(ins[1]), op: null });
      else if (code === 4) stack.push({ v: ins[1] === 1 ? "true" : "false", op: null });
      else if (code === 5) stack.push({ v: "nil", op: null });
      else if (code === 6) {
        const base = stack.pop()!;
        stack.push({ v: `${base.v}.${this.name(ins[1] as number)}`, op: null });
      } else if (code === 7) {
        const key = stack.pop()!;
        const base = stack.pop()!;
        stack.push({ v: `${base.v}[${key.v}]`, op: null });
      } else if (code === 8) {
        const operand = stack.pop()!;
        const op = UN_SYMS[((ins[1] as number) || 1) - 1] || "?";
        const v = operand.op && needsParens(op, operand.op, false) ? `(${operand.v})` : operand.v;
        stack.push({ v: `${op}${/[a-z]/.test(op) ? " " : ""}${v}`, op });
      } else if (code === 9) {
        const rhs = stack.pop()!;
        const lhs = stack.pop()!;
        const op = BIN_SYMS[((ins[1] as number) || 1) - 1] || "?";
        const l = lhs.op && needsParens(op, lhs.op, false) ? `(${lhs.v})` : lhs.v;
        const r = rhs.op && needsParens(op, rhs.op, true) ? `(${rhs.v})` : rhs.v;
        stack.push({ v: `${l} ${op} ${r}`, op });
      }
    }
    return stack[0] ? stack[0].v : "nil";
  }

  private lvalue(lv: Ir, fns: DecodedFn[]): string {
    const [t, ...a] = lv;
    if (t === "id") return this.name(a[0]);
    const base = this.expr(a[0], fns);
    if (a[2] === 1) return `${base}[${this.expr(a[1], fns)}]`;
    return `${base}.${this.name(a[1])}`;
  }

  private stmt(s: Ir, fns: DecodedFn[]): string {
    if (!s || !Array.isArray(s)) return "";
    const [t, ...a] = s;
    const pad = this.pad();
    switch (t) {
      case "local": {
        const vars = (a[0] as number[]).map((r) => this.name(r)).join(", ");
        const vals = a[1] as Ir[];
        if (!vals || vals.length === 0) return `${pad}local ${vars}`;
        return `${pad}local ${vars} = ${vals.map((e) => this.expr(e, fns)).join(", ")}`;
      }
      case "assign":
        return `${pad}${(a[0] as Ir[]).map((x) => this.lvalue(x, fns)).join(", ")} = ${(a[1] as Ir[]).map((x) => this.expr(x, fns)).join(", ")}`;
      case "expr":
        return `${pad}${this.expr(a[0], fns)}`;
      case "return":
        return !a[0] || (a[0] as Ir[]).length === 0 ? `${pad}return` : `${pad}return ${(a[0] as Ir[]).map((e) => this.expr(e, fns)).join(", ")}`;
      case "if": {
        let out = "";
        const branches = a[0] as Array<[Ir, Ir[]]>;
        for (let i = 0; i < branches.length; i++) {
          out += (i === 0 ? `${pad}if ${this.expr(branches[i][0], fns)} then\n` : `${pad}elseif ${this.expr(branches[i][0], fns)} then\n`);
          out += this.block(branches[i][1], fns);
        }
        if (a[1]) out += `${pad}else\n${this.block(a[1] as Ir[], fns)}`;
        return out + `${pad}end`;
      }
      case "while":
        return `${pad}while ${this.expr(a[0], fns)} do\n${this.block(a[1] as Ir[], fns)}${pad}end`;
      case "repeat":
        return `${pad}repeat\n${this.block(a[0] as Ir[], fns)}${pad}until ${this.expr(a[1], fns)}`;
      case "fornum":
        return `${pad}for ${this.name(a[0] as number)} = ${this.expr(a[1], fns)}, ${this.expr(a[2], fns)}${a[3] ? `, ${this.expr(a[3], fns)}` : ""} do\n${this.block(a[4] as Ir[], fns)}${pad}end`;
      case "forin":
        return `${pad}for ${(a[0] as number[]).map((r) => this.name(r)).join(", ")} in ${(a[1] as Ir[]).map((e) => this.expr(e, fns)).join(", ")} do\n${this.block(a[2] as Ir[], fns)}${pad}end`;
      case "break":
        return `${pad}break`;
      case "continue":
        return `${pad}continue`;
      case "do":
        return `${pad}do\n${this.block(a[0] as Ir[], fns)}${pad}end`;
      case "func": {
        const isLocal = a[0] === 1;
        const target = this.lvalue(a[1], fns);
        const fn = fns[(a[2] as number) - 1];
        if (!fn) return `${pad}${isLocal ? "local " : ""}function ${target}() end`;
        const params = fn.params.map((r) => this.name(r)).join(", ");
        const vararg = fn.vararg ? (fn.params.length > 0 ? ", ..." : "...") : "";
        let out = `${pad}${isLocal ? "local " : ""}function ${target}(${params}${vararg})\n`;
        this.indent++;
        out += this.block(fn.body, fns);
        this.indent--;
        return out + `${pad}end`;
      }
      default:
        return "";
    }
  }

  private block(stmts: Ir[] | null | undefined, fns: DecodedFn[]): string {
    if (!stmts) return "";
    this.indent++;
    const lines = stmts.map((x) => this.stmt(x, fns)).filter(Boolean);
    this.indent--;
    return lines.map((l) => l + "\n").join("");
  }

  private funcExpr(fn: DecodedFn, fns: DecodedFn[]): string {
    const params = fn.params.map((r) => this.name(r)).join(", ");
    const vararg = fn.vararg ? (fn.params.length > 0 ? ", ..." : "...") : "";
    let out = `function(${params}${vararg})\n`;
    out += this.block(fn.body, fns);
    return out + `${this.pad()}end`;
  }

  program(ir: DecodedIr): string {
    const root = ir.fns[ir.entry - 1];
    if (!root) return "";
    return this.block(root.body, ir.fns).trimEnd();
  }
}

// ---------------------------------------------------------------------------
// Top-level driver
// ---------------------------------------------------------------------------

function runIronveilPipeline(src: string): string {
  if (!/ironveil/i.test(src)) throw new Error("ironveil: no marker found");

  const frags = findBase64Fragments(src);
  const salt = findSaltTriple(src);
  if (!salt) throw new Error("ironveil: could not locate payload salts");

  const joined = assembleFragments(frags, salt.payloadKey, salt.payloadHashSeed, salt.payloadHash);
  const payload = extractPayload(joined, salt.payloadKey, salt.payloadHashSeed, salt.payloadHash) as JsonLike[];
  if (!Array.isArray(payload) || payload.length < 4) throw new Error("ironveil: unexpected payload shape");

  const meta = payload[3] as unknown as number[][];
  const [, defSeed, binarySpecs, unarySpecs, exprSpecs, stmtSpecs] = meta as unknown as [
    number, number,
    Array<[number, [number, ...unknown[]]]>, Array<[number, [number, ...unknown[]]]>,
    Array<[number, [number, ...unknown[]]]>, Array<[number, [number, ...unknown[]]]>
  ];

  const candidates = extractSaltCandidates(src);
  const salts = resolveDecodeSalts(candidates, defSeed, binarySpecs, exprSpecs, stmtSpecs);

  // `and`/`or` are short-circuit control ops in the source rather than plain
  // binary opcodes in some builds; recover them from a distinctive adjacent
  // instruction-pair shape when present.
  let andCode: number | undefined;
  let orCode: number | undefined;
  const shortCircuitRe = new RegExp(
    `\\((\\d+),[a-zA-Z_]\\w*,${salts.binary}\\),.*?\\(((\\d+),[a-zA-Z_]\\w*,${salts.binary})\\)`
  );
  const scm = shortCircuitRe.exec(src);
  if (scm) {
    andCode = parseInt(scm[1], 10);
    orCode = parseInt(scm[3], 10);
  }

  const binaryMap = buildStaticOpcodeMap(binarySpecs, defSeed, salts.defBinary, BINARY_NAMES);
  if (andCode !== undefined) binaryMap.set(andCode, "and");
  if (orCode !== undefined) binaryMap.set(orCode, "or");

  const roleMaps: RoleMaps = {
    binary: binaryMap,
    unary: buildStaticOpcodeMap(unarySpecs, defSeed, salts.defUnary, UNARY_NAMES),
    expr: buildStaticOpcodeMap(exprSpecs, defSeed, salts.defExpr, EXPR_NAMES),
    stmt: buildStaticOpcodeMap(stmtSpecs, defSeed, salts.defStmt, STMT_NAMES),
    lval: new Map(),
    field: new Map(),
  };

  let ir: DecodedIr;
  try {
    ir = decodeIr(payload, salts, roleMaps);
    // Sanity check: if binary/unary op codes never resolved to a known
    // symbol, the two tag spaces were probably swapped — retry once.
    const dump = JSON.stringify(ir);
    if (dump.includes('"bin_') || dump.includes('"un_')) throw new Error("ironveil: unresolved operator tags");
  } catch {
    const swapped: DecodeSalts = { ...salts, binary: salts.unary, unary: salts.binary };
    roleMaps.lval = new Map();
    roleMaps.field = new Map();
    ir = decodeIr(payload, swapped, roleMaps);
  }

  for (const fn of ir.fns) fn.body = (trimDeadIfs(fn.body) as Ir[]) ?? fn.body;

  const { names, strings } = extractNamesAndStrings(src);
  const gen = new LuaCodegen(names, strings);
  return gen.program(ir);
}

// ---------------------------------------------------------------------------
// Deobfuscator wiring
// ---------------------------------------------------------------------------

export function detectIronveil(input: string): boolean {
  if (/Obfuscated\s+using\s+ironveil\s+v\d+\s*-\s*https:\/\/discord\.gg\/\w+/i.test(input)) return true;
  if (/\[\[\s*Obfuscated\s+using\s+ironveil/i.test(input)) return true;
  if (/\bironveil\b/i.test(input) && /,\d{5,12}\)[^,]{1,400},\d{5,12}\)~=\d{5,12}/.test(input)) return true;
  return false;
}

export class IronveilDeobfuscator implements Deobfuscator {
  id = "ironveil" as const;
  name = "Ironveil V1";
  description =
    "Static deobfuscation for memcpython/ironveil V1: fragment reassembly, xorshift32 + LZW payload " +
    "decode, per-build opcode-salt derivation, and IR-to-Lua codegen.";

  detect(input: string) {
    if (!detectIronveil(input)) return null;
    const hasBanner = /Obfuscated\s+using\s+ironveil/i.test(input);
    return {
      obfuscator: "ironveil" as const,
      confidence: hasBanner ? 0.95 : 0.75,
      evidence: hasBanner ? "Ironveil banner" : "Ironveil payload-salt structural pattern",
    };
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const notes: string[] = [];
    try {
      let output = runIronveilPipeline(ctx.input);

      try {
        const rn = renameObfuscatedIdentifiers(output);
        if (rn.renamed > 0) {
          output = rn.result;
          notes.push(`Renamed ${rn.renamed} cryptic identifier(s)`);
        }
      } catch { /* best-effort */ }

      try {
        output = beautifyLua(output);
      } catch { /* keep unformatted */ }

      const validation = validateLuaSource(output);
      notes.push("Recovered source via xorshift32+LZW payload decode and per-build opcode-salt derivation.");
      if (!validation.ok) {
        notes.push("Output may contain unresolved node/field tags if this build's salt layout differs from known ones.");
      }

      return {
        success: true,
        deobfuscator: this.name,
        output,
        notes,
        confidence: validation.ok ? 0.88 : 0.6,
        obfuscator: "ironveil",
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        deobfuscator: this.name,
        output: ctx.input,
        notes: [`Ironveil pipeline failed: ${msg}`],
        confidence: 0,
        obfuscator: "ironveil",
      };
    }
  }
}
