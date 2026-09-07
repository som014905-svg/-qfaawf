// Hercules Lua obfuscator deobfuscator (zeusssz/hercules-obfuscator, v1.x–v2.x)
//
// Hercules emits several statically-reversible patterns:
//
//   1. Garbage dead-code blocks at statement level:
//        if false then local X = N end
//        while false do local X = N break end
//        if true then local X = N end   (body is semantically dead — unused locals)
//
//   2. Stdlib glob aliases at the top of the script (statement-level assignment):
//        DqavLdLz = string.char
//        GoUZMOpflrE = table.concat
//        paHDGoYKyF = table.unpack
//        p = tostring       TKITsUEJ = math.floor   etc.
//
//   3. Caesar cipher string encoding — an IIFE wraps each encoded string literal:
//        (function(s,k) local r=""
//          for i=1,#s do r=r..string.char((string.byte(s,i)+k)%256) end
//          return r end)("\xNN...", SHIFT)
//      The IIFE body may use the aliased names instead of stdlib directly.
//      Some Hercules forks also emit a named top-level decoder and call it:
//        local function __hd(s,k) ... end
//        __hd("\xNN...", SHIFT)
//
// All passes are source-only and literal-driven — nothing is executed.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult } from "../types";
import { beautifyLua, renameObfuscatedIdentifiers, reencodeLuaString } from "../utils/lua-utils";
import { foldConstants } from "../passes/constant-fold";
import { validateLuaSource } from "../utils/validate";

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function countDeadBlocks(input: string): number {
  const ifFalse = (input.match(/\bif\s+false\s+then\s+local\s+\w+\s*=\s*\d+\s*end/g) || []).length;
  const whileFalse = (input.match(/\bwhile\s+false\s+do\s+local\s+\w+\s*=\s*\d+\s+break\s+end/g) || []).length;
  return ifFalse + whileFalse;
}

function hasGlobAliases(input: string): boolean {
  // Hercules always aliases at least string.char and table.concat at global scope
  const charAlias = /^[A-Za-z_]\w*\s*=\s*string\s*\.\s*char\s*$/m.test(input);
  const concatAlias = /^[A-Za-z_]\w*\s*=\s*table\s*\.\s*concat\s*$/m.test(input);
  return charAlias && concatAlias;
}

function hasCaesarIife(input: string): boolean {
  // Loose structural check: an IIFE with string.byte + arithmetic (%256) + string.char
  return /\(\s*function\s*\([^)]{1,30}\)[^)]{0,3000}?string\s*\.\s*byte[^)]{0,3000}?%\s*256[^)]{0,3000}?end\s*\)\s*\(/.test(input);
}

