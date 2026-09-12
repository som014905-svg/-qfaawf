// LuaObfuscator.com deobfuscator ("Chaotic Good" / "Chaotic Evil" presets,
// watermarked "Much Love, Ferib" in some builds).
//
// "Chaotic Good" wraps the whole script behind one XOR-keyed string decoder
// plus a light state-machine (control-flow-flattening) wrapper. "Chaotic
// Evil" additionally compiles to a small custom VM: a flat "LOL!"-tagged
// bytecode blob consumed by a `while true do` opcode-dispatch loop that reads
// fields through `v1[1]`, `v1[2]`, `v1[3]`-style positional access, sometimes
// with a `math.ldexp`-based double reader for embedded numeric constants.
//
// Detection signals and the "good"/"evil" family split below mirror the
// structural checks used by axomtools/luaobfuscator-chaoticgood-deobf; the
// recovery pipeline itself reuses this project's own generic passes
// (foldSimpleXorDecoderFunctions, flattenStateDispatchers, recoverControlFlow,
// foldConstants, ...) rather than re-implementing a second parallel engine.
// Everything here is static source-to-source text transformation — no Lua,
// Roblox, or attacker-supplied code is ever executed.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult } from "../types";
import { beautifyLua, bruteForceXorDecode, looksLikeLuaSource, renameObfuscatedIdentifiers } from "../utils/lua-utils";
import { foldConstants } from "../passes/constant-fold";
import {
  foldSimpleXorDecoderFunctions,
  inlineNumericCacheAccessors,
  inlineOffsetTableLookups,
  unwrapLiteralLoadstring,
} from "../passes/static-resolve";
import { flattenStateDispatchers } from "../passes/state-dispatch-flattener";
import { recoverControlFlow } from "../passes/control-flow";
import { validateLuaSource } from "../utils/validate";
import { liftCustomVm } from "../vm/static-opcode-lifter";

type Family = "good" | "evil";

// ---------------------------------------------------------------------------
// Structural signal detection (ported from the reference `det()`)
// ---------------------------------------------------------------------------

function hasWatermark(src: string): boolean {
  return src.includes("LuaObfuscator.com") || /Much Love,\s*Ferib/i.test(src);
}

function hasAlphaVersion(src: string): boolean {
  return /\bAlpha \d\.\d+\.\d+\b/.test(src);
}

/** `return fn1(fn2(), {})`-shaped VM entry wrapper. */
function hasWrapReturn(src: string): boolean {
  return /\breturn\s+[A-Za-z_]\w*\s*\(\s*[A-Za-z_]\w*\s*\(\s*\)\s*,\s*\{\s*\}\s*\)/.test(src);
}

function hasLdexpReader(src: string): boolean {
  return src.includes("math.ldexp") || (src.includes("ldexp") && src.includes("math"));
}

/** `vNN[1]`, with `[2]`/`[3]` nearby — positional opcode-operand unpacking. */
function hasOpcodeUnpack(src: string): boolean {
  const re = /\bv\w*\[1\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const window = src.slice(m.index, m.index + 280);
    if (window.includes("[2]") && window.includes("[3]")) return true;
  }
  return false;
}

/** Three-or-more `vN <= number` comparisons — a linear opcode-range dispatch tree. */
function hasOpcodeTree(src: string): boolean {
  const re = /\bv\d+\s*<=\s*\d+/g;
  let hits = 0;
  while (re.exec(src)) if (++hits >= 3) return true;
  return false;
}

/** `while true do ... vN = vX[vY] ...` with >=2 range comparisons — VM dispatch loop. */
function hasVmDispatchLoop(src: string): boolean {
  let from = 0;
  while (true) {
    const at = src.indexOf("while true do", from);
    if (at < 0) return false;
    const window = src.slice(at, at + 1200);
    const fetch = /\bv\d+\s*=\s*v\w*\[[^\]]+\]/.test(window);
    const cmp = (window.match(/<=/g) || []).length >= 2;
    if (fetch && cmp) return true;
    from = at + 13;
  }
}

