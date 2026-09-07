// Luraph VM lifter — decoded program → IR → control flow → Luau source.
//
// Inputs (all produced by the dynamic decode in luraph-vm-decode.ts):
//   - alias destructuring: the loader binds its operand-column locals from
//     the program table's fields, e.g.
//         local H,m,J,Z,r,t,p,G = E[8],E[7],E[2],E[4],E[9],E[6],E[11]
//     Parsing this gives the exact letter → program-table-field mapping.
//   - final program dump: serialised from INSIDE the interpreter on its first
//     step (the program is fully decoded by then) — opcodes + every column +
//     constants, keyed by VIP.
//   - execution trace: the VIP of every dispatch iteration (patched fetch
//     site) — the actual control flow: which VIPs run, where jumps land.
//   - dispatch handlers: opcode → handler source (from the static parse).
//
// The lifter turns each instruction into a symbolic statement (registers
// R0..Rn, constants inlined, globals resolved by name), rebuilds the control
// flow graph from jump columns validated against the trace, and emits
// structured Luau source (while-loops for back edges, if/goto otherwise).

import { FetchSite } from "./luraph-dispatch";
import { IRInst, IRStmt, structureProgram } from "./luraph-structure";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─────────────────────────────────────────────────────────────────────────────
// Alias destructuring
// ─────────────────────────────────────────────────────────────────────────────

export interface AliasInfo {
  /** Destructuring names in order (e.g. ["H","m","J","Z","r","t","p","G"]). */
  letters: string[];
  /** Paired program-table field number per letter (null when not `T[n]`). */
  fields: (number | null)[];
  /** The fetch-site opcode column letter (e.g. "Z"). */
  opLetter: string;
  /** The fetch-site VIP letter (e.g. "F"). */
  vipLetter: string;
}

/**
 * Find the multi-assignment that binds the interpreter's column locals,
 * searching backwards from the fetch site. The statement must bind the
 * opcode-column letter (e.g. `Z`) from `<tbl>[<num>]`.
 */