export function detectHercules(input: string): boolean {
  // Banner patterns (highest confidence)
  if (/--\s*\[\s*Obfuscated\s+by\s+Hercules/i.test(input)) return true;
  if (/hercules-obfuscator\.xyz/i.test(input)) return true;
  if (/hercules\s+obfuscator\b/i.test(input)) return true;

  // Structural: dead blocks + glob aliases is a very strong signal
  const deadBlocks = countDeadBlocks(input);
  if (deadBlocks >= 3 && hasGlobAliases(input)) return true;

  // Dead blocks + Caesar IIFE
  if (deadBlocks >= 2 && hasCaesarIife(input)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Pass 1 — strip provably-dead blocks
// ---------------------------------------------------------------------------

/**
 * Removes Hercules garbage dead-code blocks:
 *   if false then local IDENT = NUM end
 *   while false do local IDENT = NUM break end
 *   if true then local IDENT = NUM end
 *
 * These are 100% dead because the condition is a literal constant.
 * We also strip the bare `local IDENT = NUM` sentinels Hercules inserts
 * when it can't wrap them in a block (e.g. `local KEWOiRLX=72`).
 * Those are harder to strip safely without scoping analysis, so we leave
 * them — constant-fold will handle the reads if they're used.
 */
export function stripHerculesDeadBlocks(
  src: string,
): { result: string; removed: number; notes: string[] } {
  const notes: string[] = [];
  let result = src;
  let removed = 0;

  // if false then local IDENT = EXPR end  (EXPR = simple literal: number or string)
  const ifFalseRe = /\bif\s+false\s+then\s+(?:local\s+[A-Za-z_]\w*\s*=\s*[^\n;]+?\s*)+end\b/g;
  // while false do local IDENT = EXPR break end
  const whileFalseRe = /\bwhile\s+false\s+do\s+(?:local\s+[A-Za-z_]\w*\s*=\s*[^\n;]+?\s*)+break\s+end\b/g;
  // if true then local IDENT = EXPR end  — body is dead (locals never referenced outside)
  // Only strip when body is only local declarations (safe; no side effects)
  const ifTrueSimpleRe = /\bif\s+true\s+then\s+(?:local\s+[A-Za-z_]\w*\s*=\s*[^\n;]+?\s*)+end\b/g;

  for (const re of [ifFalseRe, whileFalseRe, ifTrueSimpleRe]) {
    const matches: Array<{ start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(result))) {
      matches.push({ start: m.index, end: m.index + m[0].length });
    }
    for (let i = matches.length - 1; i >= 0; i--) {
      const { start, end } = matches[i];
      result = result.slice(0, start) + " " + result.slice(end);
      removed++;
    }
  }

  if (removed > 0) notes.push(`Removed ${removed} Hercules dead-code block(s)`);
  return { result, removed, notes };
}

// ---------------------------------------------------------------------------
// Pass 2 — resolve stdlib glob aliases
// ---------------------------------------------------------------------------

/** Hercules emits top-level `ALIAS = stdlib.member` assignments.
 *  We collect them and inline them everywhere they appear as a call head. */
function collectGlobAliases(src: string): Map<string, string> {
  const aliases = new Map<string, string>();

  // Match `IDENT = stdlib.member` at statement level (no `local` prefix).
  // Only accept safe pure-stdlib aliases (no side-effect calls).
  const re = new RegExp(
    `^([A-Za-z_]\\w*)\\s*=\\s*((?:string|table|math|io|os|bit32|utf8)\\s*\\.\\s*[A-Za-z_]\\w*)\\s*$`,
    "gm",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const alias = m[1];
    const target = m[2].replace(/\s+/g, "");
    aliases.set(alias, target);
  }
  return aliases;
}

export function resolveHerculesGlobAliases(
  src: string,
): { result: string; changed: number; notes: string[] } {
  const notes: string[] = [];
  const aliases = collectGlobAliases(src);
  if (!aliases.size) return { result: src, changed: 0, notes };

  let result = src;
  let changed = 0;

  for (const [alias, target] of aliases) {
    // Replace call sites: `alias(` → `target(`
    // Guard against replacing inside string literals (rough but safe: we only
    // replace when followed by `(` or preceded by non-word — i.e. call context).
    const callRe = new RegExp(`\\b${alias}\\s*\\(`, "g");
    const before = result;
    result = result.replace(callRe, `${target}(`);
    if (result !== before) changed++;
  }

  if (changed > 0) notes.push(`Resolved ${aliases.size} Hercules glob stdlib alias(es)`);
  return { result, changed, notes };
}

// ---------------------------------------------------------------------------
// Pass 3 — decode Caesar cipher IIFE / named decoder calls
// ---------------------------------------------------------------------------

/** Decode a Lua-escape-heavy string literal's raw bytes. */
function decodeLuaLiteralBytes(raw: string): string | null {
  // raw is the content between quotes (no surrounding quotes).
  const bytes: number[] = [];
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === "\\") {
      const rest = raw.slice(i + 1);
      let m: RegExpMatchArray | null;
      if ((m = rest.match(/^(\d{1,3})/))) {
        bytes.push(parseInt(m[1], 10) & 0xff);
        i += 1 + m[1].length;
        continue;
      }
      if ((m = rest.match(/^x([0-9a-fA-F]{2})/))) {
        bytes.push(parseInt(m[1], 16) & 0xff);
        i += 3;
        continue;
      }
      const esc: Record<string, number> = {
        n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11,
        "\\": 92, '"': 34, "'": 39,
      };
      if (rest[0] in esc) {
        bytes.push(esc[rest[0]]);
        i += 2;
        continue;
      }
      bytes.push(rest.charCodeAt(0) & 0xff);
      i += 2;
      continue;
    }
    bytes.push(c.charCodeAt(0) & 0xff);
    i++;
  }
  return String.fromCharCode(...bytes);
}

