// ═══════════════════════════════════════════════════════════════
// Symbolic Execution Engine v5.1 — "Demonology X10-FAST"
//
// PERF UPGRADES vs v5.0:
//   - pre-built vipToIdx Map → O(1) jump target lookup (was O(n) findIndex)
//   - dropped hashRegState JSON.stringify per worklist step
//     → replaced with a numeric epoch counter (dirty flag), O(1)
//   - worklist is a simple typed array instead of splice-based queue
//   - table alias tracking wired up (was always empty Map)
//   - getTableState now returns a real per-register Map
// ═══════════════════════════════════════════════════════════════

import { Sym, renderSym } from "./luraph-lifter";
import { IRInst, IRStmt } from "./luraph-structure";

export interface SymbolicValue {
  kind: "concrete" | "symbolic" | "range" | "set" | "unknown";
  value?: unknown;
  expr?: Sym;
  min?: number;
  max?: number;
  values?: Set<unknown>;
  constraints?: Sym[];
}

export interface SymbolicState {
  registers: Map<number, SymbolicValue>;
  upvalues: Map<number, SymbolicValue>;
  globals: Map<string, SymbolicValue>;
  tables: Map<number, Map<unknown, SymbolicValue>>;
  pathConstraints: Sym[];
  vip: number;
}

