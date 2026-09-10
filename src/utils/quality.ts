import { tokenize, LuaToken } from './lua-utils';
import { measureDispatcherResidue, DispatcherMetrics } from './dispatcher-metrics';

export interface SourceQuality {
  bytes: number;
  lines: number;
  nonWhitespaceChars: number;
  stringLiterals: number;
  functionCount: number;
  tableCount: number;
  longStrings: number;
  comments: number;
  suspiciousVmTokens: number;
  balanced: boolean;
  score: number;
}

/**
 * Static-only quality scoring. This never executes Lua/Luau code.
 * It is intentionally heuristic and is used to compare candidate outputs.
 */
export function scoreLuaSource(source: string): SourceQuality {
  const tokens = [...tokenize(source)];
  let strings = 0;
  let longStrings = 0;
  let functions = 0;
  let tables = 0;
  let comments = 0;
  let suspiciousVmTokens = 0;
  let nonWhitespaceChars = 0;

  for (const t of tokens) {
    if (t.kind !== 'whitespace' && t.kind !== 'newline' && t.kind !== 'eof') {
      nonWhitespaceChars += t.text.length;
    }
    if (t.kind === 'string') strings++;
    if (t.kind === 'longstring') longStrings++;
    if (t.kind === 'comment' || t.kind === 'longcomment') comments++;
    if (t.kind === 'keyword' && t.text === 'function') functions++;
    if (t.text === '{') tables++;
    if (t.kind === 'identifier' && /^(?:dispatch|opcode|handler|vm_|const|_ENV|_G)$/i.test(t.text)) {
      suspiciousVmTokens++;
    }
  }

  const balanced = isBalanced(tokens);
  const lines = source.length ? source.split(/\r?\n/).length : 0;
  const ratio = nonWhitespaceChars === 0 ? 0 : Math.min(1, nonWhitespaceChars / Math.max(1, source.length));
  let score = 0.2;
  if (balanced) score += 0.2;
  if (functions > 0) score += 0.1;
  if (ratio > 0.35) score += 0.1;
  if (strings < Math.max(25, functions * 20)) score += 0.1;
  if (suspiciousVmTokens === 0) score += 0.15;
  if (lines >= 2) score += 0.05;
  if (source.length < 32) score -= 0.2;
  if (suspiciousVmTokens > 100) score -= 0.15;

  return {
    bytes: Buffer.byteLength(source),
    lines,
    nonWhitespaceChars,
    stringLiterals: strings,
    functionCount: functions,
    tableCount: tables,
    longStrings,
    comments,
    suspiciousVmTokens,
    balanced,
    score: Math.max(0, Math.min(1, score)),
  };
}

function isBalanced(tokens: LuaToken[]): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const t of tokens) {
    if (t.kind !== 'punct' && t.kind !== 'operator') continue;
    if (t.text === '(' || t.text === '[' || t.text === '{') stack.push(t.text);
    else if (t.text === ')' || t.text === ']' || t.text === '}') {
      if (stack.pop() !== pairs[t.text]) return false;
    }
  }
  return stack.length === 0;
}

export function diffSummary(before: string, after: string): string[] {
  const a = scoreLuaSource(before);
  const b = scoreLuaSource(after);
  return [
    `bytes ${a.bytes} → ${b.bytes}`,
    `lines ${a.lines} → ${b.lines}`,
    `functions ${a.functionCount} → ${b.functionCount}`,
    `strings ${a.stringLiterals} → ${b.stringLiterals}`,
    `VM markers ${a.suspiciousVmTokens} → ${b.suspiciousVmTokens}`,
    `quality ${(a.score * 100).toFixed(0)}% → ${(b.score * 100).toFixed(0)}%`,
  ];
}

// ---------------------------------------------------------------------------
// v4 detailed output scoring — used by the orchestrator to rank candidates
// ---------------------------------------------------------------------------

export interface DetailedQuality {
  score: number;
  syntaxScore: number;
  readabilityScore: number;
  recoveryScore: number;
  residualObfuscationScore: number;
  dispatcherResidue: number;
  aliasResidue: number;
  numericStateResidue: number;
  semanticApiRecovery: number;
  notes: string[];
}

/** Obfuscation residue markers counted in the residual score. */
const RESIDUAL_IDENT_RE = /^(?:dispatch|opcode|opcodes|handler|handlers|vm_|vm|instr|proto)$/i;

export interface DetailedQualityInput {
  source: string;
  /** original input size (bytes) for the reduction signal */
  inputBytes: number;
  /** static validation ok flag (from validate.ts) */
  syntaxOk: boolean;
  /** number of validation errors */
  syntaxErrors: number;
}

