// Loader Chain Resolver — follows loadstring(game:HttpGet(...)) chains.
//
// Many Roblox "hub" scripts are tiny loaders: not obfuscated themselves,
// they download + run another script which IS obfuscated. This module:
//   1. extracts script URLs from Lua sources (string literals + context)
//   2. classifies each URL by how it is used (direct loadstring call,
//      placeId table entry, fetch call, plain string, ...)
//   3. drives a chain: fetch → detect → deobfuscate → extract next URLs
//      (with depth limit, cycle + duplicate-content guards)
//
// The chain also works for OBFUSCATED loaders: after deobfuscating a step,
// URLs are re-extracted from the recovered output (e.g. a Luraph VM loader
// whose real payload URL only appears after reconstruction).
//
// v3 — NO URL BLOCKING: every http(s) link found in the source is reported
// (Discord invites, webhooks, YouTube, repo links… can be important), and
// URLs used in an execution context (loadstring/HttpGet/[PlaceId]=…) are
// followed regardless of host. When a hop fails (dead link, HTML page,
// duplicate content) the chain backtracks and tries the next candidate
// URL instead of stopping.

import { createHash } from "node:crypto";
import {
  iterStringLiterals,
  looksLikeLuaSource,
  type StringLiteral,
} from "./utils/lua-utils";
import { fetchFromUrl } from "./utils/fetcher";
import { detectObfuscator } from "./detectors/detector";
import {
  runDeobfuscation,
  type OrchestratorOptions,
  type OrchestratorReport,
} from "./deobfuscators/orchestrator";

// ---------------------------------------------------------------------------
// URL extraction
// ---------------------------------------------------------------------------

export type UrlUsage =
  | "loadstring" // literal sits inside loadstring(...fetch(...)) — executed
  | "placeid-table" // [PlaceId] = "url"  (game-hub script map)
  | "httpfetch" // fetched via HttpGet / request({Url=...})
  | "table" // other table entry
  | "var" // assigned to a variable, not clearly executed
  | "plain" // just a string somewhere
  | "dynamic"; // built by concatenation at runtime — cannot follow

export interface ScriptUrl {
  url: string;
  usage: UrlUsage;
  score: number;
  dynamic?: boolean;
}

// v3: NO host/pattern blocklist — a "reference" link (Discord invite,
// webhook, YouTube, image, repo home…) can be exactly the important link a
// forensic analyst needs. Everything http(s) and reasonably short qualifies.
function isScriptUrl(url: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(url)) return false;
  if (url.length > 500) return false;
  return true;
}

