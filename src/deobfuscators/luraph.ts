// Luraph v14.x / v15.x deobfuscator — v2 (payload-first pipeline).
//
// Luraph protects scripts with a staged loader:
//   1. An outer Lua loader (beautifiable, full of arithmetic soup).
//   2. An embedded LPH payload string — prefix varies by version:
//        v14.4  "LPH:"   (raw base85, sometimes with per-sample cipher)
//        v14.7  "LPH}"   (base85 + Zstd compression → inner Lua SOURCE)
//        v14.8  "LPH>"   (base85 → LuaP bytecode with plain constants)
//        v15.0  "LPH+"   (base85 → LuaP bytecode)
//        …plus arbitrary "LPH<sym>" variants emitted between minor versions.
//   3. The payload decoder is a custom base85: 5 ASCII chars (33..117) →
//      little-endian uint32, with a `z` → `!!!!!` gsub padding pass that we
//      detect from the loader source itself.
//
// The v2 pipeline:
//   extract payload (any bracket level / quote style / prefix)
//     → detect z-substitution from the loader
//     → base85-decode (LE uint32 groups)
//     → if Zstd frame magic: zstdDecompressSync → inner source
//     → if inner source contains another LPH payload: recurse (nesting)
//     → route result:
//          source   → constant-fold + beautify → main output (high conf)
//          bytecode → harvest plain string constants → artifact
//   always: fold + beautify the outer loader as a fallback output.
//
// This is still a *heuristic static* recovery — we never execute the loader.

import { zstdDecompressSync } from "node:zlib";
import { Deobfuscator, DeobfuscateContext, DeobfuscateResult, DetectionMatch } from "../types";
import { looksLikeLuaSource, beautifyLua, renameObfuscatedIdentifiers, unescapeStringLiterals, iterStringLiterals, findDecoyStringRanges, firstMatchPreferOutsideDecoys } from "../utils/lua-utils";
import { foldConstants } from "../passes/constant-fold";

interface PayloadHit {
  raw: string; // payload text INCLUDING the LPHxy prefix
  prefix: string; // "LPH}" / "LPH>" / "LPH:" / ...
  start: number;
  end: number;
}

export interface DecodeOutcome {
  kind: "source" | "bytecode" | "binary";
  data: Buffer;
  method: string;
}

export class LuraphDeobfuscator implements Deobfuscator {
  id = "luraph" as const;
  name = "Luraph Deobfuscator";
  description =
    "Payload-first Luraph recovery v2: extracts the LPH payload (any prefix), decodes custom base85, inflates Zstd (v14.7) to recover the embedded source, harvests string constants from LuaP bytecode, and folds + beautifies the loader.";