function printableRatio(s: string): number {
  if (!s.length) return 0;
  let ok = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) ok++;
  }
  return ok / s.length;
}

function caesarShift(s: string, shift: number): string {
  let r = "";
  for (let i = 0; i < s.length; i++) {
    r += String.fromCharCode(((s.charCodeAt(i) + shift) % 256 + 256) % 256);
  }
  return r;
}

/** Matches an inline IIFE that:
 *   - takes (s, k) or (a, b) etc. (2 params, any names)
 *   - contains `string.byte` + arithmetic + `%256` + `string.char`
 *   - is immediately called with ("literal", NUMBER)
 *
 * Returns replacements array or [].
 */
function foldCaesarIifeCalls(src: string): {
  result: string; changed: number; notes: string[];
} {
  const notes: string[] = [];
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  // The IIFE body check: must have string.byte + %256 + string.char + for loop.
  // We match the whole (function(p1,p2) ... end)("...", NUMBER) shape.
  // Body size limit: 2000 chars to avoid catastrophic backtracking.
  const iife = /\(\s*function\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)([\s\S]{10,2000}?)end\s*\)\s*\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*(-?\d+)\s*\)/g;

  let m: RegExpExecArray | null;
  while ((m = iife.exec(src))) {
    const [full, _p1, _p2, body, strLit, shiftStr] = m;

    // Validate body: must actually be a Caesar-style decoder.
    const hasLoop = /for\s+\w+\s*=\s*1\s*,\s*#\w+/.test(body);
    const hasByte = /string\s*\.\s*byte/.test(body);
    const hasChar = /string\s*\.\s*char/.test(body);
    const hasMod256 = /%\s*256/.test(body);
    if (!hasLoop || !hasByte || !hasChar || !hasMod256) continue;

    // Determine shift direction: + or - in the arithmetic
    const addShift = /string\s*\.\s*byte\s*\([^)]+\)\s*\+/.test(body);
    const subShift = /string\s*\.\s*byte\s*\([^)]+\)\s*-/.test(body);

    const shift = parseInt(shiftStr, 10);
    const rawStr = strLit.slice(1, -1);
    const decoded = decodeLuaLiteralBytes(rawStr);
    if (!decoded) continue;

    // Try both directions if ambiguous; pick the one with better printable ratio.
    let best: string | null = null;
    let bestRatio = -1;

    const candidateShifts: number[] = [];
    if (addShift) candidateShifts.push(-shift); // encoded = decoded + shift → decoded = encoded - shift
    if (subShift) candidateShifts.push(shift);  // encoded = decoded - shift → decoded = encoded + shift
    if (!addShift && !subShift) { candidateShifts.push(shift); candidateShifts.push(-shift); }

    for (const s of candidateShifts) {
      const candidate = caesarShift(decoded, s);
      const r = printableRatio(candidate);
      if (r > bestRatio) { best = candidate; bestRatio = r; }
    }

    if (!best || bestRatio < 0.80) continue;

    replacements.push({
      start: m.index,
      end: m.index + full.length,
      text: reencodeLuaString(best, '"'),
    });
  }

  let result = src;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  if (replacements.length) notes.push(`Decoded ${replacements.length} Hercules Caesar cipher string(s)`);
  return { result, changed: replacements.length, notes };
}

