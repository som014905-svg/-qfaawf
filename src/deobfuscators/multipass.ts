// multipass v5.2 — X10-DEEP: portfolio refinement + deeper convergence
import { DeobfuscateContext, DeobfuscateResult } from '../types';
import { GenericDeobfuscator } from './generic';
import { scoreLuaSource, diffSummary } from '../utils/quality';
import { foldConstants } from '../passes/constant-fold';
import { renameCrypticLocals } from '../utils/lua-utils';
import { recoverControlFlow } from '../passes/control-flow';
import { validateLuaSource } from '../utils/validate';
import { inlineStaticTables, inlineOffsetTableLookups, inlineNumericCacheAccessors, normalizeStdlibAliases, normalizeEnvStdlibAliases, foldSimpleXorDecoderFunctions, foldEncodedStringTableLiterals } from "../passes/static-resolve";
import { ModernVMDeobfuscator } from "./modern-vm";

export interface MultiPassOptions {
  maxPasses: number;
  minImprovement: number;
}

/**
 * Run generic cleanup repeatedly, keeping only objectively better candidates.
 * Each pass additionally runs the constant-folding engine so non-generic
 * deobfuscator outputs (IronBrew / Prometheus / MoonSec / ...) get the same
 * folding treatment (string concat, string.char, _G["x"], dead-code, ...),
 * plus a readability pass that renames cryptic locals (`local a = {…}` →
 * `local tbl1 = {…}`) with type inference.
 */
export async function runMultiPass(
  base: DeobfuscateResult,
  ctx: DeobfuscateContext,
  opts: MultiPassOptions,
): Promise<DeobfuscateResult> {
  let best = base;
  let current = base.output;
  const generic = new GenericDeobfuscator();
  const history: string[] = [];

  // ── PERF: cache scores to avoid re-scoring the same string ──
  const scoreCache = new Map<string, ReturnType<typeof scoreLuaSource>>();
  const cachedScore = (s: string) => {
    let sc = scoreCache.get(s);
    if (!sc) { sc = scoreLuaSource(s); scoreCache.set(s, sc); }
    return sc;
  };

  // ── PERF: early exit if base quality is already excellent ──
  if (cachedScore(current).score >= 0.985) {
    return best;
  }

  for (let pass = 1; pass <= Math.min(12, Math.max(1, opts.maxPasses)); pass++) {
    // Step A: run constant folding on the current candidate.
    let foldNotes: string[] = [];
    try {
      const fold = foldConstants(current, 2);
      if (fold.folded > 0) {
        const afterFold = cachedScore(fold.result);
        const beforeFold = cachedScore(current);
        // Only accept the fold if it didn't break bracket balance and either
        // improved the score OR folded a meaningful number of expressions.
        if (afterFold.balanced && (afterFold.score >= beforeFold.score - 0.01 || fold.folded >= 3)) {
          current = fold.result;
          foldNotes = fold.notes.slice(0, 4);
        }
      }
    } catch {
      // Folding is best-effort; ignore failures.
    }

    // Step A1a: resolve modern VM literal factories first.
    try {
      const modern = new ModernVMDeobfuscator();
      if (modern.detect(current)) {
        const mr = await modern.deobfuscate({ ...ctx, input: current, log: () => {} });
        const mq = cachedScore(mr.output);
        const bq = cachedScore(current);
        if (mr.output !== current && mq.balanced && mq.score >= bq.score - 0.02) {
          current = mr.output;
          foldNotes = [...foldNotes, ...(mr.notes ?? []).slice(0, 4)];
        }
      }
    } catch {
      // best-effort
    }

    // Step A1b: resolve safe table lookups and pure stdlib aliases.
    try {
      const envAlias = normalizeEnvStdlibAliases(current);
      const alias = normalizeStdlibAliases(envAlias.result);
      const xorDec = foldSimpleXorDecoderFunctions(alias.result);
      const encodedTables = foldEncodedStringTableLiterals(xorDec.result);
      const offsetTable = inlineOffsetTableLookups(encodedTables.result);
      const cacheAccess = inlineNumericCacheAccessors(offsetTable.result);
      const table = inlineStaticTables(cacheAccess.result);
      const candidate = table.result;
      const q = cachedScore(candidate);
      const beforeQ = cachedScore(current);
      if ((xorDec.changed + encodedTables.changed + offsetTable.changed + cacheAccess.changed + envAlias.changed + alias.changed + table.changed) > 0 && q.balanced && q.score >= beforeQ.score - 0.02) {
        current = candidate;
        foldNotes = [...foldNotes, ...xorDec.notes, ...encodedTables.notes, ...offsetTable.notes, ...cacheAccess.notes, ...envAlias.notes, ...alias.notes, ...table.notes];
      }
    } catch {
      // best-effort
    }

    // Step A1c (v4): control-flow recovery — unroll provable dispatcher
    // state machines (control-flow flattening). Only accepted when the
    // result still passes static validation.
    try {
      const cf = recoverControlFlow(current);
      if (cf.changed > 0) {
        const afterCf = validateLuaSource(cf.result);
        if (afterCf.ok) {
          current = cf.result;
          foldNotes = [...foldNotes, ...cf.notes];
        }
      }
    } catch {
      // best-effort
    }

    // Step A2: readability — rename cryptic locals (type-inferred, safe).
    try {
      const rn = renameCrypticLocals(current);
      if (rn.renamed > 0) {
        const q = cachedScore(rn.result);
        const beforeRn = cachedScore(current);
        if (q.balanced && q.score >= beforeRn.score - 0.02) {
          current = rn.result;
          foldNotes = [...foldNotes, `renamed ${rn.renamed} cryptic local(s) to readable names`];
        }
      }
    } catch {
      // Renaming is best-effort; ignore failures.
    }

    // Step B: run generic cleanup on the folded candidate.
    const childCtx: DeobfuscateContext = { ...ctx, input: current };
    const result = await generic.deobfuscate(childCtx);
    const before = cachedScore(current);
    const after = cachedScore(result.output);
    const delta = after.score - before.score;
    if (delta > 0 || result.output !== current) {
      history.push(`pass ${pass}: ${diffSummary(current, result.output).join(", ")}`);
    }

    if (!result.output || result.output === current || delta < opts.minImprovement) {
      // Even if generic made no progress, keep the folding we did.
      if (current !== best.output) {
        scoreCache.delete(best.output);
        best = {
          ...base,
          output: current,
          confidence: Math.min(0.99, Math.max(base.confidence, base.confidence + 0.02)),
          notes: [
            ...(base.notes ?? []),
            ...(foldNotes.length ? [`Multi-pass folding: ${foldNotes.join('; ')}`] : []),
          ],
        };
      }
      break;
    }
    if (!after.balanced) break;

    current = result.output;
    if (after.score >= cachedScore(best.output).score) {
      best = {
        ...base,
        output: current,
        confidence: Math.min(0.99, Math.max(base.confidence, base.confidence + Math.max(0, delta))),
        notes: [
          ...(base.notes ?? []),
          ...(foldNotes.length ? [`Multi-pass folding: ${foldNotes.join('; ')}`] : []),
          `Multi-pass cleanup improved the static quality score on pass ${pass}.`,
        ],
      };
    }
  }

  if (history.length) {
    best.notes = [...(best.notes ?? []), ...history.map((h) => `multipass: ${h}`)];
  }
  return best;
}