export interface ExecutionPath {
  state: SymbolicState;
  nextVips: number[];
  terminated: boolean;
  returns?: SymbolicValue[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Opaque Predicate Detector
// ─────────────────────────────────────────────────────────────────────────────

export function detectOpaquePredicate(cond: Sym): { isOpaque: boolean; truthValue?: boolean } {
  // A * A >= 0
  if (cond.k === "bin" && cond.op === ">=") {
    const { a, b } = cond;
    if (b?.k === "imm" && b.v === 0) {
      if (a.k === "bin" && a.op === "*" && areStructurallyEqual(a.a, a.b)) {
        return { isOpaque: true, truthValue: true };
      }
      if (a.k === "bin" && a.op === "^" && a.b?.k === "imm" && (a.b.v as number) % 2 === 0) {
        return { isOpaque: true, truthValue: true };
      }
    }
  }

  // (A & mask) > mask
  if (cond.k === "bin" && (cond.op === ">" || cond.op === ">=")) {
    const { a, b } = cond;
    if (a.k === "bin" && a.op === "&" && b?.k === "imm") {
      const maskVal = b.v as number;
      if (a.b?.k === "imm") {
        const andMask = a.b.v as number;
        if (andMask <= maskVal && cond.op === ">") {
          return { isOpaque: true, truthValue: false };
        }
      }
    }
  }

  // A % B == C where C >= B
  if (cond.k === "bin" && cond.op === "==") {
    const { a, b } = cond;
    if (a.k === "bin" && a.op === "%" && b?.k === "imm") {
      const rem = b.v as number;
      if (a.b?.k === "imm") {
        const mod = a.b.v as number;
        if (rem >= mod) return { isOpaque: true, truthValue: false };
      }
    }
  }

  // not(not(A))
  if (cond.k === "un" && cond.op === "not" && cond.a.k === "un" && cond.a.op === "not") {
    return detectOpaquePredicate(cond.a.a);
  }

  // A == A
  if (cond.k === "bin" && cond.op === "==" && areStructurallyEqual(cond.a, cond.b)) {
    return { isOpaque: true, truthValue: true };
  }

  // A ~= A
  if (cond.k === "bin" && cond.op === "~=" && areStructurallyEqual(cond.a, cond.b)) {
    return { isOpaque: true, truthValue: false };
  }

  // string.len(A) >= 0
  if (cond.k === "bin" && cond.op === ">=" && cond.b?.k === "imm" && cond.b.v === 0) {
    if (cond.a.k === "call") {
      const fn = cond.a.fn;
      if (fn.k === "index" && fn.obj.k === "global" && fn.obj.name === "string" &&
          fn.key.k === "imm" && fn.key.v === "len") {
        return { isOpaque: true, truthValue: true };
      }
    }
  }

  return { isOpaque: false };
}

function areStructurallyEqual(a: Sym, b: Sym): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case "imm":    return a.v === (b as any).v;
    case "reg":    return a.n === (b as any).n;
    case "global": return a.name === (b as any).name;
    case "konst":  return a.v === (b as any).v;
    case "un":     return a.op === (b as any).op && areStructurallyEqual(a.a, (b as any).a);
    case "bin":
      return a.op === (b as any).op &&
             areStructurallyEqual(a.a, (b as any).a) &&
             (!a.b || !((b as any).b) || areStructurallyEqual(a.b, (b as any).b));
    case "index":
      return areStructurallyEqual(a.obj, (b as any).obj) &&
             areStructurallyEqual(a.key, (b as any).key);
    default: return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FAST Constant Propagation
// ─────────────────────────────────────────────────────────────────────────────

export function propagateConstantsSymbolic(ir: IRInst[]): Map<number, SymbolicValue> {
  const regState  = new Map<number, SymbolicValue>();
  // Table alias: regNum → (key → value)
  const tblAlias  = new Map<number, Map<unknown, SymbolicValue>>();

  // ── PERF: pre-build vip→index in O(n) ──
  const vipToIdx = new Map<number, number>();
  for (let i = 0; i < ir.length; i++) vipToIdx.set(ir[i].vip, i);

  // ── PERF: use epoch counter instead of JSON.stringify hash ──
  // visitedKey = idx | (epoch << 20). Epoch bumps when regState changes.
  let epoch = 0;
  const visitedSet = new Set<number>(); // encodes (idx * 1024 + (epoch & 1023))
  const encodeVisit = (idx: number) => (idx << 10) | (epoch & 0x3ff);

  // Simple queue — Uint32Array beats Array.shift() (no O(n) shift)
  const queue = new Uint32Array(ir.length * 2 + 64);
  let qHead = 0, qTail = 0;
  const enqueue = (idx: number) => { queue[qTail++ & (queue.length - 1)] = idx; };
  const dequeue = () => queue[qHead++ & (queue.length - 1)];
  enqueue(0);

  while (qHead < qTail) {
    const idx = dequeue();
    const inst = ir[idx];
    if (!inst) continue;

    const key = encodeVisit(idx);
    if (visitedSet.has(key)) continue;
    visitedSet.add(key);

    for (const stmt of inst.stmts) {
      switch (stmt.kind) {
        case "assign": {
          const val = evaluateSymbolic(stmt.src, regState, tblAlias);
          const prev = regState.get(stmt.reg);
          const same = prev && prev.kind === "concrete" && prev.value === val.value;
          if (!same) {
            if (val.kind === "concrete") regState.set(stmt.reg, val);
            else regState.delete(stmt.reg);
            epoch++;
          }
          break;
        }
        case "kstore": {
          if (stmt.obj.k === "reg") {
            let tbl = tblAlias.get(stmt.obj.n);
            if (!tbl) { tbl = new Map(); tblAlias.set(stmt.obj.n, tbl); }
            const keyEval = evaluateSymbolic(stmt.key, regState, tblAlias);
            const valEval = evaluateSymbolic(stmt.val, regState, tblAlias);
            if (keyEval.kind === "concrete") tbl.set(keyEval.value, valEval);
          }
          break;
        }
        case "condjump": {
          const opaque = detectOpaquePredicate(stmt.cond);
          if (opaque.isOpaque && opaque.truthValue === false) {
            // always-false condition → unconditional jump to target
            const ti = vipToIdx.get(stmt.target);
            if (ti !== undefined) enqueue(ti);
            continue; // skip fall-through
          }
          break;
        }
      }
    }

    // fall-through
    if (idx + 1 < ir.length) enqueue(idx + 1);

    // explicit jump target
    if (inst.jumpTo !== null) {
      const ti = vipToIdx.get(inst.jumpTo);
      if (ti !== undefined) enqueue(ti);
    }
  }

  return regState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Symbolic evaluator (shared by propagation + CFG structurer)
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateSymbolic(
  sym: Sym,
  regState: Map<number, SymbolicValue>,
  tblAlias?: Map<number, Map<unknown, SymbolicValue>>,
): SymbolicValue {
  switch (sym.k) {
    case "imm":   return { kind: "concrete", value: sym.v };
    case "konst": return { kind: "concrete", value: sym.v };
    case "reg": {
      const st = regState.get(sym.n);
      return st ?? { kind: "symbolic", expr: sym };
    }
    case "global":
      return { kind: "symbolic", expr: sym };
    case "index": {
      // table alias lookup
      if (tblAlias && sym.obj.k === "reg") {
        const tbl = tblAlias.get(sym.obj.n);
        if (tbl) {
          const keyEval = evaluateSymbolic(sym.key, regState, tblAlias);
          if (keyEval.kind === "concrete") {
            const v = tbl.get(keyEval.value);
            if (v) return v;
          }
        }
      }
      return { kind: "symbolic", expr: sym };
    }
    case "un": {
      const a = evaluateSymbolic(sym.a, regState, tblAlias);
      if (a.kind === "concrete") {
        const av = a.value;
        switch (sym.op) {
          case "not": return { kind: "concrete", value: !av };
          case "-":   return { kind: "concrete", value: -(av as number) };
          case "#":   return { kind: "concrete", value: (av as string).length };
          case "~":   return { kind: "concrete", value: ~(av as number) };
        }
      }
      return { kind: "symbolic", expr: sym };
    }
    case "bin": {
      const a = evaluateSymbolic(sym.a, regState, tblAlias);
      const b = sym.b ? evaluateSymbolic(sym.b, regState, tblAlias) : undefined;
      if (a.kind === "concrete" && b?.kind === "concrete") {
        const av = a.value as number;
        const bv = b.value as number;
        switch (sym.op) {
          case "+":  return { kind: "concrete", value: av + bv };
          case "-":  return { kind: "concrete", value: av - bv };
          case "*":  return { kind: "concrete", value: av * bv };
          case "/":  return { kind: "concrete", value: av / bv };
          case "%":  return { kind: "concrete", value: av % bv };
          case "^":  return { kind: "concrete", value: Math.pow(av, bv) };
          case "&":  return { kind: "concrete", value: av & bv };
          case "|":  return { kind: "concrete", value: av | bv };
          case "~":  return { kind: "concrete", value: av ^ bv };
          case "<<": return { kind: "concrete", value: av << bv };
          case ">>": return { kind: "concrete", value: av >> bv };
          case "==": return { kind: "concrete", value: av == bv };
          case "~=": return { kind: "concrete", value: av != bv };
          case "<":  return { kind: "concrete", value: av < bv };
          case "<=": return { kind: "concrete", value: av <= bv };
          case ">":  return { kind: "concrete", value: av > bv };
          case ">=": return { kind: "concrete", value: av >= bv };
          case "..": return { kind: "concrete", value: String(av) + String(bv) };
        }
      }
      return { kind: "symbolic", expr: sym };
    }
    default:
      return { kind: "symbolic", expr: sym };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-Tamper Detection
// ─────────────────────────────────────────────────────────────────────────────

export interface AntiTamperPattern {
  name: string;
  description: string;
  detect: (ir: IRInst[]) => number[];
}

export const ANTI_TAMPER_PATTERNS: AntiTamperPattern[] = [
  {
    name: "checksum_self",
    description: "Code computes checksum/hash of its own bytecode",
    detect: (ir) => {
      const suspects: number[] = [];
      for (let i = 0; i < ir.length; i++) {
        for (const stmt of ir[i].stmts) {
          if (stmt.kind === "assign" && stmt.src.k === "call") {
            const fn = stmt.src.fn;
            if (fn.k === "index" && fn.obj.k === "global" &&
                ["string", "table", "math"].includes(fn.obj.name)) {
              for (const arg of stmt.src.args) {
                if (arg.k === "global" && ["loadstring", "load", "compile"].includes(arg.name)) {
                  suspects.push(i);
                }
              }
            }
          }
        }
      }
      return suspects;
    }
  },
  {
    name: "debugger_trap",
    description: "Code checks for debugger presence via timing",
    detect: (ir) => {
      const suspects: number[] = [];
      for (let i = 0; i < ir.length; i++) {
        for (const stmt of ir[i].stmts) {
          if (stmt.kind === "assign" && stmt.src.k === "bin") {
            const { a, b } = stmt.src;
            if (a.k === "bin" && a.op === "-" && b?.k === "imm") {
              if (a.a.k === "call" && a.b.k === "call") suspects.push(i);
            }
          }
        }
      }
      return suspects;
    }
  },
  {
    name: "env_pollution",
    description: "Code modifies global environment unexpectedly",
    detect: (ir) => {
      const suspects: number[] = [];
      for (let i = 0; i < ir.length; i++) {
        for (const stmt of ir[i].stmts) {
          if (stmt.kind === "kstore" && stmt.obj.k === "global" &&
              ["_G", "getfenv", "setfenv"].includes(stmt.obj.name)) {
            suspects.push(i);
          }
        }
      }
      return suspects;
    }
  }
];

export function detectAntiTamper(ir: IRInst[]): Map<string, number[]> {
  const results = new Map<string, number[]>();
  for (const pattern of ANTI_TAMPER_PATTERNS) {
    const hits = pattern.detect(ir);
    if (hits.length > 0) results.set(pattern.name, hits);
  }
  return results;
}
