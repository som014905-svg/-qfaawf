// Orchestrator: runs detection, orders deobfuscators by confidence, runs
// them IN PARALLEL (Promise.allSettled), and picks the best result by
// result-confidence. Then runs the multi-pass cleanup + static validation.
//
// The detector recognises ~55 different obfuscators. We map each to a
// "family" (luraph, moonveil, moonsec, ironbrew, wearedevs, prometheus, or
// generic) so that forks/variants reuse the matching deobfuscator.
//
// Results are memoised in an LRU cache keyed by the input SHA-256 so that
// re-running the same URL/attachment is instant.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult } from "../types";
import { detectObfuscator, detectObfuscatorsDetailed, familyOf } from "../detectors/detector";
import { scanRobloxApiUsage, RobloxScanResult } from "../utils/roblox-detector";
import { scoreOutputDetailed, DetailedQuality } from "../utils/quality";
import { classifyEngineError, EngineErrorKind } from "../utils/error-types";
import { GenericDeobfuscator } from "./generic";
import { LuraphDeobfuscator } from "./luraph";
import { LuastDeobfuscator } from "./luast";
import { LuraphVMDeobfuscator } from "./luraph-vm";
import { LuraphVMDecoder } from "./luraph-vm-decode";
import { MoonVeilDeobfuscator } from "./moonveil";
import { MoonSecDeobfuscator } from "./moonsec";
import { IronBrewDeobfuscator } from "./ironbrew";
import { WeAreDevsDeobfuscator } from "./wearedevs";
import { PrometheusDeobfuscator } from "./prometheus";
import { QMarkerVMDeobfuscator } from "./qmarker-vm";
import { AstroProtectDeobfuscator } from "./astrotect";
import { XorStringsDeobfuscator } from "./xorstrings";
import { TagTableDeobfuscator } from "./tagtable";
import { HeavyWeightFishingDeobfuscator } from "./heavyweightfishing";
import { ModernVMDeobfuscator } from "./modern-vm";
import { HerculesDeobfuscator } from "./hercules";
import { IronveilDeobfuscator } from "./ironveil";
import { LuaObfuscatorChaoticDeobfuscator } from "./luaobfuscator-chaotic";
import { runMultiPass } from "./multipass";
import { scoreLuaSource } from "../utils/quality";
import { validateLuaSource, summarizeIssues, ValidationResult } from "../utils/validate";
import { DeobfCache } from "../utils/cache";

export interface OrchestratorOptions {
  timeoutMs: number;
  /** Stop after the first deobfuscator whose confidence >= this threshold. */
  acceptThreshold: number;
  maxPasses?: number;
  minPassImprovement?: number;
  /** Run deobfuscators in parallel. Default true. */
  parallel?: boolean;
  /** Memoise results in an LRU cache. Default true. */
  useCache?: boolean;
  /** Re-feed the winning output through the full deobfuscation portfolio. */
  deepRounds?: number;
  /** Minimum quality improvement required to accept a recursive round. */
  deepMinImprovement?: number;
}

export interface RunStep {
  deobfuscator: string;
  detectionConfidence: number;
  ran: boolean;
  success: boolean;
  resultConfidence: number;
  durationMs: number;
  error?: string;
  /** v4: classified failure reason (timeout/parse/unsupported/...) */
  errorKind?: EngineErrorKind;
}

export interface OrchestratorReport {
  detected: { obfuscator: string; confidence: number; evidence: string };
  steps: RunStep[];
  best: DeobfuscateResult | null;
  /** Roblox API scan result (run on the best deobfuscated output) */
  roblox: RobloxScanResult | null;
  quality: ReturnType<typeof scoreLuaSource> | null;
  /** Static syntax validation of the best output. */
  validation: ValidationResult | null;
  /** True when the result came from the LRU cache (no deobfuscator ran). */
  fromCache: boolean;
  /** Total wall-clock duration in ms. */
  totalDurationMs: number;
  /** v4: detailed quality breakdown of the winning output */
  qualityDetailed?: DetailedQuality;
  /** v4: why this candidate won (ranking explanation) */
  selectionNote?: string;
}