/**
 * Score a deobfuscation OUTPUT for ranking. Combines:
 *  - syntaxScore   : validation result (fatal > recoverable > warning)
 *  - readabilityScore : identifier readability, line structure, string share
 *  - recoveryScore : size reduction vs input, recovered strings/functions
 *  - residualObfuscationScore : 1 − leftover VM/obf markers (higher = cleaner)
 * The aggregate `score` weights syntax highest — a broken output can never
 * outrank a valid-but-less-recovered one.
 */
export function scoreOutputDetailed(inp: DetailedQualityInput): DetailedQuality {
  const notes: string[] = [];
  const base = scoreLuaSource(inp.source);

  // syntax
  let syntaxScore = 1;
  if (!inp.syntaxOk) {
    syntaxScore = inp.syntaxErrors >= 3 ? 0.1 : inp.syntaxErrors === 1 ? 0.5 : 0.3;
    notes.push(`${inp.syntaxErrors} syntax error(s)`);
  } else if (!base.balanced) {
    syntaxScore = 0.4;
    notes.push("bracket imbalance");
  }

  // readability
  const lines = base.lines;
  const avgLineLen = lines > 0 ? base.nonWhitespaceChars / lines : 0;
  let readabilityScore = 0.4;
  if (avgLineLen > 0 && avgLineLen < 90) readabilityScore += 0.2;
  else notes.push(`avg line length ${Math.round(avgLineLen)} (minified?)`);
  if (lines >= 4) readabilityScore += 0.15;
  if (base.comments > 0) readabilityScore += 0.05;
  // readable identifier share: cryptic 1-3 char + Il1O0 soup ratio
  const tokens = [...tokenizeSafe(inp.source)];
  let identCount = 0;
  let cryptic = 0;
  for (const t of tokens) {
    if (t.kind !== "identifier") continue;
    identCount++;
    if (/^[lI1O0_]{3,}$/.test(t.text) || /^[A-Za-z]\d{1,4}$/.test(t.text)) cryptic++;
  }
  const crypticRatio = identCount > 0 ? cryptic / identCount : 0;
  readabilityScore += 0.2 * (1 - Math.min(1, crypticRatio * 2));
  if (crypticRatio > 0.5) notes.push(`${Math.round(crypticRatio * 100)}% cryptic identifiers`);
  readabilityScore = clamp01(readabilityScore);

  // recovery: size reduction + string/function presence
  let recoveryScore = 0.3;
  const reduction = inp.inputBytes > 0 ? 1 - base.bytes / inp.inputBytes : 0;
  if (reduction > 0) recoveryScore += Math.min(0.3, reduction);
  else if (reduction < -0.5) {
    recoveryScore -= 0.2; // output much larger than input — suspicious
    notes.push(`output ${Math.round(-reduction * 100)}% larger than input`);
  }
  if (base.functionCount > 0) recoveryScore += 0.15;
  if (base.stringLiterals > 5) recoveryScore += 0.1;
  recoveryScore = clamp01(recoveryScore);

  // v5.9 structural residue metrics — specifically target nested numeric
  // decision trees and opaque temporary aliases common to VM-obfuscated Luau.
  const metrics: DispatcherMetrics = measureDispatcherResidue(inp.source);
  if (metrics.dispatcherResidue < 0.7) notes.push(`numeric dispatcher residue ${(metrics.dispatcherResidue * 100).toFixed(0)}%`);
  if (metrics.aliasResidue < 0.7) notes.push(`opaque alias residue ${(metrics.aliasResidue * 100).toFixed(0)}%`);

  // residual obfuscation
  let residualMarkers = 0;
  for (const t of tokens) {
    if (t.kind === "identifier" && RESIDUAL_IDENT_RE.test(t.text)) residualMarkers++;
  }
  const escapeHeavy = (inp.source.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
  let residualObfuscationScore = 1;
  if (residualMarkers > 0) residualObfuscationScore -= Math.min(0.5, residualMarkers / 200);
  if (escapeHeavy > 100) residualObfuscationScore -= 0.2;
  if (base.longStrings > 3) residualObfuscationScore -= 0.1;
  residualObfuscationScore = clamp01(residualObfuscationScore);
  if (residualMarkers > 50) notes.push(`${residualMarkers} residual VM markers`);

  const score = clamp01(
    syntaxScore * 0.40 + readabilityScore * 0.18 + recoveryScore * 0.18 + residualObfuscationScore * 0.10 +
    metrics.dispatcherResidue * 0.06 + metrics.aliasResidue * 0.03 + metrics.numericStateResidue * 0.03 + metrics.semanticApiRecovery * 0.02
  );
  return { score, syntaxScore, readabilityScore, recoveryScore, residualObfuscationScore,
    dispatcherResidue: metrics.dispatcherResidue, aliasResidue: metrics.aliasResidue,
    numericStateResidue: metrics.numericStateResidue, semanticApiRecovery: metrics.semanticApiRecovery, notes };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function tokenizeSafe(src: string) {
  try {
    return [...tokenize(src)];
  } catch {
    return [] as LuaToken[];
  }
}