export function findAliasDestructuring(src: string, fetch: FetchSite): AliasInfo | null {
  const window = src.slice(Math.max(0, fetch.after - 4000), fetch.after);
  // All `local a,b,c = X[1],Y[2],...` statements in the window (last first).
  const re = /local\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*=\s*([A-Za-z_]\w*\s*\[\s*(?:0[xXbB][0-9a-fA-F_]+|\d[\d_]*)\s*\](?:\s*,\s*[A-Za-z_]\w*\s*\[\s*(?:0[xXbB][0-9a-fA-F_]+|\d[\d_]*)\s*\])*)\s*;/g;
  const candidates: Array<{ names: string[]; vals: string[]; idx: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) {
    const names = m[1].split(",").map((s) => s.trim());
    const vals = m[2].split(",").map((s) => s.trim());
    candidates.push({ names, vals, idx: m.index });
    if (candidates.length > 40) break;
  }
  // Prefer the LAST candidate (closest to the fetch) that binds opLetter.
  for (const c of candidates.reverse()) {
    const oi = c.names.indexOf(fetch.opCol);
    if (oi < 0) continue;
    if (!/^\w+\s*\[\s*(?:0[xXbB][0-9a-fA-F_]+|\d[\d_]*)\s*\]$/.test(c.vals[oi] ?? "")) continue;
    const fields: (number | null)[] = c.names.map((_, i) => {
      const vm = /^\w+\s*\[\s*((?:0[xXbB][0-9a-fA-F_]+|\d[\d_]*))\s*\]$/.exec(c.vals[i] ?? "");
      if (!vm) return null;
      const t = vm[1].replace(/_/g, "");
      if (/^0[xX]/.test(t)) return parseInt(t.slice(2), 16);
      if (/^0[bB]/.test(t)) return parseInt(t.slice(2), 2);
      return parseInt(t, 10);
    });
    return {
      letters: c.names,
      fields,
      opLetter: fetch.opCol,
      vipLetter: fetch.vipVar,
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Final program dump parsing
// ─────────────────────────────────────────────────────────────────────────────

export interface FinalProgram {
  /** vip → opcode. */
  opcodes: Map<number, number>;
  instrCount: number;
  /** letter → (vip → numeric operand value). */
  columns: Map<string, Map<number, number>>;
  /** letter → (vip → constant value) — mixed-type columns. */
  constants: Map<string, Map<number, unknown>>;
  /** register count (from fallback dump correlation; may be null). */
  registers: number | null;
}

/** Parse the JSON serialised from inside the interpreter:
 * `{ z = {["1"]=76,...}, H = {...}, m = {...}, ... }` (letter keys). */
export function parseFinalProgram(json: string, alias: AliasInfo): FinalProgram | null {
  let js: any;
  try {
    js = JSON.parse(json);
  } catch {
    return null;
  }
  if (!js || typeof js !== "object") return null;
  const opcodes = new Map<number, number>();
  let instrCount = 0;
  const columns = new Map<string, Map<number, number>>();
  const constants = new Map<string, Map<number, unknown>>();
  for (const [letter, field] of alias.letters.map((l, i) => [l, alias.fields[i]] as const)) {
    const raw = js[letter];
    if (raw === null || raw === undefined || typeof raw !== "object") continue;
    const entries = Object.keys(raw).map(Number).filter(Number.isFinite);
    if (entries.length === 0) continue;
    const isOp = letter === alias.opLetter;
    const vals = entries.map((k) => raw[String(k)]);
    const allNumeric = vals.every((v) => typeof v === "number");
    if (isOp) {
      if (!allNumeric) continue;
      for (const k of entries) opcodes.set(k, raw[String(k)] as number);
      instrCount = Math.max(...entries);
      continue;
    }
    if (allNumeric && vals.length >= 3) {
      const map = new Map<number, number>();
      for (const k of entries) map.set(k, raw[String(k)] as number);
      columns.set(letter, map);
    } else if (!allNumeric) {
      const map = new Map<number, unknown>();
      for (const k of entries) map.set(k, raw[String(k)]);
      constants.set(letter, map);
    }
  }
  if (opcodes.size < 8) return null;
  return { opcodes, instrCount, columns, constants, registers: null };
}

/** Column role resolution: which numeric column letter serves which purpose,
 * derived from the alias field numbers (Luraph v14.6–14.8 program layout:
 * 4=opcodes, 6=constants, 7/8/9=register-operand columns, 11=aux/immediates,
 * 2=sparsed immediates — but verify by value shape when available). */
export interface ColumnRoles {
  /** primary register-index column (LOADK target). */
  regA: string | null;
  /** secondary register column. */
  regB: string | null;
  /** tertiary register column. */
  regC: string | null;
  /** jump-target column. */
  jump: string | null;
  /** immediate/sparse column. */
  imm: string | null;
  /** constants column (mixed type). */
  konst: string | null;
}

export function resolveColumnRoles(program: FinalProgram, alias: AliasInfo, handlers: Map<number, string>): ColumnRoles {
  // Field-number based defaults (v14.6–14.8 layout), refined by shapes.
  const byField = new Map<string, number>();
  alias.letters.forEach((l, i) => {
    const f = alias.fields[i];
    if (f !== null) byField.set(l, f);
  });
  const has = (l: string): boolean => program.columns.has(l) || program.constants.has(l);
  const find = (f: number): string | null => alias.letters.find((l) => byField.get(l) === f && has(l)) ?? null;

  let konst = find(6);
  if (!konst) {
    // shape fallback: the mixed-type column
    for (const l of program.constants.keys()) {
      konst = l;
      break;
    }
  }
  const regA = find(9);
  const jump = find(7);
  const regB = find(8);
  const imm = find(11);
  const regC = find(2) ?? find(11);

  // Handler evidence as FALLBACK only: a *pure* jump handler `F=(x[F]);`
  // names the jump column. (Field 7 is the v14.6–14.8 jump column.)
  let jumpFromHandler: string | null = null;
  for (const text of handlers.values()) {
    const norm = text.replace(/\s+/g, " ").trim();
    const jm = /^F\s*=\s*\(?\s*(\w+)\s*\[\s*F\s*\]\s*\)?\s*;\s*$/.exec(norm);
    if (jm && jm[1] !== alias.opLetter) {
      jumpFromHandler = jm[1];
      break;
    }
  }
  return {
    regA,
    regB,
    regC,
    jump: jump ?? jumpFromHandler,
    imm,
    konst,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trace parsing & analysis
// ─────────────────────────────────────────────────────────────────────────────

export interface TraceProto {
  /** sandbox-internal program id (first-execution order). */
  id: number;
  /** opcode column length reported by the marker. */
  instrCount: number;
  /** executed VIPs in order. */
  vips: number[];
}

export function parseTrace(chunks: string[]): TraceProto[] {
  const protos: TraceProto[] = [];
  let cur: TraceProto | null = null;
  for (const chunk of chunks) {
    if (chunk.startsWith("P")) {
      const m = /^P(\d+):(\d+)$/.exec(chunk);
      if (m) {
        cur = { id: +m[1], instrCount: +m[2], vips: [] };
        protos.push(cur);
      }
    } else if (cur) {
      for (const s of chunk.split(",")) {
        const n = +s;
        if (Number.isFinite(n) && n > 0) cur.vips.push(n);
      }
    }
  }
  return protos;
}

export interface FlowFacts {
  /** vip → (target vip → times observed). */
  jumps: Map<number, Map<number, number>>;
  /** vip → times observed falling through to vip+1. */
  straight: Map<number, number>;
  /** total steps observed for the proto. */
  steps: number;
}

export function analyzeFlow(vips: number[]): FlowFacts {
  const jumps = new Map<number, Map<number, number>>();
  const straight = new Map<number, number>();
  for (let i = 0; i + 1 < vips.length; i++) {
    const a = vips[i];
    const b = vips[i + 1];
    if (b === a + 1) {
      straight.set(a, (straight.get(a) ?? 0) + 1);
      continue;
    }
    if (!jumps.has(a)) jumps.set(a, new Map());
    const t = jumps.get(a)!;
    t.set(b, (t.get(b) ?? 0) + 1);
  }
  return { jumps, straight, steps: vips.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Symbolic scratch machine
// ─────────────────────────────────────────────────────────────────────────────
//
// Luraph VM handlers come in two flavours:
//   1. DIRECT ops — read operand columns, touch f[reg] immediately.
//   2. SCRATCH ops — manipulate closure-local scratch variables (I,z,e,C,M,b,…)
//      that persist across instructions; compound operations (getglobal,
//      method call, table copy, range clear) are spelled as several opcodes.
// The lifter therefore keeps a symbolic value per scratch slot and renders a
// statement only when a value is materialised into a register/table — the
// multi-instruction sequences collapse back into single readable statements.

export type Sym =
  | { k: "reg"; n: number }
  | { k: "konst"; v: unknown }
  | { k: "imm"; v: number }
  | { k: "global"; name: string }
  | { k: "globals" } // the env table itself
  | { k: "regs" } // the register array itself
  | { k: "col"; letter: string }
  | { k: "index"; obj: Sym; key: Sym; }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "%" | ".." | "==" | "~=" | "<" | "<=" | ">" | ">=" | "#"; a: Sym; b?: Sym }
  | { k: "call"; fn: Sym; args: Sym[] }
  | { k: "table" }
  | { k: "un"; op: "not" | "-"; a: Sym }
  | { k: "upval"; n: number }
  | { k: "vararg" }
  | { k: "scratch"; name: string }
  | { k: "unk"; note: string };

const LUA_IDENT_RE = /^[A-Za-z_]\w*$/;

function fmtConst(v: unknown): string | null {
  if (typeof v === "string") {
    const s = v.length > 100 ? v.slice(0, 100) + "…" : v;
    return JSON.stringify(s);
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return Number.isInteger(v) ? String(v) : String(v);
  }
  if (typeof v === "boolean") return String(v);
  return null;
}

/** Render a symbolic expression to Lua source. */
export function renderSym(s: Sym | undefined): string {
  if (!s) return "<nil>";
  switch (s.k) {
    case "reg":
      return `R${s.n}`;
    case "konst":
      return fmtConst(s.v) ?? "<nonprintable>";
    case "imm":
      return String(s.v);
    case "global":
      return LUA_IDENT_RE.test(s.name) ? s.name : `_G[${JSON.stringify(s.name)}]`;
    case "globals":
      return "_G";
    case "regs":
      return "R"; // the register array, rendered as a table named R
    case "col":
      return `VM_COL_${s.letter}`;
    case "index": {
      const obj = renderSym(s.obj);
      if (s.key.k === "konst" && typeof s.key.v === "string" && LUA_IDENT_RE.test(s.key.v)) {
        return `${obj}.${s.key.v}`;
      }
      return `${obj}[${renderSym(s.key)}]`;
    }
    case "bin": {
      const a = renderSym(s.a);
      const b = s.b === undefined ? "" : renderSym(s.b);
      if (s.op === "#") return `#${a}`;
      return `(${a} ${s.op} ${b})`;
    }
    case "call": {
      const fn = renderSym(s.fn);
      return `${fn}(${s.args.map(renderSym).join(", ")})`;
    }
    case "table":
      return "{}";
    case "un":
      return s.op === "not" ? `(not ${renderSym(s.a)})` : `(-${renderSym(s.a)})`;
    case "upval":
      return `U${s.n}`;
    case "vararg":
      return "...";
    case "scratch":
      return `<${s.name}>`;
    case "unk":
      return `/*${s.note}*/`;
  }
}

/** Context bound to one program: operand column access. */
export class LiftCtx {
  constructor(
    public program: FinalProgram,
    public roles: ColumnRoles,
    public alias: AliasInfo,
  ) {}
  col(letter: string, vip: number): number | undefined {
    return this.program.columns.get(letter)?.get(vip);
  }
  konstAt(letter: string, vip: number): unknown {
    return this.program.constants.get(letter)?.get(vip);
  }
  /** resolve a role letter with fallbacks */
  roleLetter(role: "regA" | "regB" | "regC" | "jump" | "imm" | "konst"): string | null {
    return this.roles[role];
  }
}

/** One matched instruction → a sequence of effects. */
interface Effects {
  /** scratch assignments, in order. */
  scratch: Array<[string, Sym]>;
  /** register stores: f[reg] = sym. */
  stores: Array<{ reg: number | Sym; src: Sym }>;
  /** keyed stores: obj[key] = src. */
  kstores: Array<{ obj: Sym; key: Sym; src: Sym }>;
  /** clear register range. */
  clearRange?: { lo: number | Sym; hi: number | Sym };
  /** unconditional jump target (already +1-adjusted VIP). */
  jumpTo?: number;
  /** conditional jump: take it when `cond` holds. */
  condJump?: { cond: Sym; target: number };
  /** call: base register, arg count, result count. */
  call?: { base: number | Sym; argc: number; retc: number };
  /** return statement. */
  ret?: { kind: "void" | "values" | "vararg" };
  /** resolved mnemonic. */
  mnemonic: string;
  /** extra comment. */
  comment?: string;
}

interface Rule2 {
  name: string;
  parts: string[]; // raw Lua text + {letter} placeholders
  gen: (ctx: LiftCtx, vip: number, L: Record<string, string>) => Partial<Effects> | null;
}

export function buildRuleRegex(parts: string[], alias: AliasInfo, extra: Record<string, string>): RegExp | null {
  let out = "";
  for (const p of parts) {
    // substitute {placeholder} tokens FIRST, then escape the remainder
    const substituted = p.replace(/\{(\w+)\}/g, (_all, key: string) => {
      const letter = key in extra ? extra[key] : key === "F" ? alias.vipLetter : key;
      return letter;
    });
    out += substituted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + out + "$");
}

/**
 * Build the semantic rule table for a sample. `L` maps role names to the
 * concrete letters of THIS sample (regA, regB, regC, jump, imm, imm2, konst,
 * and the fixed f/F/R/D names).
 */
// Rule2[] builder — written via Write tool to avoid shell ]] mangling.
// The parts below are EXACT matches against the normalised minified handler
// text (single spaces, dispatch remnants stripped). Placeholders {regA} etc.
// are substituted with the concrete per-sample letters before escaping.

// Token-list rule builder — immune to shell bracket mangling.
// Each rule is a token sequence; literal tokens are short (single chars),
// role tokens start with "@" and expand to the concrete per-sample letters.
// Matching is a plain sequential walk — no regex, no escaping.

export interface TokRule {
  name: string;
  tokens: string[];
  gen: (ctx: LiftCtx, vip: number) => Partial<Effects> | null;
}

export function buildRulesTokens(alias: AliasInfo, roles: ColumnRoles): TokRule[] {
  const rules: TokRule[] = [];
  const add = (name: string, tokens: string[], gen: TokRule["gen"]): void => {
    rules.push({ name, tokens, gen });
  };
  const R_ = (letter: string, vip: number, ctx: LiftCtx): Sym => ({ k: "reg", n: ctx.col(letter, vip) ?? 0 });
  const konstSym = (ctx: LiftCtx, vip: number): Sym => {
    const k = roles.konst;
    const v = k ? ctx.konstAt(k, vip) : undefined;
    if (v === undefined) return { k: "unk", note: "no-const" };
    return { k: "konst", v };
  };
  const immSym = (ctx: LiftCtx, letter: string, vip: number): Sym => ({
    k: "imm",
    v: ctx.col(letter, vip) ?? 0,
  });
  const konstName = (ctx: LiftCtx, vip: number): string | null => {
    const k = roles.konst;
    if (!k) return null;
    const v = ctx.konstAt(k, vip);
    return typeof v === "string" ? v : null;
  };
  const SC = (name: string): Sym => ({ k: "scratch", name });

  // Helper token shorthands (all single literals, safe)
  const A = "@regA", B = "@regB", C = "@regC", J = "@jump", IM = "@imm", K = "@konst";

  // ── direct ops ──
  // f[r[F]]=t[F];
  add("LOADK", ["f", "[", A, "[", "F", "]", "]", "=", K, "[", "F", "]", ";"], (ctx, vip) => ({
    stores: [{ reg: ctx.col(roles.regA ?? "r", vip) ?? 0, src: konstSym(ctx, vip) }],
  }));
  // f[m[F]]=(f[r[F]]);
  add("MOVE", ["f", "[", J, "[", "F", "]", "]", "=", "(", "f", "[", A, "[", "F", "]", "]", ")", ";"], (ctx, vip) => ({
    stores: [{ reg: ctx.col(roles.jump ?? "m", vip) ?? 0, src: R_(roles.regA ?? "r", vip, ctx) }],
  }));
  // (f)[r[F]]={};
  add("NEWTABLE", ["(", "f", ")", "[", A, "[", "F", "]", "]", "=", "{", "}", ";"], (ctx, vip) => ({
    stores: [{ reg: ctx.col(roles.regA ?? "r", vip) ?? 0, src: { k: "table" } }],
  }));
  // f[r[F]]={};
  add("NEWTABLE2", ["f", "[", A, "[", "F", "]", "]", "=", "{", "}", ";"], (ctx, vip) => ({
    stores: [{ reg: ctx.col(roles.regA ?? "r", vip) ?? 0, src: { k: "table" } }],
  }));
  // (f[r[F]])[t[F]]=(f[m[F]]);
  add("SETTABLE_KR", ["(", "f", "[", A, "[", "F", "]", "]", ")", "[", K, "[", "F", "]", "]", "=", "(", "f", "[", J, "[", "F", "]", "]", ")", ";"], (ctx, vip) => ({
    kstores: [
      { obj: R_(roles.regA ?? "r", vip, ctx), key: konstSym(ctx, vip), src: R_(roles.jump ?? "m", vip, ctx) },
    ],
  }));
  // (f[r[F]])[p[F]]=t[F];
  add("SETTABLE_PI", ["(", "f", "[", A, "[", "F", "]", "]", ")", "[", IM, "[", "F", "]", "]", "=", K, "[", "F", "]", ";"], (ctx, vip) => ({
    kstores: [
      { obj: R_(roles.regA ?? "r", vip, ctx), key: immSym(ctx, roles.imm ?? "p", vip), src: konstSym(ctx, vip) },
    ],
  }));
  // (f)[r[F]]=(R[t[F]]);
  add("GETGLOBAL", ["(", "f", ")", "[", A, "[", "F", "]", "]", "=", "(", "@R", "[", K, "[", "F", "]", "]", ")", ";"], (ctx, vip) => {
    const name = konstName(ctx, vip);
    if (name !== null) return { stores: [{ reg: ctx.col(roles.regA ?? "r", vip) ?? 0, src: { k: "global", name } }] };
    return {
      stores: [
        {
          reg: ctx.col(roles.regA ?? "r", vip) ?? 0,
          src: { k: "index", obj: { k: "globals" }, key: konstSym(ctx, vip) },
        },
      ],
    };
  });
  // for E=m[F],H[F]do(f)[E]=(nil);end
  add("LOADNILRANGE", ["f", "o", "r", " ", "E", "=", J, "[", "F", "]", ",", B, "[", "F", "]", "d", "o", "(", "f", ")", "[", "E", "]", "=", "(", "n", "i", "l", ")", ";"], (ctx, vip) => ({
    clearRange: { lo: ctx.col(roles.jump ?? "m", vip) ?? 0, hi: ctx.col(roles.regB ?? "H", vip) ?? 0 },
  }));
  // f[r[F]]=(t[F]-p[F]);
  add("SUB_KI", ["f", "[", A, "[", "F", "]", "]", "=", "(", K, "[", "F", "]", "-", IM, "[", "F", "]", ")", ";"], (ctx, vip) => {
    const kv = roles.konst ? ctx.konstAt(roles.konst, vip) : undefined;
    const pv = ctx.col(roles.imm ?? "p", vip);
    if (typeof kv === "number" && typeof pv === "number") {
      return { stores: [{ reg: ctx.col(roles.regA ?? "r", vip) ?? 0, src: { k: "imm", v: kv - pv } }] };
    }
    return {
      stores: [
        {
          reg: ctx.col(roles.regA ?? "r", vip) ?? 0,
          src: { k: "bin", op: "-", a: konstSym(ctx, vip), b: immSym(ctx, roles.imm ?? "p", vip) },
        },
      ],
    };
  });
  // (f)[r[F]]=(t[F]+f[m[F]]);
  add("ADD_KR", ["(", "f", ")", "[", A, "[", "F", "]", "]", "=", "(", K, "[", "F", "]", "+", "f", "[", J, "[", "F", "]", "]", ")", ";"], (ctx, vip) => ({
    stores: [
      {
        reg: ctx.col(roles.regA ?? "r", vip) ?? 0,
        src: { k: "bin", op: "+", a: konstSym(ctx, vip), b: R_(roles.jump ?? "m", vip, ctx) },
      },
    ],
  }));
  // (f)[r[F]]=(f[H[F]]+p[F]);
  add("ADD_RI", ["(", "f", ")", "[", A, "[", "F", "]", "]", "=", "(", "f", "[", B, "[", "F", "]", "]", "+", IM, "[", "F", "]", ")", ";"], (ctx, vip) => ({
    stores: [
      {
        reg: ctx.col(roles.regA ?? "r", vip) ?? 0,
        src: { k: "bin", op: "+", a: R_(roles.regB ?? "H", vip, ctx), b: immSym(ctx, roles.imm ?? "p", vip) },
      },
    ],
  }));
  // f[r[F]]=f[m[F]]-f[H[F]];
  add("SUB_RR", ["f", "[", A, "[", "F", "]", "]", "=", "f", "[", J, "[", "F", "]", "]", "-", "f", "[", B, "[", "F", "]", "]", ";"], (ctx, vip) => ({
    stores: [
      {
        reg: ctx.col(roles.regA ?? "r", vip) ?? 0,
        src: { k: "bin", op: "-", a: R_(roles.jump ?? "m", vip, ctx), b: R_(roles.regB ?? "H", vip, ctx) },
      },
    ],
  }));
  add("MUL_RR", ["f", "[", A, "[", "F", "]", "]", "=", "f", "[", J, "[", "F", "]", "]", "*", "f", "[", B, "[", "F", "]", "]", ";"], (ctx, vip) => ({
    stores: [
      {
        reg: ctx.col(roles.regA ?? "r", vip) ?? 0,
        src: { k: "bin", op: "*", a: R_(roles.jump ?? "m", vip, ctx), b: R_(roles.regB ?? "H", vip, ctx) },
      },
    ],
  }));
  add("DIV_RR", ["f", "[", A, "[", "F", "]", "]", "=", "f", "[", J, "[", "F", "]", "]", "/", "f", "[", B, "[", "F", "]", "]", ";"], (ctx, vip) => ({
    stores: [
      {
        reg: ctx.col(roles.regA ?? "r", vip) ?? 0,
        src: { k: "bin", op: "/", a: R_(roles.jump ?? "m", vip, ctx), b: R_(roles.regB ?? "H", vip, ctx) },
      },
    ],
  }));
  // f[r[F]]=f[r[F]]%p[F];
  add("MOD_RI", ["f", "[", A, "[", "F", "]", "]", "=", "f", "[", A, "[", "F", "]", "]", "%", IM, "[", "F", "]", ";"], (ctx, vip) => ({
    stores: [
      {
        reg: ctx.col(roles.regA ?? "r", vip) ?? 0,
        src: { k: "bin", op: "%", a: R_(roles.regA ?? "r", vip, ctx), b: immSym(ctx, roles.imm ?? "p", vip) },
      },
    ],
  }));
  // f[H[F]]=(f[m[F]]..f[r[F]]);
  add("CONCAT", ["f", "[", B, "[", "F", "]", "]", "=", "(", "f", "[", J, "[", "F", "]", "]", ".", ".", "f", "[", A, "[", "F", "]", "]", ")", ";"], (ctx, vip) => ({
    stores: [
      {
        reg: ctx.col(roles.regB ?? "H", vip) ?? 0,
        src: { k: "bin", op: "..", a: R_(roles.jump ?? "m", vip, ctx), b: R_(roles.regA ?? "r", vip, ctx) },
      },
    ],
  }));
  // f[r[F]]=(f[m[F]][t[F]]);
  add("GETTABLE_K", ["f", "[", A, "[", "F", "]", "]", "=", "(", "f", "[", J, "[", "F", "]", "]", "[", K, "[", "F", "]", "]", ")", ";"], (ctx, vip) => ({
    stores: [
      {
        reg: ctx.col(roles.regA ?? "r", vip) ?? 0,
        src: { k: "index", obj: R_(roles.jump ?? "m", vip, ctx), key: konstSym(ctx, vip) },
      },
    ],
  }));
  // (f)[m[F]]=f[H[F]][f[r[F]]];
  add("GETTABLE_R", ["(", "f", ")", "[", J, "[", "F", "]", "]", "=", "f", "[", B, "[", "F", "]", "]", "[", "f", "[", A, "[", "F", "]", "]", "]", ";"], (ctx, vip) => ({
    stores: [
      {
        reg: ctx.col(roles.jump ?? "m", vip) ?? 0,
        src: { k: "index", obj: R_(roles.regB ?? "H", vip, ctx), key: R_(roles.regA ?? "r", vip, ctx) },
      },
    ],
  }));
  // f[r[F]]=(not f[H[F]]);
  add("NOT", ["f", "[", A, "[", "F", "]", "]", "=", "(", "n", "o", "t", " ", "f", "[", B, "[", "F", "]", "]", ")", ";"], (ctx, vip) => ({
    stores: [{ reg: ctx.col(roles.regA ?? "r", vip) ?? 0, src: { k: "un", op: "not", a: R_(roles.regB ?? "H", vip, ctx) } }],
  }));
  // f[r[F]]= (not f[H[F]]);   (spaced variant)
  add("NOT2", ["f", "[", A, "[", "F", "]", "]", "=", " ", "(", "n", "o", "t", " ", "f", "[", B, "[", "F", "]", "]", ")", ";"], (ctx, vip) => ({
    stores: [{ reg: ctx.col(roles.regA ?? "r", vip) ?? 0, src: { k: "un", op: "not", a: R_(roles.regB ?? "H", vip, ctx) } }],
  }));
  // (f)[r[F]]=#f[H[F]];
  add("LEN", ["(", "f", ")", "[", A, "[", "F", "]", "]", "=", "#", "f", "[", B, "[", "F", "]", "]", ";"], (ctx, vip) => ({
    stores: [
      { reg: ctx.col(roles.regA ?? "r", vip) ?? 0, src: { k: "bin", op: "#", a: R_(roles.regB ?? "H", vip, ctx) } },
    ],
  }));

  // ── calls ──
  // I=(r[F]);(f[I])(f[I+1]);d=I-0X1;
  add("CALL1R0", ["I", "=", "(", A, "[", "F", "]", ")", ";", "(", "f", "[", "I", "]", ")", "(", "f", "[", "I", "+", "1", "]", ")", ";", "d", "=", "I", "-", "0", "X", "1", ";"], (ctx, vip) => ({
    call: { base: ctx.col(roles.regA ?? "r", vip) ?? 0, argc: 1, retc: 0 },
  }));
  // I=(m[F]);(f[I])(f[I+0B1],f[I+2]);d=(I-1);
  add("CALL2R0", ["I", "=", "(", J, "[", "F", "]", ")", ";", "(", "f", "[", "I", "]", ")", "(", "f", "[", "I", "+", "0", "B", "1", "]", ",", "f", "[", "I", "+", "2", "]", ")", ";", "d", "=", "(", "I", "-", "1", ")", ";"], (ctx, vip) => ({
    call: { base: ctx.col(roles.jump ?? "m", vip) ?? 0, argc: 2, retc: 0 },
  }));
  // I=(H[F]);f[I]=f[I](f[I+0B1__]);d=(I);
  add("CALL1R1", ["I", "=", "(", B, "[", "F", "]", ")", ";", "f", "[", "I", "]", "=", "f", "[", "I", "]", "(", "f", "[", "I", "+", "0", "B", "1", "_", "_", "]", ")", ";", "d", "=", "(", "I", ")", ";"], (ctx, vip) => ({
    call: { base: ctx.col(roles.regB ?? "H", vip) ?? 0, argc: 1, retc: 1 },
  }));
  // I=r[F];f[I]=f[I](f[I+1],f[I+2]);d=I;
  add("CALL2R1", ["I", "=", A, "[", "F", "]", ";", "f", "[", "I", "]", "=", "f", "[", "I", "]", "(", "f", "[", "I", "+", "1", "]", ",", "f", "[", "I", "+", "2", "]", ")", ";", "d", "=", "I", ";"], (ctx, vip) => ({
    call: { base: ctx.col(roles.regA ?? "r", vip) ?? 0, argc: 2, retc: 1 },
  }));

  // ── control flow ──
  // F=(m[F]);
  add("JMP", ["F", "=", "(", J, "[", "F", "]", ")", ";"], (ctx, vip) => {
    const v = ctx.col(roles.jump ?? "m", vip);
    if (v === undefined) return { mnemonic: "JMP_OUT", comment: "no jump operand" };
    const t = v + 1;
    if (t < 1 || t > ctx.program.instrCount) {
      return { mnemonic: "JMP_OUT", comment: "jump target outside program (exit?)" };
    }
    return { jumpTo: t };
  });
  // if not(not(f[H[F]]<J[F]))then else F=(m[F]);end
  add(
    "JGE",
    ["i", "f", " ", "n", "o", "t", "(", "n", "o", "t", "(", "f", "[", B, "[", "F", "]", "]", "<", C, "[", "F", "]", ")", ")", "t", "h", "e", "n", " ", "e", "l", "s", "e", " ", "F", "=", "(", J, "[", "F", "]", ")", ";", "e", "n", "d"],
    (ctx, vip) => {
      const v = ctx.col(roles.jump ?? "m", vip);
      if (v === undefined) return null;
      const t = v + 1;
      if (t < 1 || t > ctx.program.instrCount) return null;
      const cond: Sym = { k: "bin", op: ">=", a: R_(roles.regB ?? "H", vip, ctx), b: immSym(ctx, roles.regC ?? "J", vip) };
      return { condJump: { cond, target: t } };
    },
  );
  // if f[r[F]]==J[F]then else F=(m[F]);end
  add(
    "JNE",
    ["i", "f", " ", "f", "[", A, "[", "F", "]", "]", "=", "=", C, "[", "F", "]", "t", "h", "e", "n", " ", "e", "l", "s", "e", " ", "F", "=", "(", J, "[", "F", "]", ")", ";", "e", "n", "d"],
    (ctx, vip) => {
      const v = ctx.col(roles.jump ?? "m", vip);
      if (v === undefined) return null;
      const t = v + 1;
      if (t < 1 || t > ctx.program.instrCount) return null;
      const cond: Sym = { k: "bin", op: "~=", a: R_(roles.regA ?? "r", vip, ctx), b: immSym(ctx, roles.regC ?? "J", vip) };
      return { condJump: { cond, target: t } };
    },
  );

  // ── upvalues ──
  // f[m[F]]=(D[r[F]][t[F]]);
  add("GETUPVAL_K", ["f", "[", J, "[", "F", "]", "]", "=", "(", "@D", "[", A, "[", "F", "]", "]", "[", K, "[", "F", "]", "]", ")", ";"], (ctx, vip) => {
    const kv = roles.konst ? ctx.konstAt(roles.konst, vip) : undefined;
    const up = ctx.col(roles.regA ?? "r", vip) ?? 0;
    const key: Sym = typeof kv === "string" && LUA_IDENT_RE.test(kv) ? { k: "konst", v: kv } : konstSym(ctx, vip);
    return {
      stores: [
        { reg: ctx.col(roles.jump ?? "m", vip) ?? 0, src: { k: "index", obj: { k: "upval", n: up }, key } },
      ],
    };
  });

  // ── scratch ops ──
  // e=(I);C=I;I=(H[F]);
  add("S_ECI", ["e", "=", "(", "I", ")", ";", "C", "=", "I", ";", "I", "=", "(", B, "[", "F", "]", ")", ";"], (ctx, vip) => ({
    scratch: [
      ["e", SC("I")],
      ["C", SC("I")],
      ["I", immSym(ctx, roles.regB ?? "H", vip)],
    ],
    mnemonic: "SCRATCH",
  }));
  // I=(m[F]);z=(0B0);
  add("S_IZ", ["I", "=", "(", J, "[", "F", "]", ")", ";", "z", "=", "(", "0", "B", "0", ")", ";"], (ctx, vip) => ({
    scratch: [
      ["I", immSym(ctx, roles.jump ?? "m", vip)],
      ["z", { k: "imm", v: 0 }],
    ],
    mnemonic: "SCRATCH",
  }));
  // I=(m[F]);z=H[F];
  add("S_IZ2", ["I", "=", "(", J, "[", "F", "]", ")", ";", "z", "=", B, "[", "F", "]", ";"], (ctx, vip) => ({
    scratch: [
      ["I", immSym(ctx, roles.jump ?? "m", vip)],
      ["z", immSym(ctx, roles.regB ?? "H", vip)],
    ],
    mnemonic: "SCRATCH",
  }));
  // I=(m[F]);
  add("S_I", ["I", "=", "(", J, "[", "F", "]", ")", ";"], (ctx, vip) => ({
    scratch: [["I", immSym(ctx, roles.jump ?? "m", vip)]],
    mnemonic: "SCRATCH",
  }));
  // z=r[F];
  add("S_Z", ["z", "=", A, "[", "F", "]", ";"], (ctx, vip) => ({
    scratch: [["z", immSym(ctx, roles.regA ?? "r", vip)]],
    mnemonic: "SCRATCH",
  }));
  // I=f;
  add("S_If", ["I", "=", "f", ";"], () => ({ scratch: [["I", { k: "regs" }]], mnemonic: "SCRATCH" }));
  // e=(R);
  add("S_eR", ["e", "=", "(", "@R", ")", ";"], () => ({ scratch: [["e", { k: "globals" }]], mnemonic: "SCRATCH" }));
  // C=t[F];
  add("S_Ck", ["C", "=", K, "[", "F", "]", ";"], (ctx, vip) => ({
    scratch: [["C", konstSym(ctx, vip)]],
    mnemonic: "SCRATCH",
  }));
  // e=(e[C]);
  add("S_eC", ["e", "=", "(", "e", "[", "C", "]", ")", ";"], () => ({
    scratch: [["e", { k: "index", obj: SC("e"), key: SC("C") }]],
    mnemonic: "SCRATCH",
  }));
  // I=I[z];z=(f);e=H[F];
  add("S_IZz", ["I", "=", "I", "[", "z", "]", ";", "z", "=", "(", "f", ")", ";", "e", "=", B, "[", "F", "]", ";"], (ctx, vip) => ({
    scratch: [
      ["I", { k: "index", obj: SC("I"), key: SC("z") }],
      ["z", { k: "regs" }],
      ["e", immSym(ctx, roles.regB ?? "H", vip)],
    ],
    mnemonic: "SCRATCH",
  }));
  // (I)[z]=(e);
  add("S_STORE", ["(", "I", ")", "[", "z", "]", "=", "(", "e", ")", ";"], () => ({
    kstores: [{ obj: SC("I"), key: SC("z"), src: SC("e") }],
    mnemonic: "SCRATCH",
  }));
  // M=0X1;I-=M;b=C+I;
  add("S_DECI", ["M", "=", "0", "X", "1", ";", "I", "-", "=", "M", ";", "b", "=", "C", "+", "I", ";"], () => ({
    scratch: [
      ["M", { k: "imm", v: 1 }],
      ["I", { k: "bin", op: "-", a: SC("I"), b: { k: "imm", v: 1 } }],
      ["b", { k: "bin", op: "+", a: SC("C"), b: SC("I") }],
    ],
    mnemonic: "SCRATCH",
  }));
  // for E=I,z do e=(f);C=E;E=nil;(e)[C]=E;end
  add("S_CLEAR", ["f", "o", "r", " ", "E", "=", "I", ",", "z", " ", "d", "o", " ", "e", "=", "(", "f", ")", ";", "C", "=", "E", ";", "E", "=", "n", "i", "l", ";", "(", "e", ")", "[", "C", "]", "=", "E", ";"], () => ({
    clearRange: { lo: 0, hi: 0 },
    comment: "clear register range (scratch)",
    mnemonic: "SCRATCH",
  }));
  // ── junk column loads (rarely meaningful — emit comments) ──
  // (f)[m[F]]=m;
  add("LOADCOL_M", ["(", "f", ")", "[", J, "[", "F", "]", "]", "=", "m", ";"], (ctx, vip) => ({
    comment: "load VM column table m into register (obfuscation artifact)",
    mnemonic: "JUNK",
  }));
  // (f)[r[F]]=r;
  add("LOADCOL_R", ["(", "f", ")", "[", A, "[", "F", "]", "]", "=", "r", ";"], (ctx, vip) => ({
    comment: "load VM column table r into register (obfuscation artifact)",
    mnemonic: "JUNK",
  }));
  // (f)[m[F]]=(Z);
  add("LOADCOL_Z", ["(", "f", ")", "[", J, "[", "F", "]", "]", "=", "(", "@op", ")", ";"], (ctx, vip) => ({
    comment: "load opcode column into register (obfuscation artifact)",
    mnemonic: "JUNK",
  }));
  // bare `;` no-op
  add("S_NOP", [";"], () => ({ mnemonic: "NOP" }));
  // empty leaf (extraction cut everything)
  add("S_EMPTY", [], () => ({ mnemonic: "NOP" }));

  return rules;
}

/** Sequential token matcher: role tokens ("@name") expand to concrete letters. */
export function matchTokens(
  text: string,
  tokens: string[],
  letters: Record<string, string>,
): boolean {
  let i = 0;
  for (const t of tokens) {
    if (t.length > 0 && t[0] === "@") {
      const letter = letters[t.slice(1)];
      if (!letter) return false;
      if (!text.startsWith(letter, i)) return false;
      i += letter.length;
    } else {
      if (!text.startsWith(t, i)) return false;
      i += t.length;
    }
  }
  return i === text.length;
}

/** Build the concrete letters map from roles + alias. */
export function tokenLetters(alias: AliasInfo, roles: ColumnRoles): Record<string, string> {
  return {
    regA: roles.regA ?? "r",
    regB: roles.regB ?? "H",
    regC: roles.regC ?? "J",
    jump: roles.jump ?? "m",
    imm: roles.imm ?? "p",
    konst: roles.konst ?? "t",
    f: "f",
    F: alias.vipLetter,
    R: "R",
    D: "D",
  };
}



/** Normalise handler text: whitespace + strip dispatch remnants. */
function normHandler(h: string): string {
  let s = h.replace(/\s+/g, " ").trim();
  const cut = s.search(/(?:^|;)elseif\s+\w+==/);
  if (cut >= 0) s = s.slice(0, cut + 1);
  // strip trailing stray brackets from minified groupings
  return s;
}

/** A scratch reference that must be resolved during rendering. */
function resolveSym(s: Sym, scratch: Map<string, Sym>): Sym {
  if (s.k === "scratch") {
    const v = scratch.get(s.name);
    return v ? resolveSym(v, scratch) : { k: "unk", note: `scratch ${s.name}` };
  }
  if (s.k === "index") return { k: "index", obj: resolveSym(s.obj, scratch), key: resolveSym(s.key, scratch) };
  if (s.k === "bin") return { k: "bin", op: s.op, a: resolveSym(s.a, scratch), b: s.b ? resolveSym(s.b, scratch) : undefined };
  if (s.k === "call") return { k: "call", fn: resolveSym(s.fn, scratch), args: s.args.map((a) => resolveSym(a, scratch)) };
  if (s.k === "un") return { k: "un", op: s.op, a: resolveSym(s.a, scratch) };
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decompilation
// ─────────────────────────────────────────────────────────────────────────────

export interface DecompiledProto {
  index: number;
  instrCount: number;
  resolved: number;
  coverage: number;
  source: string;
}

export interface DecompileResult {
  protos: DecompiledProto[];
  totalInstrs: number;
  totalResolved: number;
  source: string;
}

interface LiftedIns {
  vip: number;
  op: number;
  mnemonic: string;
  stmts: IRStmt[];
  jumpTo: number | null;
  condJump: { cond: Sym; target: number } | null;
  ret: { kind: "void" | "values" | "vararg" } | null;
  comment?: string;
}

export function decompileProgram(
  program: FinalProgram,
  alias: AliasInfo,
  handlers: Map<number, string>,
  trace: FlowFacts | null,
  index: number,
): DecompiledProto {
  const roles = resolveColumnRoles(program, alias, handlers);
  const ctx = new LiftCtx(program, roles, alias);
  const rules = buildRulesTokens(alias, roles);
  const letters = tokenLetters(alias, roles);
  const N = program.instrCount;

  const scratch = new Map<string, Sym>();
  const lifted = new Map<number, LiftedIns>();
  let resolved = 0;
  const mnemonics = new Set<string>();

  for (let vip = 1; vip <= N; vip++) {
    const op = program.opcodes.get(vip);
    if (op === undefined) continue;
    const base: LiftedIns = {
      vip,
      op,
      mnemonic: `OP_${op}`,
      stmts: [],
      jumpTo: null,
      condJump: null,
      ret: null,
    };
    const raw = handlers.get(op);
    if (raw) {
      const text = normHandler(raw);
      for (const rule of rules) {
        if (!matchTokens(text, rule.tokens, letters)) continue;
        const gen = rule.gen;
        const eff = gen(ctx, vip);
        if (eff) {
          base.mnemonic = eff.mnemonic ?? rule.name;
          if (eff.scratch) {
            for (const [k, v] of eff.scratch) {
              const resolvedV = resolveSym(v, scratch);
              scratch.set(k, resolvedV);
            }
          }
          if (eff.clearRange) {
            const lo = typeof eff.clearRange.lo === "number" ? eff.clearRange.lo : null;
            const hi = typeof eff.clearRange.hi === "number" ? eff.clearRange.hi : null;
            if (lo !== null && hi !== null && hi >= lo && hi - lo < 300) {
              base.stmts.push({ kind: "clearrange", lo, hi });
            }
          }
          if (eff.stores) {
            for (const st of eff.stores) {
              const regN = typeof st.reg === "number" ? st.reg : null;
              if (regN !== null) {
                base.stmts.push({ kind: "assign", reg: regN, src: resolveSym(st.src, scratch) });
              } else {
                base.stmts.push({
                  kind: "comment",
                  text: `store ${renderSym(resolveSym(st.reg as Sym, scratch))} = ${renderSym(resolveSym(st.src, scratch))}`,
                });
              }
            }
          }
          if (eff.kstores) {
            for (const ks of eff.kstores) {
              const obj = resolveSym(ks.obj, scratch);
              const key = resolveSym(ks.key, scratch);
              const val = resolveSym(ks.src, scratch);
              base.stmts.push({ kind: "kstore", obj, key, val });
            }
          }
          if (eff.call) {
            const b = typeof eff.call.base === "number" ? eff.call.base : 0;
            base.stmts.push({ kind: "callstmt", base: b, argc: eff.call.argc, retc: eff.call.retc });
          }
          if (eff.jumpTo !== undefined) base.jumpTo = eff.jumpTo;
          if (eff.condJump) base.condJump = { cond: resolveSym(eff.condJump.cond, scratch), target: eff.condJump.target };
          if (eff.ret) base.ret = eff.ret;
          if (eff.comment) base.comment = eff.comment;
          if (base.mnemonic !== "SCRATCH" && base.mnemonic !== "NOP") resolved++;
          else if (base.stmts.length > 0) resolved++;
          mnemonics.add(base.mnemonic);
        }
        break;
      }
    }
    lifted.set(vip, base);
  }

  // trace validation: patch jump targets the execution observed (guards
  // against mis-resolved jump columns and out-of-range encodings)
  if (trace) {
    for (const [vip, targets] of trace.jumps) {
      const ins = lifted.get(vip);
      if (!ins) continue;
      const observed = [...targets.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const staticT = ins.jumpTo ?? ins.condJump?.target ?? null;
      if (staticT === null && observed >= 1 && observed <= N) {
        if (ins.condJump) ins.condJump.target = observed;
        else ins.jumpTo = observed;
      } else if (staticT !== null && staticT !== observed && !targets.has(staticT) && observed >= 1 && observed <= N) {
        if (ins.condJump) ins.condJump.target = observed;
        else ins.jumpTo = observed;
      }
    }
  }

  // Build IRInst array from lifted map, preserving VIP order.
  const ir: IRInst[] = [];
  for (let vip = 1; vip <= N; vip++) {
    const ins = lifted.get(vip);
    if (!ins) continue;
    // If no rule matched and no stmts/control-flow, emit a comment with the
    // operands so the user can see what opcodes are unresolved.
    if (
      ins.stmts.length === 0 &&
      ins.jumpTo === null &&
      ins.condJump === null &&
      ins.ret === null
    ) {
      if (ins.comment) {
        ir.push({ ...ins, stmts: [{ kind: "comment", text: ins.comment }] });
      } else if (ins.mnemonic !== "NOP") {
        const cols: string[] = [];
        for (const [letter, col] of program.columns) {
          const v = col.get(vip);
          if (v !== undefined) cols.push(`${letter}=${v}`);
        }
        const kv = roles.konst ? program.constants.get(roles.konst)?.get(vip) : undefined;
        if (kv !== undefined) cols.push(`K=${typeof kv === "string" ? JSON.stringify(kv.slice(0, 24)) : kv}`);
        ir.push({
          vip: ins.vip,
          op: ins.op,
          mnemonic: ins.mnemonic,
          stmts: [{ kind: "comment", text: `OP_${ins.op} ${cols.join(" ")}` }],
          jumpTo: null,
          condJump: null,
          ret: null,
        });
      } else {
        // pure NOP — skip
      }
    } else {
      ir.push({
        vip: ins.vip,
        op: ins.op,
        mnemonic: ins.mnemonic,
        stmts: ins.stmts.slice(),
        jumpTo: ins.jumpTo,
        condJump: ins.condJump,
        ret: ins.ret,
        comment: ins.comment,
      });
    }
  }

  // Structuring passes (junk removal, K-pool extraction, global-chain
  // collapse, scratch propagation, arithmetic fold, CFG structuring).
  const structured = structureProgram(ir, program, index);

  return {
    index,
    instrCount: N,
    resolved,
    coverage: mnemonics.size,
    source: structured.source,
  };
}

/** Correlate fallback dumps (method-scan snapshots) with final programs to
 * recover the register count (P[10] is not part of the interpreter locals). */
export function correlateRegisters(
  program: FinalProgram,
  fallback: Array<{ opcodes: number[]; registers: number | null }>,
): number | null {
  let best: number | null = null;
  let bestLen = -1;
  for (const f of fallback) {
    if (f.registers === null) continue;
    if (f.opcodes.length <= program.instrCount && f.opcodes.length > bestLen) {
      bestLen = f.opcodes.length;
      best = f.registers;
    }
  }
  return best;
}