const ALL_DEOBFUSCATORS: Deobfuscator[] = [
  new LuastDeobfuscator(),
  new LuraphDeobfuscator(),
  new LuraphVMDeobfuscator(),
  new LuraphVMDecoder(),
  new MoonVeilDeobfuscator(),
  new MoonSecDeobfuscator(),
  new IronBrewDeobfuscator(),
  new WeAreDevsDeobfuscator(),
  new PrometheusDeobfuscator(),
  new QMarkerVMDeobfuscator(),
  new AstroProtectDeobfuscator(),
  new XorStringsDeobfuscator(),
  new TagTableDeobfuscator(),
  new HeavyWeightFishingDeobfuscator(),
  new ModernVMDeobfuscator(),
  new HerculesDeobfuscator(),
  new IronveilDeobfuscator(),
  new LuaObfuscatorChaoticDeobfuscator(),
  new GenericDeobfuscator(),
];

// Module-level LRU cache shared across runs (the bot is a single process).
const REPORT_CACHE = new DeobfCache<OrchestratorReport>(64, 64 * 1024 * 1024);

export async function runDeobfuscation(
  ctx: DeobfuscateContext,
  opts: OrchestratorOptions
): Promise<OrchestratorReport> {
  const t0 = Date.now();

  // 0) Cache lookup.
  if (opts.useCache !== false) {
    const cached = REPORT_CACHE.get(ctx.input);
    if (cached) {
      ctx.log(">>> cache hit — returning cached result");
      return { ...cached, fromCache: true, totalDurationMs: Date.now() - t0 };
    }
  }

  const detection = detectObfuscator(ctx.input);
  const detailed = detectObfuscatorsDetailed(ctx.input);
  const detectedFamily = familyOf(detection.obfuscator);
  const steps: RunStep[] = [];
  if (detailed.features.vmDispatcher || detailed.features.controlFlowFlattening) {
    ctx.log(
      `>>> structural: ${[
        detailed.features.vmDispatcher ? "VM dispatcher" : null,
        detailed.features.stringTableVm ? "string-table VM" : null,
        detailed.features.controlFlowFlattening ? "control-flow flattening" : null,
        detailed.features.loaderWrapper ? "loader wrapper" : null,
      ]
        .filter(Boolean)
        .join(", ")}`
    );
  }

  // Build a priority list: each deobfuscator's own detect() first, then fall
  // back to the family mapping (e.g. "ironbrew1" → ironbrew deobfuscator).
  const scored: Array<{ deob: Deobfuscator; score: number; evidence: string; family?: string }> = [];
  for (const d of ALL_DEOBFUSCATORS) {
    const local = d.detect(ctx.input);
    let score = local ? local.confidence : 0;
    let evidence = local?.evidence ?? detection.evidence;
    if (score === 0 && d.id === detectedFamily) {
      score = detection.confidence * 0.8; // slight discount vs direct match
      evidence = `${detection.obfuscator} → family=${detectedFamily} (${detection.evidence})`;
    }
    if (score > 0 || d.id === "generic") {
      scored.push({ deob: d, score, evidence, family: detectedFamily });
    }
  }
  // sort by score desc, but always keep generic last
  scored.sort((a, b) => {
    if (a.deob.id === "generic") return 1;
    if (b.deob.id === "generic") return -1;
    return b.score - a.score;
  });

  // Each deobfuscator gets its own log buffer so parallel logs don't tangle.
  const runOne = async (entry: { deob: Deobfuscator; score: number }): Promise<{
    step: RunStep;
    result: DeobfuscateResult | null;
    logs: string[];
  }> => {
    const { deob, score } = entry;
    const step: RunStep = {
      deobfuscator: deob.name,
      detectionConfidence: score,
      ran: false,
      success: false,
      resultConfidence: 0,
      durationMs: 0,
    };
    const localLogs: string[] = [];
    const childCtx: DeobfuscateContext = {
      ...ctx,
      log: (msg: string) => localLogs.push(msg),
    };
    const tStart = Date.now();
    try {
      localLogs.push(`>>> trying ${deob.name} (detect=${(score * 100).toFixed(0)}%)...`);
      step.ran = true;
      const result = await withTimeout(deob.deobfuscate(childCtx), opts.timeoutMs);
      step.durationMs = Date.now() - tStart;
      step.resultConfidence = result.confidence;
      step.success = result.success && result.confidence > 0.1;
      // Flush logs to the main ctx AFTER the run completes (serialised).
      for (const l of localLogs) ctx.log(l);
      return { step, result, logs: localLogs };
    } catch (e: unknown) {
      const cls = classifyEngineError(e);
      step.durationMs = Date.now() - tStart;
      step.error = cls.message;
      step.errorKind = cls.kind;
      step.success = false;
      for (const l of localLogs) ctx.log(l);
      ctx.log(`    ${deob.name} failed [${cls.kind}]: ${cls.message}`);
      return { step, result: null, logs: localLogs };
    }
  };

  // ── v4 winner selection ────────────────────────────────────────────────
  // Candidates are ranked by MEASURED OUTPUT QUALITY, not by the engine's
  // self-reported confidence. An engine that produces a longer/broken output
  // with high self-confidence can no longer win over a smaller valid one.
  // Ranking formula (see scoreOutputDetailed):
  //   45% syntax validity + 20% readability + 20% recovery + 15% cleanliness
  // plus a bonus term from the engine's own confidence (15% weight) so a
  // targeted engine that recovers embedded SOURCE still beats a generic
  // cleanup of the same script.
  interface Candidate {
    result: DeobfuscateResult;
    quality: DetailedQuality;
    rank: number;
  }
  // ctx.input is a latin1-mapped byte string (1 JS char = 1 original byte, see
  // cli.ts/fetcher.ts), so its own .length already is the exact byte count.
  const inputBytes = ctx.input.length;
  const rankCandidate = (result: DeobfuscateResult): Candidate => {
    let syntaxOk = true;
    let syntaxErrors = 0;
    try {
      const v = validateLuaSource(result.output);
      syntaxOk = v.ok;
      syntaxErrors = v.issues.filter((i) => i.severity === "error").length;
    } catch {
      syntaxOk = false;
      syntaxErrors = 1;
    }
    const quality = scoreOutputDetailed({
      source: result.output,
      inputBytes,
      syntaxOk,
      syntaxErrors,
    });
    const rank = quality.score * 0.85 + result.confidence * 0.15;
    return { result, quality, rank };
  };

  const candidates: Candidate[] = [];
  if (opts.parallel !== false) {
    // Run all candidate deobfuscators in parallel, then rank the outputs.
    const results = await Promise.allSettled(scored.map(runOne));
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const { step, result } = r.value;
      steps.push(step);
      if (result && result.success && result.output) {
        candidates.push(rankCandidate(result));
      }
    }
  } else {
    // Sequential mode (kept for debugging / opt-out / large-file memory).
    for (const entry of scored) {
      const r = await runOne(entry);
      steps.push(r.step);
      if (r.result && r.result.success && r.result.output) {
        candidates.push(rankCandidate(r.result));
      }
    }
  }

  // X10 refinement portfolio: the first ranking is only a triage step.
  // Refine several strong candidates before choosing a winner so a targeted
  // VM lifter is not discarded merely because its raw lift is less readable
  // than a generic cleanup. This is intentionally capped to keep worst-case
  // runtime bounded on very large samples.
  candidates.sort((a, b) => b.rank - a.rank);
  if (candidates.length > 0) {
    const refineCount = Math.min(4, candidates.length);
    ctx.log(`>>> x10 portfolio refinement: ${refineCount} candidate(s)...`);
    for (let i = 0; i < refineCount; i++) {
      const c = candidates[i];
      try {
        const refined = await runMultiPass(c.result, ctx, {
          maxPasses: Math.min(10, Math.max(6, opts.maxPasses ?? 8)),
          minImprovement: Math.min(0.01, opts.minPassImprovement ?? 0.012),
        });
        if (refined.output && refined.output !== c.result.output) {
          const v = validateLuaSource(refined.output);
          const q = scoreOutputDetailed({
            source: refined.output,
            inputBytes,
            syntaxOk: v.ok,
            syntaxErrors: v.issues.filter((x) => x.severity === "error").length,
          });
          const rank = q.score * 0.85 + refined.confidence * 0.15;
          candidates[i] = { result: refined, quality: q, rank };
          ctx.log(`    refined ${refined.deobfuscator}: ${(q.score * 100).toFixed(0)}% quality`);
        }
      } catch (e: unknown) {
        ctx.log(`    refinement ${i + 1} skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    candidates.sort((a, b) => b.rank - a.rank);
  }

  let best: DeobfuscateResult | null = candidates.length > 0 ? candidates[0].result : null;
  let bestQuality: DetailedQuality | null = candidates.length > 0 ? candidates[0].quality : null;
  let selectionNote: string | undefined;
  if (candidates.length > 0) {
    const w = candidates[0];
    selectionNote =
      `selected ${w.result.deobfuscator}: quality ${(w.quality.score * 100).toFixed(0)}% ` +
      `(syntax ${(w.quality.syntaxScore * 100).toFixed(0)}%, readability ${(w.quality.readabilityScore * 100).toFixed(0)}%, ` +
      `recovery ${(w.quality.recoveryScore * 100).toFixed(0)}%, clean ${(w.quality.residualObfuscationScore * 100).toFixed(0)}%, dispatcher ${(w.quality.dispatcherResidue * 100).toFixed(0)}%, aliases ${(w.quality.aliasResidue * 100).toFixed(0)}%)` +
      (candidates.length > 1 ? ` — beat ${candidates.length - 1} alternative(s)` : "");
    ctx.log(`>>> winner: ${selectionNote}`);
    // v4 safety: if the winner has syntax errors but a lower-ranked candidate
    // does not, prefer the valid one (recovery can be redone, syntax cannot).
    if (w.quality.syntaxScore < 1) {
      const valid = candidates.find((c) => c.quality.syntaxScore === 1);
      if (valid) {
        best = valid.result;
        bestQuality = valid.quality;
        selectionNote += ` — winner had syntax issues, fell back to ${valid.result.deobfuscator}`;
        ctx.log(`>>> fallback: ${valid.result.deobfuscator} (winner had syntax errors)`);
      }
    }
  }

  if (best) {
    try {
      ctx.log(`>>> multi-pass cleanup (up to ${opts.maxPasses ?? 6} passes)...`);
      best = await runMultiPass(best, ctx, {
        maxPasses: opts.maxPasses ?? 6,
        minImprovement: opts.minPassImprovement ?? 0.015,
      });
    } catch (e: unknown) {
      ctx.log(`    multipass failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // X10-DEEP recursive convergence: feed the current winner back through the
  // full portfolio when residual obfuscation is still present. The round is
  // bounded and accepted only when measured quality improves, preventing
  // oscillation or output bloat from being mistaken for successful recovery.
  if (best && (opts.deepRounds ?? 0) > 0) {
    const rounds = Math.min(4, Math.max(0, Math.floor(opts.deepRounds ?? 0)));
    const threshold = Math.max(0.001, opts.deepMinImprovement ?? 0.008);
    let currentBest = best;
    let currentRank = 0;
    try {
      const v0 = validateLuaSource(currentBest.output);
      currentRank = scoreOutputDetailed({
        source: currentBest.output,
        inputBytes,
        syntaxOk: v0.ok,
        syntaxErrors: v0.issues.filter((x) => x.severity === "error").length,
      }).score;
    } catch {
      currentRank = 0;
    }

    for (let round = 1; round <= rounds; round++) {
      const qNow = scoreOutputDetailed({
        source: currentBest.output,
        inputBytes,
        syntaxOk: true,
        syntaxErrors: 0,
      });
      if (qNow.residualObfuscationScore >= 0.985 && qNow.readabilityScore >= 0.92) {
        ctx.log(`>>> deep convergence stopped: output already clean/readable (${(qNow.score * 100).toFixed(0)}%)`);
        break;
      }

      ctx.log(`>>> deep convergence round ${round}/${rounds}: re-deobfuscating previous output...`);
      try {
        const nested = await runDeobfuscation(
          { ...ctx, input: currentBest.output },
          { ...opts, useCache: false, deepRounds: 0 },
        );
        if (!nested.best || nested.best.output === currentBest.output) break;

        const vn = validateLuaSource(nested.best.output);
        const qn = scoreOutputDetailed({
          source: nested.best.output,
          inputBytes,
          syntaxOk: vn.ok,
          syntaxErrors: vn.issues.filter((x) => x.severity === "error").length,
        });
        if (!vn.ok && qn.syntaxScore < 1) {
          ctx.log(`    deep round ${round} rejected: syntax validation failed`);
          break;
        }

        // Reject output bloat unless it buys a real quality gain. A huge
        // expansion is a common failure mode when generic string/table passes
        // are applied to already-recovered source.
        const expansion = nested.best.output.length / Math.max(1, currentBest.output.length);
        const expansionTooHigh = expansion > 1.35 && qn.score < currentRank + 0.04;
        if (expansionTooHigh) {
          ctx.log(`    deep round ${round} rejected: output expanded ${Math.round((expansion - 1) * 100)}% without enough quality gain`);
          break;
        }

        if (qn.score >= currentRank + threshold) {
          currentBest = nested.best;
          currentRank = qn.score;
          ctx.log(`    deep round ${round} accepted: quality ${(qn.score * 100).toFixed(1)}%`);
        } else {
          ctx.log(`    deep round ${round} rejected: no meaningful improvement (${(currentRank * 100).toFixed(1)}% → ${(qn.score * 100).toFixed(1)}%)`);
          break;
        }
      } catch (e: unknown) {
        ctx.log(`    deep round ${round} failed: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
    best = currentBest;
  }

  // Roblox API scan — runs on the best deobfuscated output (if any) to
  // surface which Roblox APIs the script uses (game, GetService, FireServer,
  // etc.). This is a read-only static scan — nothing is executed.
  let roblox: RobloxScanResult | null = null;
  if (best) {
    try {
      ctx.log(">>> scanning for Roblox API usage...");
      roblox = scanRobloxApiUsage(best.output);
      if (roblox.found) {
        ctx.log(`    roblox: ${roblox.totalCalls} API calls across ${roblox.usages.length} unique APIs`);
        if (roblox.services.length > 0) {
          ctx.log(`    services: ${roblox.services.join(", ")}`);
        }
      } else {
        ctx.log("    roblox: no Roblox API usage detected");
      }
    } catch (e: unknown) {
      ctx.log(`    roblox scan failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Static syntax validation of the best output.
  let validation: ValidationResult | null = null;
  if (best) {
    try {
      ctx.log(">>> static syntax validation...");
      validation = validateLuaSource(best.output);
      if (validation.ok) {
        ctx.log(`    validation: ${validation.summary}`);
      } else {
        ctx.log(`    validation: ${validation.summary}`);
        const preview = summarizeIssues(validation.issues, 4);
        ctx.log(`    issues:\n${preview}`);
      }
    } catch (e: unknown) {
      ctx.log(`    validation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // The winner may have changed substantially during the final cleanup or
  // deep-convergence rounds. Re-score the actual emitted source so reports
  // and CLI output never expose stale pre-cleanup quality metrics.
  if (best) {
    try {
      const finalValidation = validation ?? validateLuaSource(best.output);
      bestQuality = scoreOutputDetailed({
        source: best.output,
        inputBytes,
        syntaxOk: finalValidation.ok,
        syntaxErrors: finalValidation.issues.filter((x) => x.severity === "error").length,
      });
      if (selectionNote) {
        selectionNote += `; final quality ${(bestQuality.score * 100).toFixed(0)}%`;
      }
    } catch (e: unknown) {
      ctx.log(`    final quality scoring failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const report: OrchestratorReport = {
    detected: {
      obfuscator: detection.obfuscator,
      confidence: detection.confidence,
      evidence: detection.evidence,
    },
    steps,
    best,
    roblox,
    quality: best ? scoreLuaSource(best.output) : null,
    qualityDetailed: bestQuality ?? undefined,
    selectionNote,
    validation,
    fromCache: false,
    totalDurationMs: Date.now() - t0,
  };

  // Cache the result.
  if (opts.useCache !== false && best) {
    REPORT_CACHE.set(ctx.input, report);
  }

  return report;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const effective = Number.isFinite(ms) && ms > 0 ? ms : 30_000;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${effective}ms`)), effective);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Inspect the shared cache stats (for the .stats command). */
export function cacheStats(): { entries: number; bytes: number; hits: number } {
  return REPORT_CACHE.stats();
}

/** Clear the shared cache (for the .stats clear sub-command). */
export function clearCache(): void {
  REPORT_CACHE.clear();
}
