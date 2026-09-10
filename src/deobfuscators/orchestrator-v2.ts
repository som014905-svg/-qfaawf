// Orchestrator v5.0 - integrates all X10 passes
// Demonology X10

import { runMultiPass } from "./multipass";
import { propagateConstantsSymbolic, detectAntiTamper } from "../vm/symbolic-exec";
import { reconstructCalls } from "../passes/call-reconstruct";
import { analyzeLifetimes, generateNames } from "../passes/lifetime-analysis";
import { buildBasicBlocks, detectLoops, structureCFG, emitStructured } from "../passes/cfg-structurer";
import { liftInstruction, getMnemonic } from "../vm/luraph-lifter-v2";
import { evaluateAdvanced } from "../utils/advanced-const-eval";

export interface X10Result {
  source: string;
  antiTamper: Map<string, number[]>;
  lifetimes: any[];
  structured: string;
  quality: number;
}

export function runX10Pipeline(ir: any[]): X10Result {
  // 1. Symbolic constant propagation
  const symState = propagateConstantsSymbolic(ir);

  // 2. Anti-tamper detection
  const antiTamper = detectAntiTamper(ir);

  // 3. Call reconstruction
  ir = reconstructCalls(ir);

  // 4. Lifetime analysis
  const lifetimes = analyzeLifetimes(ir);
  const names = generateNames(lifetimes);

  // 5. CFG structuring
  const blocks = buildBasicBlocks(ir);
  const region = structureCFG(blocks);
  const structured = emitStructured(region, blocks);

  const structuralScore = scoreStructuredSource(structured);
  return {
    source: structured,
    antiTamper,
    lifetimes,
    structured,
    quality: structuralScore
  };
}

export function runX10WithLift(op: number, vip: number, cols: Map<string, number>, consts: Map<number, unknown>, regCount: number): any[] {
  return liftInstruction(op, vip, cols, consts, regCount);
}

export { getMnemonic, liftInstruction };

function scoreStructuredSource(source: string): number {
  const length = Math.max(1, source.length);
  const nested = (source.match(/\bif\s+[^\n]+\s+then\s+if\b/gi) || []).length;
  const loops = (source.match(/\bwhile\s+true\s+do\b/gi) || []).length;
  const cryptic = (source.match(/\b(?:tbl|num|fn|var)\d+\b/g) || []).length;
  const density = Math.max(0, 1 - (nested * 120 + loops * 30 + cryptic * 2) / length);
  return Math.round(Math.max(0, Math.min(100, density * 100)));
}