  detect(input: string): DetectionMatch | null {
    // v4.1: banner patterns are decoy-guarded — `#[[Luraph v13…]]` decoy
    // strings embedded by MoonSec/PSU/SynapseXen no longer trigger us.
    const decoys = findDecoyStringRanges(input);
    const m1 = firstMatchPreferOutsideDecoys(/Luraph\s*Obfuscator\s*v?\d+(?:\.\d+)?/i, input, decoys);
    if (m1.m) {
      const v = m1.m[0].match(/v?(\d+(?:\.\d+)?)/i)?.[1] ?? "?";
      return { obfuscator: "luraph", confidence: 0.95, evidence: `Luraph version banner (v${v})` };
    }
    const m2 = firstMatchPreferOutsideDecoys(/This\s*file\s*was\s*(?:protected|generated)\s*using\s*Luraph/i, input, decoys);
    if (m2.m && !m2.inDecoy) {
      return { obfuscator: "luraph", confidence: 0.95, evidence: "Luraph generated banner" };
    }
    const m3 = firstMatchPreferOutsideDecoys(/\[\[Luraph\b/i, input, decoys);
    if (m3.m && !m3.inDecoy) {
      return { obfuscator: "luraph", confidence: 0.9, evidence: "Luraph banner string" };
    }
    if (/LPH[}>+:$"]/.test(input)) {
      return { obfuscator: "luraph", confidence: 0.9, evidence: `LPH payload prefix (${input.match(/LPH[}>+:$"]/)![0]})` };
    }
    const m5 = firstMatchPreferOutsideDecoys(/lura\.ph/i, input, decoys);
    if (m5.m && !m5.inDecoy) {
      return { obfuscator: "luraph", confidence: 0.85, evidence: "lura.ph URL" };
    }
    return null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    const artifacts: string[] = [];
    let confidence = 0.35;

    // ── Step 1: version banner ────────────────────────────────────────────
    const banner = input.match(/Luraph\s*Obfuscator\s*v?(\d+(?:\.\d+)?)/i);
    if (banner) {
      notes.push(`Detected Luraph v${banner[1]}.`);
      artifacts.push(`-- Luraph version: v${banner[1]}`);
      confidence += 0.05;
    }

    // ── Step 2: detect the z→!!!!! substitution from the loader ──────────
    const usesZSub =
      /gsub\s*\(\s*"?z"?\s*,\s*"!!!!!"/.test(input) ||
      /,\s*"z"\s*,\s*"!!!!!"\s*\)/.test(input) ||
      /K\s*\(\s*\w+\s*,\s*"z"\s*,\s*"!!!!!"\s*\)/.test(input);

    // ── Step 3: extract payloads (all of them, any prefix/bracket) ───────
    log("luraph: locating LPH payload(s)...");
    const hits = extractPayloads(input);
    if (hits.length === 0) {
      notes.push("No LPH payload found — falling back to loader beautification only.");
    }

    let bestDecoded: DecodeOutcome | null = null;
    let bestPayloadInfo = "";

    for (const [i, hit] of hits.entries()) {
      log(`luraph: payload #${i + 1}: ${hit.raw.length} chars, prefix ${JSON.stringify(hit.prefix)}`);
      const outcome = decodePayload(hit, usesZSub);
      if (!outcome) {
        notes.push(`Payload #${i + 1} (${hit.prefix}): base85 decode produced nothing usable.`);
        continue;
      }
      artifacts.push(
        `-- Luraph ${hit.prefix} payload (${hit.raw.length} chars) → ${outcome.data.length} bytes via ${outcome.method}\n` +
        `-- head (hex): ${outcome.data.subarray(0, 24).toString("hex")}\n`
      );

      if (outcome.kind === "source") {
        bestDecoded = outcome;
        bestPayloadInfo = `payload #${i + 1} (${hit.prefix}, ${outcome.method})`;
        break; // source beats bytecode — stop scanning
      }
      if (!bestDecoded || (bestDecoded.kind === "binary" && outcome.kind === "bytecode")) {
        bestDecoded = outcome;
        bestPayloadInfo = `payload #${i + 1} (${hit.prefix}, ${outcome.method})`;
      }
    }

    // ── Step 4: nesting — decoded source may itself hide another payload ─
    if (bestDecoded?.kind === "source") {
      const inner = bestDecoded.data.toString("latin1");
      const innerHits = extractPayloads(inner);
      if (innerHits.length > 0) {
        log(`luraph: inner source contains ${innerHits.length} nested payload(s) — recursing...`);
        notes.push("Recovered inner source contains a nested LPH payload (multi-layer protection).");
        for (const [i, hit] of innerHits.entries()) {
          const innerOutcome = decodePayload(hit, usesZSub);
          if (innerOutcome?.kind === "source") {
            bestDecoded = innerOutcome;
            bestPayloadInfo += ` → nested payload #${i + 1}`;
            break;
          }
        }
      }
    }

    // ── Step 5: route the best outcome ───────────────────────────────────
    let sourceOutput: string | null = null;

    if (bestDecoded && bestDecoded.kind === "source") {
      log(`luraph: recovered embedded SOURCE (${bestDecoded.data.length} bytes via ${bestDecoded.method})`);
      const recoveredSource = bestDecoded.data.toString("latin1");
      sourceOutput = recoveredSource;
      notes.push(`Recovered embedded source: ${bestDecoded.data.length} bytes (${bestPayloadInfo}).`);
      confidence += 0.45;

      // Normalise \101 / \x69 / \z escape soup into readable characters.
      try {
        const un = unescapeStringLiterals(recoveredSource);
        if (un.rewritten > 0) {
          sourceOutput = un.result;
          notes.push(`Normalised escapes in ${un.rewritten} string literal(s) of the recovered source.`);
        }
      } catch {
        /* best-effort */
      }

      // Harvest readable string constants from the recovered source so the
      // user can see the API/identifier surface at a glance.
      try {
        const harvested = harvestStringsFromSource(sourceOutput ?? recoveredSource);
        if (harvested.length > 0) {
          artifacts.push(
            `-- String constants recovered from Luraph payload source (${harvested.length} entries)\n` +
            harvested.map((s) => JSON.stringify(s)).join("\n")
          );
        }
      } catch {
        /* best-effort */
      }

      // Fold the recovered source — inner Luraph VM code is arithmetic soup.
      try {
        const fold = foldConstants(sourceOutput ?? recoveredSource, 3);
        if (fold.folded > 0) {
          sourceOutput = fold.result;
          notes.push(`Constant folding applied ${fold.folded} fold(s) to recovered source.`);
          confidence += 0.05;
        }
      } catch (e) {
        log(`luraph: fold on recovered source failed (${(e as Error).message})`);
      }
    } else if (bestDecoded && (bestDecoded.kind === "bytecode" || bestDecoded.kind === "binary")) {
      const data = bestDecoded.data;
      const head = data.subarray(0, 5).toString("latin1");
      notes.push(`Decoded payload to ${data.length} bytes of ${head === "\x1bLuaP" ? "LuaP bytecode" : "binary data"} (${bestPayloadInfo}).`);
      confidence += 0.2;

      // Harvest plain string constants from the bytecode — LuaP keeps string
      // constants in cleartext inside the serialized stream.
      const harvested = harvestStrings(data);
      if (harvested.length > 0) {
        log(`luraph: harvested ${harvested.length} string constants from bytecode`);
        notes.push(`Harvested ${harvested.length} string constant(s) from the bytecode (see artifacts).`);
        artifacts.push(
          `-- Recovered string constants from LuaP bytecode (${harvested.length} entries)\n` +
          harvested.map((s) => `${JSON.stringify(s)}`).join("\n")
        );
        confidence += 0.15;
      }
      if (head === "\x1bLuaP") {
        notes.push("Bytecode starts with the LuaP magic — confirmed Luraph serialized program.");
        confidence += 0.05;
      }
    }

    // ── Step 6: beautify the outer loader (always, as fallback/context) ──
    log("luraph: beautifying loader...");
    let loaderOutput = input;
    try {
      const { result: renamed, renamed: renameCount } = renameObfuscatedIdentifiers(input);
      if (renameCount > 0) {
        loaderOutput = renamed;
        notes.push(`Renamed ${renameCount} identifier pattern(s) in loader.`);
      }
      const un = unescapeStringLiterals(loaderOutput);
      if (un.rewritten > 0) {
        loaderOutput = un.result;
        notes.push(`Normalised escapes in ${un.rewritten} loader string literal(s).`);
      }
      const fold = foldConstants(loaderOutput, 2);
      if (fold.folded > 0) {
        loaderOutput = fold.result;
        notes.push(`Constant folding applied ${fold.folded} fold(s) to loader.`);
        confidence += 0.05;
      }
      if (loaderOutput.length < 3_000_000) loaderOutput = beautifyLua(loaderOutput);
    } catch (e) {
      log(`luraph: loader beautify failed (${(e as Error).message})`);
    }

    // Prefer recovered source over the beautified loader.
    const output = sourceOutput ?? loaderOutput;
    if (sourceOutput && looksLikeLuaSource(sourceOutput)) {
      confidence = Math.max(confidence, 0.85);
      notes.push("Main output = recovered embedded source (loader kept in artifacts).");
      artifacts.push(`-- ── Beautified outer loader (${loaderOutput.length} chars) ──\n${loaderOutput.slice(0, 400_000)}`);
    } else {
      notes.push("VM layer: see the Luraph VM Structural Decoder results for opcode map, decoded programs and disassembly.");
    }

    return {
      success: true,
      deobfuscator: this.name,
      output,
      notes,
      confidence: Math.min(0.95, confidence),
      artifacts,
      obfuscator: "luraph",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload extraction
// ─────────────────────────────────────────────────────────────────────────────

/** Find every LPH payload in the source. Payloads appear either inside a
 *  long-bracket string ([=[LPH}…]=]) or a normal quoted string ("LPH:…").
 *  The prefix is `LPH` followed by ONE non-alphanumeric char (} > + : $ " …)
 *  and then the base85 body. */
export function extractPayloads(input: string): PayloadHit[] {
  const hits: PayloadHit[] = [];

  // Long-bracket form: [n=[LPH<sym>body]=n]
  const bracketRe = /\[(=*)\[LPH([^A-Za-z0-9\n])/g;
  let m: RegExpExecArray | null;
  while ((m = bracketRe.exec(input)) !== null) {
    const level = m[1].length;
    const closeStr = "]" + "=".repeat(level) + "]";
    const bodyStart = m.index + m[0].length;
    const end = input.indexOf(closeStr, bodyStart);
    if (end > bodyStart) {
      hits.push({
        raw: input.slice(m.index + 2 + level, end),
        prefix: "LPH" + m[2],
        start: m.index,
        end: end + closeStr.length,
      });
    }
  }

  // Quoted form: "LPH<sym>…" — payload runs to the closing quote; escaped
  // quotes inside base85 are rare (alphabet is 33..117, no quotes needed),
  // so scanning to the next unescaped quote is safe enough.
  const quoteRe = /(["'])LPH([^A-Za-z0-9\n"'])/g;
  while ((m = quoteRe.exec(input)) !== null) {
    const quote = m[1];
    const bodyStart = m.index + m[0].length;
    let i = bodyStart;
    while (i < input.length) {
      if (input[i] === "\\") {
        i += 2;
        continue;
      }
      if (input[i] === quote) break;
      i++;
    }
    if (i > bodyStart + 10 && i < input.length) {
      hits.push({
        raw: input.slice(m.index + 1, i),
        prefix: "LPH" + m[2],
        start: m.index,
        end: i + 1,
      });
    }
  }

  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload decoding
// ─────────────────────────────────────────────────────────────────────────────

export function decodePayload(hit: PayloadHit, usesZSub: boolean): DecodeOutcome | null {
  // Strip "LPH" + 1-char marker.
  let body = hit.raw.slice(4).replace(/\s+/g, "");
  if (body.length < 20) return null;

  if (usesZSub) body = body.replace(/z/g, "!!!!!");

  // Base85: 5 chars → LE uint32. Chars outside 33..117 invalidate the group.
  const chunks: Buffer[] = [];
  for (let i = 0; i + 5 <= body.length; i += 5) {
    let q = 0n;
    let valid = true;
    for (let k = 0; k < 5; k++) {
      const c = body.charCodeAt(i + k);
      if (c < 33 || c > 117) {
        valid = false;
        break;
      }
      q += BigInt(c - 33) * 85n ** BigInt(4 - k);
    }
    if (!valid) continue;
    if (q > 0xffffffffn) q &= 0xffffffffn;
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(Number(q));
    chunks.push(buf);
  }
  if (chunks.length === 0) return null;
  let data = Buffer.concat(chunks);

  // Zstd frame magic → decompress.
  if (data.subarray(0, 4).toString("hex") === "28b52ffd") {
    try {
      data = zstdDecompressSync(data);
      return classify(data, "base85+zstd");
    } catch {
      return classify(data, "base85 (zstd failed)");
    }
  }
  return classify(data, "base85");
}

function classify(data: Buffer, method: string): DecodeOutcome {
  const head = data.subarray(0, 512).toString("latin1");
  // Source heuristics: starts like a chunk and contains Lua keywords early.
  const startsLikeSource = /^\s*(local|return|if|for|while|function|--)|\n/.test(head.slice(0, 8));
  const hasKeywords = /\b(function|local|return|then|end)\b/.test(head);
  const printable = printableRatio(data.subarray(0, 2048));
  if (startsLikeSource && hasKeywords && printable > 0.9) {
    return { kind: "source", data, method };
  }
  if (data.subarray(0, 5).toString("latin1") === "\x1bLuaP") {
    return { kind: "bytecode", data, method };
  }
  // Binary with embedded text (constants) still counts as bytecode-ish.
  if (printable > 0.35) return { kind: "bytecode", data, method };
  return { kind: "binary", data, method };
}

function printableRatio(buf: Buffer): number {
  if (buf.length === 0) return 0;
  let ok = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) ok++;
  }
  return ok / buf.length;
}

/** Harvest human-meaningful string constants from serialized bytecode. */
function harvestStrings(data: Buffer): string[] {
  const latin = data.toString("latin1");
  const raw = latin.match(/[\x20-\x7e]{6,}/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    // Needs at least one real word run + not pure numeric/space noise.
    if (!/[A-Za-z]{4}/.test(s)) continue;
    if (/^[\d\s.,]+$/.test(s)) continue;
    // Trim single trailing garbage chars that belong to serialized metadata.
    const cleaned = s.replace(/[\x00-\x1f]+$/, "").trim();
    if (cleaned.length < 6 || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

/** Harvest readable string constants from recovered Lua source. */
function harvestStringsFromSource(src: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let lits: Array<{ value: string }>;
  try {
    lits = [...iterStringLiterals(src)];
  } catch {
    return out;
  }
  for (const lit of lits) {
    const v = lit.value;
    if (v.length < 4 || v.length > 200) continue;
    // keep identifier-like strings, dotted paths, URLs and short phrases
    if (!/^[\x20-\x7e]+$/.test(v)) continue;
    if (!/[A-Za-z]{3}/.test(v) && !/^[A-Za-z_][\w.:/-]+$/.test(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 800) break;
  }
  return out;
}