function findXorDecoderName(src: string): string | null {
  const re = /\blocal\s+function\s+([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const bodyStart = src.indexOf(")", m.index);
    if (bodyStart < 0) continue;
    const endAt = findMatchingEnd(src, bodyStart + 1);
    if (endAt < 0) continue;
    const body = src.slice(bodyStart + 1, endAt);
    const keyMix = body.includes("% #") || body.includes("%#");
    const xorUse = body.includes("bxor") || keyMix;
    const mod256 = /%\s*\(?\s*256\b/.test(body);
    if (xorUse && (mod256 || (keyMix && (body.includes("char") || body.includes("byte"))))) {
      return m[1];
    }
  }
  return null;
}

function findMatchingEnd(src: string, from: number): number {
  let depth = 1;
  const re = /\b(function|if|for|while|repeat|do|end|until)\b|["'[]/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tok = m[0];
    if (tok === '"' || tok === "'") {
      const q = tok;
      let i = re.lastIndex;
      while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
      re.lastIndex = i + 1;
      continue;
    }
    if (tok === "[") continue;
    if (tok === "function" || tok === "if" || tok === "for" || tok === "while" || tok === "repeat" || tok === "do") depth++;
    else if (tok === "until") depth--;
    else if (tok === "end") {
      depth--;
      if (depth === 0) return m.index;
    }
  }
  return -1;
}

function hasBootstrapAliases(src: string): boolean {
  const anchor = src.indexOf("string.char");
  if (anchor < 0) return false;
  const window = src.slice(anchor, anchor + 600);
  return (
    window.includes("string.byte") &&
    window.includes("string.sub") &&
    (window.includes("bit32") || window.includes(".bxor")) &&
    window.includes("table.concat")
  );
}

/** Finds a `"LOL!..."`-tagged base64-ish bytecode literal, if present. */
function findLolBytecodeLiteral(src: string): { preview: string } | null {
  const at = src.indexOf('"LOL!');
  if (at < 0) return null;
  return { preview: src.slice(at + 1, at + 40) };
}

interface Detection {
  family: Family | null;
  score: number;
  evidence: string[];
}

function detectFamily(src: string): Detection {
  const evidence: string[] = [];
  const watermark = hasWatermark(src);
  const version = hasAlphaVersion(src);
  const wrap = hasWrapReturn(src);
  const ldexp = hasLdexpReader(src);
  const unpack = hasOpcodeUnpack(src);
  const tree = hasOpcodeTree(src);
  const loop = hasVmDispatchLoop(src);
  const lol = findLolBytecodeLiteral(src);
  const xorFn = findXorDecoderName(src);
  const bootstrap = hasBootstrapAliases(src);

  if (watermark) evidence.push("LuaObfuscator.com / Ferib watermark");
  if (version) evidence.push("Alpha x.y.z version banner");
  if (wrap) evidence.push("return fn(fn2(), {}) VM entry wrapper");
  if (ldexp) evidence.push("math.ldexp double-constant reader");
  if (unpack) evidence.push("positional v[1]/v[2]/v[3] opcode operand unpack");
  if (tree) evidence.push("linear vN<=k opcode dispatch tree");
  if (loop) evidence.push("while-true VM dispatch loop");
  if (lol) evidence.push(`LOL!-tagged bytecode literal (${lol.preview}...)`);
  if (xorFn) evidence.push(`XOR string decoder function '${xorFn}'`);
  if (bootstrap) evidence.push("string.char/byte/sub + bxor + table.concat bootstrap");

  const opcodeScore = [unpack, tree, loop, ldexp].filter(Boolean).length;

  let family: Family | null = null;
  if (lol || (wrap && opcodeScore >= 2) || (wrap && ldexp && unpack)) family = "evil";
  else if (ldexp && (tree || loop)) family = "evil";
  else if (bootstrap && !lol && !wrap && !ldexp) family = "good";

  if (!family) return { family: null, score: 0, evidence };

  // Validity gate mirroring the reference's valFam(): require the specific
  // combination of signals that family actually needs, not just one hit.
  if (family === "evil" && !(bootstrap || xorFn || src.includes("bxor"))) {
    return { family: null, score: 0, evidence: [...evidence, "rejected: evil family missing xor bootstrap"] };
  }
  if (family === "good" && ldexp) {
    return { family: null, score: 0, evidence: [...evidence, "rejected: good family has a VM double-reader"] };
  }

  const score = 0.3 * Number(watermark) + 0.15 * Number(version) + 0.55 * (evidence.length >= 3 ? 1 : evidence.length / 3);
  return { family, score: Math.min(0.97, 0.55 + score), evidence };
}

// ---------------------------------------------------------------------------
// Comment / long-bracket-safe watermark stripping
// ---------------------------------------------------------------------------

function stripCommentsAndWatermark(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      const start = i;
      i++;
      while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
      i++;
      out += src.slice(start, i);
      continue;
    }
    if (ch === "[" && (src[i + 1] === "[" || src[i + 1] === "=")) {
      let j = i + 1;
      let eq = 0;
      while (src[j] === "=") { eq++; j++; }
      if (src[j] === "[") {
        const close = "]" + "=".repeat(eq) + "]";
        const at = src.indexOf(close, j + 1);
        const end = at < 0 ? src.length : at + close.length;
        out += src.slice(i, end);
        i = end;
        continue;
      }
    }
    if (ch === "-" && src[i + 1] === "-") {
      if (src[i + 2] === "[") {
        let j = i + 3;
        let eq = 0;
        while (src[j] === "=") { eq++; j++; }
        if (src[j] === "[") {
          const close = "]" + "=".repeat(eq) + "]";
          const at = src.indexOf(close, j + 1);
          i = at < 0 ? src.length : at + close.length;
          continue;
        }
      }
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Outer XOR-wrapper recovery ("Good" preset's single big encrypted blob)
// ---------------------------------------------------------------------------

/** Long single/double-quoted string literals that look like an XOR'd payload (high control-char ratio). */
function findCandidateCipherLiterals(src: string): Array<{ start: number; end: number; raw: string }> {
  const out: Array<{ start: number; end: number; raw: string }> = [];
  const re = /(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = m[2];
    if (body.length < 40) continue;
    let unusual = 0;
    for (let k = 0; k < body.length; k++) {
      const c = body.charCodeAt(k);
      if (c < 9 || (c > 13 && c < 32) || c > 126) unusual++;
    }
    if (unusual / body.length > 0.2) out.push({ start: m.index, end: m.index + m[0].length, raw: body });
  }
  return out;
}

function decodeEscapedLiteral(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\") {
      const d = raw.slice(i + 1, i + 4).match(/^\d{1,3}/);
      if (d) { out += String.fromCharCode(parseInt(d[0], 10) & 0xff); i += d[0].length; continue; }
      const next = raw[i + 1];
      if (next === "n") { out += "\n"; i++; continue; }
      if (next === "t") { out += "\t"; i++; continue; }
      if (next === "r") { out += "\r"; i++; continue; }
      out += next ?? "";
      i++;
      continue;
    }
    out += raw[i];
  }
  return out;
}

function recoverOuterXorWrapper(src: string): { result: string; note?: string } {
  const candidates = findCandidateCipherLiterals(src);
  if (!candidates.length) return { result: src };
  // Largest suspicious literal is almost always the wrapped payload.
  candidates.sort((a, b) => b.raw.length - a.raw.length);
  const target = candidates[0];
  const cipherBytes = decodeEscapedLiteral(target.raw);
  const found = bruteForceXorDecode(cipherBytes, {
    maxKeyLen: 3,
    scorer: (s) => (looksLikeLuaSource(s) ? 0.5 + Math.min(0.5, (s.match(/\b(function|local|return|end)\b/g) || []).length / 20) : 0),
  });
  if (!found || found.score < 0.5) return { result: src };
  const replacement = JSON.stringify(found.decoded).slice(1, -1);
  const result = src.slice(0, target.start) + '"' + replacement + '"' + src.slice(target.end);
  return { result, note: `Recovered outer XOR-wrapped payload (key length ${found.keyBytes.length}, score ${found.score.toFixed(2)}).` };
}

// ---------------------------------------------------------------------------
// Deobfuscator
// ---------------------------------------------------------------------------

export function detectLuaObfuscatorChaotic(input: string): Detection {
  return detectFamily(input);
}

export class LuaObfuscatorChaoticDeobfuscator implements Deobfuscator {
  id = "luaobfuscator_com" as const;
  name = "LuaObfuscator.com (Chaotic Good/Evil)";
  description =
    "Static recovery for LuaObfuscator.com's Chaotic Good (XOR-wrapped + light CFF) and Chaotic Evil " +
    "(custom VM bytecode) presets: banner/structural detection, outer-payload XOR recovery, and the " +
    "project's generic string/control-flow cleanup passes.";

  detect(input: string) {
    const d = detectFamily(input);
    if (!d.family) return null;
    return {
      obfuscator: "luaobfuscator_com" as const,
      confidence: d.score,
      evidence: `${d.family === "good" ? "Chaotic Good" : "Chaotic Evil"}: ${d.evidence.join("; ")}`,
    };
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { log } = ctx;
    const notes: string[] = [];
    const artifacts: string[] = [];
    const detection = detectFamily(ctx.input);
    if (!detection.family) {
      return {
        success: false,
        deobfuscator: this.name,
        output: ctx.input,
        notes: ["LuaObfuscator.com fingerprint did not match (neither Chaotic Good nor Chaotic Evil signals found)."],
        confidence: 0,
        obfuscator: "luaobfuscator_com",
      };
    }
    notes.push(`Detected preset: Chaotic ${detection.family === "good" ? "Good" : "Evil"} (${detection.evidence.join("; ")}).`);

    let work = stripCommentsAndWatermark(ctx.input);
    let confidence = 0.5;

    log("luaobfuscator_com: recovering outer XOR-wrapped payload...");
    const outer = recoverOuterXorWrapper(work);
    work = outer.result;
    if (outer.note) {
      notes.push(outer.note);
      confidence += 0.15;
    }

    log("luaobfuscator_com: folding static XOR string-decoder calls...");
    try {
      const xorFold = foldSimpleXorDecoderFunctions(work);
      if (xorFold.changed) {
        work = xorFold.result;
        notes.push(...xorFold.notes);
        confidence += Math.min(0.1, xorFold.changed * 0.01);
      }
      const loadstr = unwrapLiteralLoadstring(work);
      if (loadstr.changed) {
        work = loadstr.result;
        notes.push(...loadstr.notes);
      }
    } catch (e: unknown) {
      log(`luaobfuscator_com: xor-decoder fold skipped (${e instanceof Error ? e.message : String(e)})`);
    }

    log("luaobfuscator_com: unflattening dispatcher / control flow...");
    try {
      const flattened = flattenStateDispatchers(work);
      if (flattened.changed) {
        work = flattened.result;
        notes.push(...flattened.notes);
        confidence += 0.1;
      }
    } catch (e: unknown) {
      log(`luaobfuscator_com: state-dispatch flatten skipped (${e instanceof Error ? e.message : String(e)})`);
    }
    try {
      const cf = recoverControlFlow(work);
      if (cf.changed) {
        work = cf.result;
        notes.push(...cf.notes);
      }
    } catch (e: unknown) {
      log(`luaobfuscator_com: control-flow recovery skipped (${e instanceof Error ? e.message : String(e)})`);
    }

    try {
      const off = inlineOffsetTableLookups(work);
      if (off.changed) { work = off.result; notes.push(...off.notes); }
      const cache = inlineNumericCacheAccessors(work);
      if (cache.changed) { work = cache.result; notes.push(...cache.notes); }
      const folded = foldConstants(work, 3);
      if (folded.folded) {
        work = folded.result;
        notes.push(`Applied ${folded.folded} constant-fold(s).`);
        confidence += Math.min(0.1, folded.folded / 500);
      }
    } catch (e: unknown) {
      log(`luaobfuscator_com: generic cleanup skipped (${e instanceof Error ? e.message : String(e)})`);
    }

    if (detection.family === "evil") {
      const lol = findLolBytecodeLiteral(ctx.input);
      notes.push(
        "Chaotic Evil custom VM detected; attempting conservative opcode-by-opcode lift. " +
        "Unknown/custom semantics are preserved instead of guessed."
      );
      confidence = Math.min(confidence + 0.08, 0.78);
      if (lol) artifacts.push(`-- LuaObfuscator.com Chaotic Evil bytecode blob preview\\n-- ${lol.preview}...\\n`);
      try {
        const lifted = liftCustomVm(work, "LuaObfuscator Chaotic Evil");
        notes.push(...lifted.notes);
        if (lifted.changed) {
          artifacts.push(lifted.output);
          confidence = Math.min(0.88, confidence + Math.min(0.12, lifted.recovered / 100));
        }
      } catch (e) {
        notes.push(`Chaotic Evil VM lift skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    try {
      const rn = renameObfuscatedIdentifiers(work);
      if (rn.renamed > 0) { work = rn.result; notes.push(`Renamed ${rn.renamed} cryptic identifier(s).`); }
    } catch { /* best-effort */ }

    try {
      work = beautifyLua(work);
    } catch { /* keep unformatted */ }

    const validation = validateLuaSource(work);
    if (validation.ok) confidence += 0.05;

    return {
      success: true,
      deobfuscator: this.name,
      output: work,
      notes,
      confidence: Math.min(0.95, confidence),
      artifacts,
      obfuscator: "luaobfuscator_com",
    };
  }
}
