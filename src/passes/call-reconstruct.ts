// ═══════════════════════════════════════════════════════════════
// Call Reconstruction Pass v5.1 — "Demonology X10-FAST"
//
// PERF UPGRADES vs v5.0:
//   - funcRegToChain Map<number, CallChain> for O(1) per-instruction lookup
//     (was chains.find() = O(n*m) double loop)
//   - replacedSet is already a Set — kept
//   - phase-1 detection loop skips replaced indices immediately
// ═══════════════════════════════════════════════════════════════

import { Sym, renderSym } from "../vm/luraph-lifter";
import { IRInst, IRStmt } from "../vm/luraph-structure";

export interface CallChain {
  funcReg: number;
  funcSym: Sym;
  sourceIndices: number[];
  callType: "global" | "method" | "index" | "upvalue" | "local";
  resolvedName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Detectors (unchanged logic, same as v5.0)
// ─────────────────────────────────────────────────────────────────────────────

function detectGlobalChain(ir: IRInst[], startIdx: number): CallChain | null {
  const inst = ir[startIdx];
  if (!inst || inst.stmts.length === 0) return null;
  const stmt = inst.stmts[0];
  if (stmt.kind !== "assign" || stmt.src.k !== "global") return null;

  let currentReg = stmt.reg;
  let currentSym: Sym = stmt.src;
  const indices = [startIdx];
  const limit = Math.min(startIdx + 10, ir.length);

  for (let i = startIdx + 1; i < limit; i++) {
    const next = ir[i];
    if (next.stmts.length === 0) continue;
    const ns = next.stmts[0];

    if (ns.kind === "assign" && ns.src.k === "index") {
      const idx = ns.src;
      if (idx.obj.k === "reg" && idx.obj.n === currentReg && idx.key.k === "imm") {
        currentSym = { k: "index", obj: currentSym, key: idx.key };
        currentReg = ns.reg;
        indices.push(i);
        continue;
      }
    }
    if (ns.kind === "assign" && ns.src.k === "reg" && ns.src.n === currentReg) {
      currentReg = ns.reg;
      indices.push(i);
      continue;
    }
    break;
  }

  if (indices.length < 2) return null;
  return { funcReg: currentReg, funcSym: currentSym, sourceIndices: indices, callType: "global", resolvedName: renderSym(currentSym) };
}

function detectTableMethodChain(ir: IRInst[], startIdx: number): CallChain | null {
  const inst = ir[startIdx];
  if (!inst || inst.stmts.length === 0) return null;
  const stmt = inst.stmts[0];
  if (stmt.kind !== "kstore") return null;
  if (stmt.obj.k !== "reg" || stmt.key.k !== "imm" || stmt.val.k !== "imm") return null;

  const tableReg   = stmt.obj.n;
  const methodName = stmt.val.v as string;
  const limit      = Math.min(startIdx + 8, ir.length);

  for (let i = startIdx + 1; i < limit; i++) {
    const ns = ir[i].stmts[0];
    if (!ns) continue;
    if (ns.kind === "assign" && ns.src.k === "reg" && ns.src.n === tableReg) {
      const copyReg = ns.reg;
      for (let j = i + 1; j < Math.min(i + 5, ir.length); j++) {
        const ns2 = ir[j].stmts[0];
        if (!ns2) continue;
        if (ns2.kind === "assign" && ns2.src.k === "index") {
          const idx = ns2.src;
          if (idx.obj.k === "reg" && idx.obj.n === copyReg &&
              idx.key.k === "imm" && idx.key.v === methodName) {
            return {
              funcReg: ns2.reg,
              funcSym: { k: "index", obj: { k: "reg", n: tableReg }, key: { k: "imm", v: methodName } },
              sourceIndices: [startIdx, i, j],
              callType: "method",
              resolvedName: `R${tableReg}.${methodName}`,
            };
          }
        }
      }
    }
  }
  return null;
}

function detectKPoolMethodChain(ir: IRInst[], startIdx: number): CallChain | null {
  const limit = Math.min(startIdx + 15, ir.length);
  for (let i = startIdx; i < limit; i++) {
    const stmt = ir[i].stmts[0];
    if (!stmt || stmt.kind !== "kstore") continue;
    if (stmt.obj.k !== "global" || stmt.obj.name !== "K") continue;
    if (stmt.key.k !== "imm" || stmt.val.k !== "imm") continue;

    const kIdx = stmt.key.v as number;
    const kVal = stmt.val.v as string;

    for (let j = i + 1; j < Math.min(i + 10, ir.length); j++) {
      const s2 = ir[j].stmts[0];
      if (!s2 || s2.kind !== "assign" || s2.src.k !== "index") continue;
      if (s2.src.obj.k !== "global" || s2.src.obj.name !== "K") continue;
      const globalReg = s2.reg;

      for (let k = j + 1; k < Math.min(j + 5, ir.length); k++) {
        const s3 = ir[k].stmts[0];
        if (!s3 || s3.kind !== "assign" || s3.src.k !== "index") continue;
        const idx2 = s3.src;
        if (idx2.obj.k === "reg" && idx2.obj.n === globalReg &&
            idx2.key.k === "index" && idx2.key.obj.k === "global" &&
            idx2.key.obj.name === "K" && idx2.key.key.k === "imm" &&
            idx2.key.key.v === kIdx) {
          return {
            funcReg: s3.reg,
            funcSym: { k: "index", obj: { k: "reg", n: globalReg }, key: { k: "imm", v: kVal } },
            sourceIndices: [i, j, k],
            callType: "method",
            resolvedName: `K[${kIdx}] → ${kVal}`,
          };
        }
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Pass
// ─────────────────────────────────────────────────────────────────────────────

export function reconstructCalls(ir: IRInst[]): IRInst[] {
  const chains: CallChain[] = [];
  const replacedIndices = new Set<number>();

  // Phase 1: Detect all chains
  for (let i = 0; i < ir.length; i++) {
    if (replacedIndices.has(i)) continue;
    const chain = detectGlobalChain(ir, i) ||
                  detectTableMethodChain(ir, i) ||
                  detectKPoolMethodChain(ir, i);
    if (chain) {
      chains.push(chain);
      for (const idx of chain.sourceIndices) replacedIndices.add(idx);
      i = chain.sourceIndices[chain.sourceIndices.length - 1];
    }
  }

  // ── PERF: Map<funcReg, CallChain> for O(1) lookup per instruction ──
  const funcRegToChain = new Map<number, CallChain>();
  for (const chain of chains) funcRegToChain.set(chain.funcReg, chain);

  // Map: sourceIndices[0] → chain (for comment emission)
  const firstIdxToChain = new Map<number, CallChain>();
  for (const chain of chains) firstIdxToChain.set(chain.sourceIndices[0], chain);

  // Phase 2: Rewrite
  const result: IRInst[] = [];

  for (let i = 0; i < ir.length; i++) {
    const inst = ir[i];

    // Check if this instruction calls a reconstructed function
    let callChain: CallChain | undefined;
    for (const stmt of inst.stmts) {
      if (stmt.kind === "callstmt") {
        callChain = funcRegToChain.get(stmt.base);
      } else if (stmt.kind === "assign" && stmt.src.k === "call" && stmt.src.fn.k === "reg") {
        callChain = funcRegToChain.get(stmt.src.fn.n);
      }
      if (callChain) break;
    }

    if (callChain) {
      const newStmts: IRStmt[] = [];
      for (const stmt of inst.stmts) {
        if (stmt.kind === "callstmt" && stmt.base === callChain.funcReg) {
          newStmts.push({ kind: "comment", text: `CALL ${callChain.resolvedName}(...)` });
          newStmts.push(stmt);
        } else if (stmt.kind === "assign" && stmt.src.k === "call" &&
                   stmt.src.fn.k === "reg" && stmt.src.fn.n === callChain.funcReg) {
          newStmts.push({ kind: "assign", reg: stmt.reg, src: { k: "call", fn: callChain.funcSym, args: stmt.src.args } });
        } else {
          newStmts.push(stmt);
        }
      }
      result.push({ ...inst, stmts: newStmts });
      continue;
    }

    // Skip chain setup instructions (keep first as comment)
    if (replacedIndices.has(i)) {
      const origChain = firstIdxToChain.get(i);
      if (origChain) {
        result.push({ ...inst, stmts: [{ kind: "comment", text: `→ ${origChain.resolvedName}` }] });
      }
      continue;
    }

    result.push(inst);
  }

  return result;
}

export { detectGlobalChain, detectTableMethodChain, detectKPoolMethodChain };