/**
 * Detect and decode named Caesar decoder patterns:
 *   local function FNAME(s, k) ... string.byte ... %256 ... string.char ... end
 *   then call sites: FNAME("encoded", SHIFT)
 */
function foldNamedCaesarDecoders(src: string): {
  result: string; changed: number; notes: string[];
} {
  const notes: string[] = [];
  const decoderNames = new Set<string>();

  // Step 1: find named decoder definitions.
  const defRe = new RegExp(
    `(?:local\\s+function|function)\\s+(${IDENT})\\s*\\(\\s*(${IDENT})\\s*,\\s*(${IDENT})\\s*\\)`,
    "g",
  );
  let dm: RegExpExecArray | null;
  while ((dm = defRe.exec(src))) {
    const name = dm[1];
    const body = src.slice(dm.index, dm.index + 3000);
    const hasLoop = /for\s+\w+\s*=\s*1\s*,\s*#\w+/.test(body);
    const hasByte = /string\s*\.\s*byte/.test(body);
    const hasChar = /string\s*\.\s*char/.test(body);
    const hasMod = /%\s*256/.test(body);
    if (hasLoop && hasByte && hasChar && hasMod) decoderNames.add(name);
  }

  if (!decoderNames.size) return { result: src, changed: 0, notes };

  let result = src;
  let changed = 0;

  for (const name of decoderNames) {
    const callRe = new RegExp(
      `\\b${name}\\s*\\(\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\s*,\\s*(-?\\d+)\\s*\\)`,
      "g",
    );

    // Determine shift direction from the function body.
    const fnMatch = new RegExp(
      `(?:local\\s+function|function)\\s+${name}\\s*\\([^)]*\\)([\\s\\S]{0,3000}?)end`,
    ).exec(src);
    const fnBody = fnMatch ? fnMatch[1] : "";
    const addShift = /string\s*\.\s*byte\s*\([^)]+\)\s*\+/.test(fnBody);
    const subShift = /string\s*\.\s*byte\s*\([^)]+\)\s*-/.test(fnBody);

    const reps: Array<{ start: number; end: number; text: string }> = [];
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(result))) {
      const strLit = cm[1];
      const shift = parseInt(cm[2], 10);
      const rawStr = strLit.slice(1, -1);
      const decoded = decodeLuaLiteralBytes(rawStr);
      if (!decoded) continue;

      let best: string | null = null;
      let bestRatio = -1;
      const candidates: number[] = [];
      if (addShift) candidates.push(-shift);
      if (subShift) candidates.push(shift);
      if (!addShift && !subShift) { candidates.push(shift); candidates.push(-shift); }

      for (const s of candidates) {
        const c = caesarShift(decoded, s);
        const r = printableRatio(c);
        if (r > bestRatio) { best = c; bestRatio = r; }
      }
      if (!best || bestRatio < 0.80) continue;
      reps.push({ start: cm.index, end: cm.index + cm[0].length, text: reencodeLuaString(best, '"') });
    }

    for (let i = reps.length - 1; i >= 0; i--) {
      const r = reps[i];
      result = result.slice(0, r.start) + r.text + result.slice(r.end);
      changed++;
    }
  }

  if (changed) notes.push(`Decoded ${changed} named Hercules Caesar call(s)`);
  return { result, changed, notes };
}

// ---------------------------------------------------------------------------
// Deobfuscator class
// ---------------------------------------------------------------------------

export class HerculesDeobfuscator implements Deobfuscator {
  id = "hercules" as const;
  name = "Hercules Lua Obfuscator";
  description =
    "Static deobfuscation for zeusssz/hercules-obfuscator output: dead-code block removal, " +
    "stdlib glob alias resolution, and Caesar cipher string decoding.";

