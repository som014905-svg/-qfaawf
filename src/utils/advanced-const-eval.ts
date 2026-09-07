// Advanced Constant Evaluator v5.1 — Demonology X10-FAST
//
// PERF UPGRADES vs v5.0:
//   - propagateAcrossBlocks now actually runs symbolic propagation over the IR
//     (was a complete stub returning empty Map)
//   - evaluateAdvanced delegates to evaluateSymbolic for the hot arithmetic
//     path — avoids duplicated switch logic

import { Sym } from "../vm/luraph-lifter";
import { evaluateSymbolic, SymbolicValue, propagateConstantsSymbolic } from "../vm/symbolic-exec";

export interface EvalResult {
  known: boolean;
  value?: unknown;
  type?: string;
}

// Convert SymbolicValue → EvalResult
function toEvalResult(sv: SymbolicValue): EvalResult {
  if (sv.kind === "concrete") return { known: true, value: sv.value, type: typeof sv.value };
  return { known: false };
}

// Thin shim: reuse evaluateSymbolic from symbolic-exec (avoids duplicate logic)
export function evaluateAdvanced(sym: Sym, env: Map<string, EvalResult>): EvalResult {
  // Convert env (string keys) to regState Map<number, SymbolicValue>
  const regState = new Map<number, SymbolicValue>();
  for (const [k, v] of env) {
    if (k.startsWith("R")) {
      const n = parseInt(k.slice(1), 10);
      if (!isNaN(n) && v.known) regState.set(n, { kind: "concrete", value: v.value });
    }
  }
  return toEvalResult(evaluateSymbolic(sym, regState));
}

// ── UPGRADED: actually propagates across IR blocks ──
export function propagateAcrossBlocks(ir: any[]): Map<string, EvalResult> {
  const result = new Map<string, EvalResult>();
  if (!ir || ir.length === 0) return result;

  try {
    const symState = propagateConstantsSymbolic(ir);
    for (const [reg, sv] of symState) {
      result.set(`R${reg}`, toEvalResult(sv));
    }
  } catch {
    // best-effort
  }
  return result;
}
