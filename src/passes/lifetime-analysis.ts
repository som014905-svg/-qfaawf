// ═══════════════════════════════════════════════════════════════
// Lifetime Analysis & Variable Renaming v5.0 — "Demonology X10"
//
// Phân tích lifetime của registers để:
//   1. Đổi tên register thành biến có ý nghĩa (script, tbl1, lv09, ...)
//   2. Phát hiện biến được REASSIGN và đổi tên phù hợp theo scope
//   3. Tách biến nếu cùng register được dùng cho mục đích khác nhau
//   4. Detect loop induction variables
// ═══════════════════════════════════════════════════════════════

import { IRInst, IRStmt } from "../vm/luraph-structure";
import { Sym } from "../vm/luraph-lifter";

export interface Lifetime {
  reg: number;
  birth: number;   // instruction index where first assigned
  death: number;   // instruction index where last read
  assignments: number[];  // all instruction indices where assigned
  reads: number[];        // all instruction indices where read
  /** Type inference */
  inferredType: "string" | "number" | "table" | "function" | "boolean" | "unknown";
  /** Suggested name */
  suggestedName: string;
  /** Is loop variable? */
  isLoopVar: boolean;
  /** Is constant (single assignment, never reassigned)? */
  isConstant: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Inference
// ─────────────────────────────────────────────────────────────────────────────

function inferTypeFromSym(sym: Sym): string {
  switch (sym.k) {
    case "imm":
      return typeof sym.v === "string" ? "string" : "number";
    case "global":
      const name = sym.name;
      if (["string", "table", "math", "debug", "bit32", "coroutine"].includes(name)) return "table";
      if (["true", "false"].includes(name)) return "boolean";
      if (["game", "workspace", "script"].includes(name)) return "Instance";
      return "unknown";
    case "konst":
      return typeof sym.v === "string" ? "string" : "number";
    case "bin":
      if (["+", "-", "*", "/", "%", "^", "&", "|", "~", "<<", ">>"].includes(sym.op)) return "number";
      if ([".."].includes(sym.op)) return "string";
      if (["==", "~=", "<", "<=", ">", ">="].includes(sym.op)) return "boolean";
      return "unknown";
    case "un":
      if (sym.op === "#") return "number";
      if (sym.op === "not") return "boolean";
      if (sym.op === "-") return "number";
      return "unknown";
    case "call":
      return "unknown";
    case "index":
      return "unknown";
    default:
      return "unknown";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifetime Analysis
// ─────────────────────────────────────────────────────────────────────────────

export function analyzeLifetimes(ir: IRInst[]): Lifetime[] {
  const lifetimes = new Map<number, Lifetime>();

  // Collect all registers used
  const allRegs = new Set<number>();
  for (let i = 0; i < ir.length; i++) {
    const inst = ir[i];
    for (const stmt of inst.stmts) {
      collectRegs(stmt, allRegs);
    }
  }

  for (const reg of allRegs) {
    lifetimes.set(reg, {
      reg,
      birth: Infinity,
      death: -1,
      assignments: [],
      reads: [],
      inferredType: "unknown",
      suggestedName: `R${reg}`,
      isLoopVar: false,
      isConstant: true
    });
  }

  // Track assignments and reads
  for (let i = 0; i < ir.length; i++) {
    const inst = ir[i];
    for (const stmt of inst.stmts) {
      switch (stmt.kind) {
        case "assign": {
          const lt = lifetimes.get(stmt.reg);
          if (lt) {
            lt.birth = Math.min(lt.birth, i);
            lt.death = Math.max(lt.death, i);
            lt.assignments.push(i);
            if (lt.assignments.length > 1) lt.isConstant = false;

            // Infer type from source
            const srcType = inferTypeFromSym(stmt.src);
            if (srcType !== "unknown" && lt.inferredType === "unknown") {
              lt.inferredType = srcType as any;
            }

            // Track reads in source
            collectReads(stmt.src, i, lifetimes);
          }
          break;
        }
        case "kstore": {
          collectReads(stmt.obj, i, lifetimes);
          collectReads(stmt.key, i, lifetimes);
          collectReads(stmt.val, i, lifetimes);
          break;
        }
        case "callstmt": {
          // base register and following registers are read
          for (let r = stmt.base; r < stmt.base + stmt.argc + 1; r++) {
            const lt = lifetimes.get(r);
            if (lt) {
              lt.reads.push(i);
              lt.death = Math.max(lt.death, i);
            }
          }
          break;
        }
        case "condjump": {
          collectReads(stmt.cond, i, lifetimes);
          break;
        }
      }
    }
  }

  // Detect loop variables (phi-like patterns)
  for (const lt of lifetimes.values()) {
    if (lt.assignments.length >= 2) {
      // Check if assignments form a loop pattern
      const first = lt.assignments[0];
      const last = lt.assignments[lt.assignments.length - 1];
      if (last > first && lt.reads.some(r => r > first && r < last)) {
        // Potential loop variable if read between assignments
        const instBetween = ir.slice(first + 1, last);
        const hasBackEdge = instBetween.some(inst => 
          inst.jumpTo !== null && inst.jumpTo < ir[first].vip
        );
        if (hasBackEdge) {
          lt.isLoopVar = true;
        }
      }
    }
  }

  return Array.from(lifetimes.values());
}

function collectRegs(stmt: IRStmt, regs: Set<number>): void {
  switch (stmt.kind) {
    case "assign":
      regs.add(stmt.reg);
      collectRegsInSym(stmt.src, regs);
      break;
    case "kstore":
      collectRegsInSym(stmt.obj, regs);
      collectRegsInSym(stmt.key, regs);
      collectRegsInSym(stmt.val, regs);
      break;
    case "callstmt":
      for (let r = stmt.base; r < stmt.base + stmt.argc + 2; r++) regs.add(r);
      break;
    case "clearrange":
      for (let r = stmt.lo; r <= stmt.hi; r++) regs.add(r);
      break;
    case "condjump":
      collectRegsInSym(stmt.cond, regs);
      break;
  }
}

function collectRegsInSym(sym: Sym, regs: Set<number>): void {
  if (sym.k === "reg") regs.add(sym.n);
  if (sym.k === "bin") {
    collectRegsInSym(sym.a, regs);
    if (sym.b) collectRegsInSym(sym.b, regs);
  }
  if (sym.k === "un") collectRegsInSym(sym.a, regs);
  if (sym.k === "index") {
    collectRegsInSym(sym.obj, regs);
    collectRegsInSym(sym.key, regs);
  }
  if (sym.k === "call") {
    collectRegsInSym(sym.fn, regs);
    sym.args.forEach(a => collectRegsInSym(a, regs));
  }
}

function collectReads(sym: Sym, idx: number, lifetimes: Map<number, Lifetime>): void {
  if (sym.k === "reg") {
    const lt = lifetimes.get(sym.n);
    if (lt) {
      lt.reads.push(idx);
      lt.death = Math.max(lt.death, idx);
    }
  }
  if (sym.k === "bin") {
    collectReads(sym.a, idx, lifetimes);
    if (sym.b) collectReads(sym.b, idx, lifetimes);
  }
  if (sym.k === "un") collectReads(sym.a, idx, lifetimes);
  if (sym.k === "index") {
    collectReads(sym.obj, idx, lifetimes);
    collectReads(sym.key, idx, lifetimes);
  }
  if (sym.k === "call") {
    collectReads(sym.fn, idx, lifetimes);
    sym.args.forEach(a => collectReads(a, idx, lifetimes));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Name Generation
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_NAMES: Record<string, string[]> = {
  string: ["str", "s", "text", "name", "key"],
  number: ["n", "num", "count", "idx", "val"],
  table: ["tbl", "t", "cache", "pool", "data"],
  function: ["fn", "func", "cb", "handler"],
  boolean: ["flag", "ok", "enabled", "isValid"],
  Instance: ["obj", "inst", "part", "gui"],
  unknown: ["var", "tmp", "v", "x"]
};

export function generateNames(lifetimes: Lifetime[]): Map<number, string> {
  const names = new Map<number, string>();
  const usedNames = new Set<string>();

  // Special registers
  const specialRegs = new Map<number, string>();

  for (const lt of lifetimes) {
    let name: string;

    // Check for special patterns
    if (lt.reg === 0) {
      name = "script";
    } else if (lt.isLoopVar) {
      name = `i${lt.reg}`;
    } else if (lt.isConstant && lt.inferredType === "table") {
      name = `tbl${lt.reg}`;
    } else if (lt.inferredType === "function") {
      name = `fn${lt.reg}`;
    } else if (lt.inferredType === "string" && lt.isConstant) {
      name = `s${lt.reg}`;
    } else {
      const candidates = TYPE_NAMES[lt.inferredType] || TYPE_NAMES.unknown;
      let idx = 0;
      do {
        name = `${candidates[idx % candidates.length]}${lt.reg}`;
        idx++;
      } while (usedNames.has(name) && idx < 100);
    }

    // Ensure uniqueness
    let finalName = name;
    let suffix = 1;
    while (usedNames.has(finalName)) {
      finalName = `${name}_${suffix}`;
      suffix++;
    }

    usedNames.add(finalName);
    names.set(lt.reg, finalName);
  }

  return names;
}

export { collectRegsInSym, collectReads };