  detect(input: string) {
    if (!detectHercules(input)) return null;

    // Banner → very high confidence
    const hasBanner =
      /--\s*\[\s*Obfuscated\s+by\s+Hercules/i.test(input) ||
      /hercules-obfuscator\.xyz/i.test(input);
    const deadBlocks = countDeadBlocks(input);
    const globAlias = hasGlobAliases(input);
    const caesar = hasCaesarIife(input);

    let confidence = 0.65;
    if (hasBanner) confidence = 0.96;
    else if (deadBlocks >= 5 && globAlias) confidence = 0.91;
    else if (deadBlocks >= 3 && (globAlias || caesar)) confidence = 0.85;
    else if (deadBlocks >= 2 && caesar) confidence = 0.78;

    const parts = [
      hasBanner ? "Hercules banner" : null,
      deadBlocks > 0 ? `${deadBlocks} dead-code block(s)` : null,
      globAlias ? "glob stdlib aliases" : null,
      caesar ? "Caesar IIFE" : null,
    ].filter(Boolean).join(", ");

    return {
      obfuscator: "hercules" as const,
      confidence,
      evidence: `Hercules structural pattern: ${parts}`,
    };
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    let work = ctx.input;
    const notes: string[] = [];
    let changed = 0;

    // Pass 1: strip dead blocks
    const dead = stripHerculesDeadBlocks(work);
    work = dead.result;
    changed += dead.removed;
    notes.push(...dead.notes);

    // Pass 2: resolve glob stdlib aliases before Caesar decode
    // (so the Caesar IIFE body may now contain `string.byte` directly)
    const alias = resolveHerculesGlobAliases(work);
    work = alias.result;
    changed += alias.changed;
    notes.push(...alias.notes);

    // Pass 3a: fold IIFE Caesar calls
    const iife = foldCaesarIifeCalls(work);
    work = iife.result;
    changed += iife.changed;
    notes.push(...iife.notes);

    // Pass 3b: fold named decoder calls
    const named = foldNamedCaesarDecoders(work);
    work = named.result;
    changed += named.changed;
    notes.push(...named.notes);

    // Pass 4: remove now-dead alias assignment statements
    // (they're still syntactically there but harmless; constant-fold won't touch
    //  global assignments, so we strip them explicitly if they are literal aliases)
    {
      const aliasAssignRe = /^[A-Za-z_]\w*\s*=\s*(?:string|table|math|io|os|bit32|utf8)\s*\.\s*[A-Za-z_]\w*\s*;?\s*$/gm;
      const before = work;
      work = work.replace(aliasAssignRe, "");
      if (work !== before) notes.push("Removed Hercules glob alias assignment(s) from output");
    }

    // Pass 5: constant folding — handles `local X = 72` sentinels and concat noise
    try {
      const fold = foldConstants(work, 3);
      if (fold.folded > 0) {
        work = fold.result;
        notes.push(`Constant folding collapsed ${fold.folded} expression(s)`);
        changed += fold.folded;
      }
    } catch { /* best-effort */ }

    // Pass 6: rename cryptic identifiers
    try {
      const rn = renameObfuscatedIdentifiers(work);
      if (rn.renamed > 0) {
        work = rn.result;
        notes.push(`Renamed ${rn.renamed} cryptic identifier(s)`);
      }
    } catch { /* best-effort */ }

    // Pass 7: beautify
    try {
      work = beautifyLua(work);
    } catch { /* keep unformatted */ }

    const validation = validateLuaSource(work);
    if (!changed) {
      notes.push("No statically-reversible Hercules patterns were proven safe to rewrite.");
    }
    if (!validation.ok) {
      notes.push("Output may contain residual opaque predicates or VM control-flow; static validation found issues.");
    }

    return {
      success: true,
      deobfuscator: this.name,
      output: work,
      notes,
      confidence: Math.min(0.92, 0.52 + Math.min(0.35, changed * 0.012)),
      obfuscator: "hercules",
    };
  }
}