function normWs(s: string): string {
  return s.replace(/\s+/g, " ");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract every script-looking URL from a Lua source, classified by how it
 * is used. Literal concatenations are folded before classification and the
 * result is sorted by follow-priority (highest first).
 */
export function extractScriptUrls(src: string): ScriptUrl[] {
  const byUrl = new Map<string, ScriptUrl>();
  let literals: StringLiteral[];
  try {
    literals = [...iterStringLiterals(src)];
  } catch {
    return [];
  }
  // Resolve only adjacent string literals joined by `..`. This is deliberately
  // token-position based, so comments, long strings, and executable expressions
  // cannot be evaluated accidentally while recovering a loader URL.
  const candidates: StringLiteral[] = [...literals];
  for (let i = 0; i < literals.length; i++) {
    let value = literals[i].value;
    let end = literals[i].end;
    for (let j = i + 1; j < literals.length; j++) {
      const between = src.slice(end, literals[j].start);
      if (!/^\s*\.\.\s*$/.test(between)) break;
      value += literals[j].value;
      end = literals[j].end;
      candidates.push({ ...literals[i], value, end });
    }
  }
  const hasLoadstring = /\bloadstring\b/.test(src);

  for (const lit of candidates) {
    const raw = lit.value.trim();
    if (!/^https?:\/\//i.test(raw)) continue;
    if (!isScriptUrl(raw)) continue;

    const before = normWs(src.slice(Math.max(0, lit.start - 260), lit.start));
    const afterRaw = src.slice(lit.end, Math.min(src.length, lit.end + 64));
    const beforeTail = before.slice(-100);

    // URL glued together at runtime (concat) or a bare base path —
    // cannot be resolved statically.
    const dynamic =
      /^\s*\.\./.test(afterRaw) || // "https://..." .. var
      raw.endsWith("/") || // "https://host/base/" .. name
      /%[sdfq]/i.test(raw); // "http://host/%s" :format(...) placeholder

    let usage: UrlUsage = "plain";
    let score = 10;

    // 1) inside loadstring(...fetch(...)) — executed directly
    const lsIdx = before.lastIndexOf("loadstring");
    if (lsIdx >= 0) {
      const between = before.slice(lsIdx);
      if (
        /loadstring\s*\(/.test(between) &&
        /HttpGet|GetAsync|request|http/i.test(between)
      ) {
        usage = "loadstring";
        score = 100;
      }
    }

    // 2) [PlaceId] = "url" — game-hub script map
    if (usage === "plain" && /\[\s*\d{4,}\s*\]\s*=\s*$/.test(beforeTail)) {
      usage = "placeid-table";
      score = hasLoadstring ? 90 : 55;
    }

    // 3) fetch call wraps the literal: HttpGet("…") / {Url = "…"} /
    //    executor aliases (http_request, syn.request, k PROGMEM…). v4 adds
    //    the common exploit-API fetch aliases so more loaders are followed.
    if (usage === "plain") {
      if (
        /(?:HttpGet|HttpGetAsync|GetAsync|httpget|http_get|http_request|\bsyn\.request|request|\bfetch\b|\bget\s*\()\s*[({]?\s*$/.test(beforeTail) ||
        /\b(?:Url|URL|url)\s*=\s*$/.test(beforeTail)
      ) {
        usage = "httpfetch";
        score = 85;
      }
    }

    // 4) generic table entry { "url", ... } / { name = "url", ... }
    if (
      usage === "plain" &&
      /[{,]\s*(?:\[\s*['"][^'"]*['"]\s*\]\s*=\s*)?$/.test(beforeTail)
    ) {
      usage = "table";
      score = hasLoadstring ? 70 : 40;
    }

    // 5) local var = "url" — check whether the var is later executed/fetched
    if (usage === "plain" && !dynamic) {
      const m = /([A-Za-z_]\w*)\s*=\s*$/.exec(beforeTail);
      const varName = m?.[1];
      if (varName) {
        const varRe = new RegExp(`\\b${escapeRe(varName)}\\b`);
        if (varRe.test(src)) {
          const inLoadstring = new RegExp(
            `loadstring\\s*\\([^)]{0,220}\\b${escapeRe(varName)}\\b`
          ).test(src);
          const inFetch = new RegExp(
            `(?:HttpGet|GetAsync|httpget|http_request|syn\\.request|Url\\s*=)[^\\n]{0,140}\\b${escapeRe(varName)}\\b`
          ).test(src);
          if (inLoadstring) {
            usage = "loadstring";
            score = 95;
          } else if (inFetch) {
            usage = "httpfetch";
            score = 80;
          } else {
            usage = "var";
            score = 50;
          }
        }
      }
    }

    if (dynamic) {
      usage = "dynamic";
      score = 5;
    }

    const cand: ScriptUrl = { url: raw, usage, score, dynamic };
    const prev = byUrl.get(raw);
    if (!prev || cand.score > prev.score) byUrl.set(raw, cand);
  }

  return [...byUrl.values()].sort((a, b) => b.score - a.score);
}

/** Merge two URL pools keeping the best score per URL. */
function mergeUrls(lists: ScriptUrl[][]): ScriptUrl[] {
  const byUrl = new Map<string, ScriptUrl>();
  for (const list of lists) {
    for (const u of list) {
      const prev = byUrl.get(u.url);
      if (!prev || u.score > prev.score) byUrl.set(u.url, u);
    }
  }
  return [...byUrl.values()].sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Chain runner
// ---------------------------------------------------------------------------

export interface ChainStepInfo {
  depth: number;
  url: string | null;
  label: string;
  bytes: number;
  isLua: boolean;
  obfuscator: string;
  obfuscatorConfidence: number;
  scriptUrls: number;
  /** ALL links found in this step (source + recovered output), capped. */
  urls: Array<{ url: string; usage: UrlUsage; score: number; dynamic?: boolean }>;
  engine: string | null;
  engineConfidence: number;
  valid: boolean | null;
  issues: number | null;
  outputBytes: number | null;
  note: string | null;
  followedUrl: string | null;
  stopReason: string | null;
}

/** Cap the per-step reported link list (hubs can embed 50+ URLs). */
const MAX_REPORTED_URLS = 30;

export interface ChainRunResult {
  steps: ChainStepInfo[];
  reports: Array<OrchestratorReport | null>;
  inputs: string[];
  /** index of the step whose report is the primary result (deepest deobf) */
  finalIndex: number;
  finalReport: OrchestratorReport | null;
}

export interface ChainRunOptions {
  /** max hops after the entry (entry = depth 0). Default 15. */
  maxDepth?: number;
  /** passed to the orchestrator for every step */
  deobf?: Partial<OrchestratorOptions>;
}

/** Only URLs at/above this score are followed automatically. */
const FOLLOW_SCORE_THRESHOLD = 70;

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function urlKey(u: string): string {
  return u.trim().replace(/\/+$/, "").toLowerCase();
}

function urlBaseName(u: string): string {
  try {
    const p = new URL(u).pathname.split("/").filter(Boolean);
    return decodeURIComponent(p[p.length - 1] ?? "script") || "script";
  } catch {
    return "script";
  }
}

function emptyStep(
  depth: number,
  url: string | null,
  label: string,
  note: string,
  stopReason: string
): ChainStepInfo {
  return {
    depth,
    url,
    label,
    bytes: 0,
    isLua: false,
    obfuscator: "—",
    obfuscatorConfidence: 0,
    scriptUrls: 0,
    urls: [],
    engine: null,
    engineConfidence: 0,
    valid: null,
    issues: null,
    outputBytes: null,
    note,
    followedUrl: null,
    stopReason,
  };
}

/**
 * Run the full deobfuscation chain for an entry script (by URL or source).
 *
 * Each step: fetch → detect obfuscator → deobfuscate → extract loader URLs
 * (from BOTH the raw source and the recovered output) → follow the
 * highest-priority unfollowed URL. v3 adds BACKTRACKING: when a hop fails
 * (fetch error, HTML page instead of Lua, duplicate content), the chain
 * records the dead hop and tries the next candidate URL from the most
 * recent step's pool instead of stopping the whole chain.
 */
export async function runDeobfChain(
  entry: { url?: string; source?: string; baseName?: string },
  opts: ChainRunOptions = {},
  log: (m: string) => void = () => {}
): Promise<ChainRunResult> {
  const maxDepth = opts.maxDepth ?? 15;
  /** dead hops tolerated before giving up entirely (scaled for deep chains) */
  const MAX_DEAD_HOPS = 10;
  const steps: ChainStepInfo[] = [];
  const reports: Array<OrchestratorReport | null> = [];
  const inputs: string[] = [];
  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();
  let finalIndex = -1;
  let deadHops = 0;

  if (entry.url) seenUrls.add(urlKey(entry.url));
  let currentUrl: string | undefined = entry.url;
  let currentDepth = 0;
  let pendingSource: string | undefined = entry.source;

  /** URL pools of processed Lua steps, newest first, for backtracking. */
  const poolStack: Array<{ depth: number; urls: ScriptUrl[] }> = [];

  const finish = (): ChainRunResult => ({
    steps,
    reports,
    inputs,
    finalIndex,
    finalReport: finalIndex >= 0 ? reports[finalIndex] : null,
  });

  /** Mark the last step with why the chain stopped (if not already set). */
  const setLastStop = (reason: string) => {
    const last = steps[steps.length - 1];
    if (last && !last.stopReason) last.stopReason = reason;
  };

  /** Pop poolStack until an unfollowed candidate is found; set currentUrl. */
  const nextCandidate = (): string | undefined => {
    while (poolStack.length > 0) {
      const top = poolStack[0];
      const cand = top.urls.find(
        (u) =>
          !u.dynamic &&
          u.score >= FOLLOW_SCORE_THRESHOLD &&
          !seenUrls.has(urlKey(u.url))
      );
      if (cand) {
        seenUrls.add(urlKey(cand.url));
        currentDepth = top.depth + 1;
        return cand.url;
      }
      poolStack.shift(); // this pool is exhausted
    }
    return undefined;
  };

  /** How meaningful a deobfuscated step is (used to pick the final result). */
  const stepWeight = (s: ChainStepInfo): number =>
    (s.valid === true ? 1 : 0) +
    (s.engineConfidence ?? 0) +
    Math.min(0.5, (s.outputBytes ?? 0) / 2_000_000);

  while (true) {
    const label = currentUrl ? urlBaseName(currentUrl) : entry.baseName || "script";
    const depth = currentDepth;

    // ---- fetch ----
    let source = "";
    if (pendingSource !== undefined) {
      source = pendingSource;
      pendingSource = undefined;
    } else {
      try {
        log(`[chain] (bước ${depth}) tải ${currentUrl}`);
        const f = await fetchFromUrl(currentUrl!);
        source = f.content;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        steps.push(
          emptyStep(depth, currentUrl ?? null, label, `tải lỗi: ${msg}`, "fetch-error")
        );
        reports.push(null);
        inputs.push("");
        // Entry fetch failure → nothing else to try (route surfaces it).
        if (steps.length === 1) return finish();
        deadHops++;
        if (deadHops > MAX_DEAD_HOPS) {
          setLastStop("quá nhiều URL hỏng liên tiếp");
          return finish();
        }
        const next = nextCandidate();
        if (!next) {
          setLastStop("đã thử hết URL khả dĩ (đều hỏng)");
          return finish();
        }
        currentUrl = next;
        continue;
      }
    }

    // ---- duplicate-content / cycle guard ----
    const hash = sha256Hex(source);
    if (seenHashes.has(hash) && depth > 0) {
      steps.push(
        emptyStep(depth, currentUrl ?? null, label, "nội dung trùng bước trước (vòng lặp)", "duplicate")
      );
      reports.push(null);
      inputs.push(source);
      deadHops++;
      if (deadHops > MAX_DEAD_HOPS) {
        setLastStop("quá nhiều URL hỏng liên tiếp");
        return finish();
      }
      const next = nextCandidate();
      if (!next) {
        setLastStop("đã thử hết URL khả dĩ (đều trùng/hỏng)");
        return finish();
      }
      currentUrl = next;
      continue;
    }
    seenHashes.add(hash);

    // ---- detect + deobfuscate ----
    const detection = detectObfuscator(source);
    const isLua = looksLikeLuaSource(source);

    // Non-Lua content (HTML page, README, image, …) — record the hop (the
    // link may be important for the analyst) then TRY THE NEXT CANDIDATE
    // instead of killing the whole chain.
    if (!isLua && source.length > 0 && depth > 0) {
      steps.push({
        depth,
        url: currentUrl ?? null,
        label,
        bytes: source.length,
        isLua,
        obfuscator: detection.obfuscator,
        obfuscatorConfidence: detection.confidence,
        scriptUrls: 0,
        urls: [],
        engine: null,
        engineConfidence: 0,
        valid: null,
        issues: null,
        outputBytes: null,
        note: "nội dung tải về không phải Lua (HTML/ảnh/README?) — thử URL kế tiếp",
        followedUrl: null,
        stopReason: "not-lua",
      });
      reports.push(null);
      inputs.push(source);
      deadHops++;
      if (deadHops > MAX_DEAD_HOPS) {
        setLastStop("quá nhiều URL hỏng liên tiếp");
        return finish();
      }
      const next = nextCandidate();
      if (!next) {
        setLastStop("đã thử hết URL khả dĩ");
        return finish();
      }
      currentUrl = next;
      continue;
    }

    const oopts: OrchestratorOptions = {
      timeoutMs: 25_000,
      acceptThreshold: 0.5,
      maxPasses: 5,
      minPassImprovement: 0.012,
      ...(opts.deobf ?? {}),
    };
    if (oopts.parallel === undefined) {
      // memory safety: sequential engines for big inputs
      oopts.parallel = source.length < 300_000;
    }

    let report: OrchestratorReport | null = null;
    try {
      report = await runDeobfuscation(
        {
          input: source,
          baseName: label,
          source: currentUrl ? "url" : "text",
          url: currentUrl,
          log,
        },
        oopts
      );
    } catch (e: unknown) {
      log(`[chain] deobf lỗi bước ${depth}: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ---- next URL: from raw source AND recovered output ----
    const pool: ScriptUrl[][] = [extractScriptUrls(source)];
    if (report?.best?.output) pool.push(extractScriptUrls(report.best.output));
    const urls = mergeUrls(pool);
    const followed = urls.find(
      (u) => !u.dynamic && u.score >= FOLLOW_SCORE_THRESHOLD && !seenUrls.has(urlKey(u.url))
    );

    steps.push({
      depth,
      url: currentUrl ?? null,
      label,
      bytes: source.length,
      isLua,
      obfuscator: detection.obfuscator,
      obfuscatorConfidence: detection.confidence,
      scriptUrls: urls.length,
      urls: urls.slice(0, MAX_REPORTED_URLS).map((u) => ({
        url: u.url,
        usage: u.usage,
        score: u.score,
        dynamic: u.dynamic,
      })),
      engine: report?.best?.deobfuscator ?? null,
      engineConfidence: report?.best?.confidence ?? 0,
      valid: report?.validation?.ok ?? null,
      issues: report?.validation?.issues.length ?? null,
      outputBytes: report?.best?.output.length ?? null,
      note: isLua ? null : "không phải Lua (README/HTML?)",
      followedUrl: followed?.url ?? null,
      stopReason: null,
    });
    reports.push(report);
    inputs.push(source);
    // Final result = the MOST meaningful deobf across all steps (not just
    // the last hop — deep chains often wander into CDN assets after the
    // real payload has already been recovered).
    if (report?.best) {
      const newStep = steps[steps.length - 1];
      if (finalIndex < 0 || stepWeight(newStep) > stepWeight(steps[finalIndex])) {
        finalIndex = steps.length - 1;
      }
    }

    if (depth >= maxDepth) {
      setLastStop("đạt độ sâu tối đa");
      break;
    }
    if (followed) {
      // Push this step's pool for backtracking, then descend.
      poolStack.unshift({ depth, urls });
      seenUrls.add(urlKey(followed.url));
      currentDepth = depth + 1;
      currentUrl = followed.url;
      continue;
    }
    // No candidate at this level — backtrack to an earlier pool.
    const next = nextCandidate();
    if (!next) {
      setLastStop(urls.length ? "đã thăm hết URL khả dĩ" : "không có URL script");
      break;
    }
    currentUrl = next;
  }

  return finish();
}
