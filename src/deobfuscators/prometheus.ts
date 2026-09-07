// Prometheus / Prometheus V2 deobfuscator.
//
// Prometheus is a trace-based deobfuscator originally written in Lua. Here we
// run a heuristic recovery pass that targets the same artifacts:
//   - Encrypted string table (`local <x> = "..."` XOR-encoded) — now using
//     multi-byte key brute-force (1..3 bytes + common keys).
//   - `loadstring` payload extraction.
//   - Control-flow wrapper stripping.
//   - String-table reference substitution (so `x[N]` becomes the literal).
//   - Identifier renaming + beautification.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult, DetectionMatch } from "../types";
import {
  tryBase64Decode,
  looksLikeLuaSource,
  beautifyLua,
  renameObfuscatedIdentifiers,
  iterStringLiterals,
  bruteForceXorDecode,
  substituteStringTableRefs,
  decodeLuaEscapes,
} from "../utils/lua-utils";
import { encodeLuaString } from "../passes/constant-fold";

export class PrometheusDeobfuscator implements Deobfuscator {
  id = "prometheus" as const;
  name = "Prometheus Deobfuscator";
  description = "Heuristic recovery for Prometheus-obfuscated scripts: multi-byte XOR string-table decode, loadstring payload extraction, string-table substitution, and beautification.";

  detect(input: string): DetectionMatch | null {
    if (/Prometheus\s*-?\s*V?2\b/i.test(input)) {
      return { obfuscator: "prometheusv2", confidence: 0.85, evidence: "Prometheus V2 banner" };
    }
    if (/Prometheus\s*-?\s*Deobfuscator\b/i.test(input)) {
      return { obfuscator: "prometheus", confidence: 0.85, evidence: "Prometheus banner" };
    }
    if (/\[\[Prometheus\b/i.test(input)) {
      return { obfuscator: "prometheus", confidence: 0.8, evidence: "Prometheus banner string" };
    }
    if (/--\s*Prometheus\b/i.test(input)) {
      return { obfuscator: "prometheus", confidence: 0.8, evidence: "Prometheus comment" };
    }
    // v4.1: banner-less Prometheus output — decimal-escaped string table
    // directly after the `return(function(...)` wrapper prologue.
    if (/return\s*\(function\s*\(\.\.\.\)\s*local\s+\w+\s*=\s*\{["']\\\d{3}/.test(input)) {
      return { obfuscator: "prometheus", confidence: 0.75, evidence: "Prometheus decimal-escaped string table layout" };
    }
    return null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    let confidence = 0.4;
    const artifacts: string[] = [];
    let work = input;

    // Step 1: locate the encrypted string table
    log("prometheus: locating string table...");
    const strRe = /local\s+(\w+)\s*=\s*"((?:\\.|[^"\\])*)"|local\s+(\w+)\s*=\s*\[\[([\s\S]*?)\]\]/g;
    let bestEnc = "";
    let bestName = "";
    let bestLen = 0;
    let m: RegExpExecArray | null;
    while ((m = strRe.exec(input)) !== null) {
      const val = m[2] ?? m[4] ?? "";
      if (val.length > bestLen) {
        bestLen = val.length;
        bestEnc = val;
        bestName = m[1] ?? m[3] ?? "";
      }
    }
    if (bestEnc) {
      log(`prometheus: candidate string table '${bestName}' (${bestEnc.length} chars), trying decoders...`);
      const raw = decodeEscapes(bestEnc);
      // multi-byte XOR brute-force
      const best = bruteForceXorDecode(raw, {
        minKeyLen: 1,
        maxKeyLen: 3,
        maxIterations: 200_000,
      });
      const bestDec = best?.decoded ?? "";
      const bestScore = best?.score ?? -1;
      if (best && bestScore > 0.4) {
        const keyLabel = displayKey(best.key);
        artifacts.push(`-- Prometheus string table (XOR key=${keyLabel}, score ${(bestScore * 100).toFixed(0)}%)\nlocal prometheus_strings = ${encodeLuaString(bestDec.slice(0, 4000))}${bestDec.length > 4000 ? " .. ..." : ""}\n`);
        notes.push(`Decoded string table with XOR key=${keyLabel}.`);
        confidence += 0.25;
        // Substitute `bestName[N]` references back into the source.
        // v4 fix: the substitution result was computed but never applied —
        // the feature silently did nothing in v3.6.
        if (bestName && bestDec) {
          let entries = bestDec.split("\n").map((s) => s.replace(/\r$/, ""));
          if (entries.length < 4) entries = [];
          if (entries.length > 0) {
            log(`prometheus: substituting ${entries.length} decoded strings back into source...`);
            const sub = substituteStringTableRefs(work, bestName, entries);
            if (sub.substituted > 0) {
              work = sub.result;
              notes.push(`Substituted ${sub.substituted} ${bestName}[N] reference(s) with decoded literals.`);
              confidence += 0.1;
            }
          }
        }
      } else {
        notes.push("String table located but no confident XOR key found (multi-byte space exhausted).");
      }
    } else {
      notes.push("No large string table located.");
    }

    // Step 2: extract loadstring payload
    log("prometheus: extracting loadstring payload...");
    const literals = [...iterStringLiterals(input)];
    let payloadFound = 0;
    for (const lit of literals) {
      if (lit.value.length > 200) {
        const dec = tryBase64Decode(lit.value);
        if (dec && looksLikeLuaSource(dec)) {
          artifacts.push(`-- Prometheus loadstring payload (${dec.length} bytes)\n${dec.slice(0, 6000)}${dec.length > 6000 ? "\n-- ..." : ""}\n`);
          payloadFound++;
          confidence += 0.15;
          if (payloadFound >= 3) break;
        }
      }
    }
    if (payloadFound > 0) {
      notes.push(`Extracted ${payloadFound} loadstring payload(s).`);
    }

    // Step 3: rename + beautify (v4: operate on `work`, which now includes
    // the substituted string-table references)
    const { result: renamed, renamed: renameCount } = renameObfuscatedIdentifiers(work);
    const output = beautifyLua(renameCount > 0 ? renamed : work);
    if (renameCount > 0) {
      notes.push(`Renamed ${renameCount} identifier pattern(s).`);
      confidence += 0.05;
    }

    notes.push("Prometheus control-flow recovery is partial — full unflattening needs the Lua tracer.");

    return {
      success: true,
      deobfuscator: this.name,
      output,
      notes,
      confidence: Math.min(0.85, confidence),
      artifacts,
      obfuscator: "prometheus",
    };
  }
}

function displayKey(k: string): string {
  if (/^[\x20-\x7e]+$/.test(k)) return JSON.stringify(k);
  return "0x" + Array.from(Buffer.from(k, "binary")).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeEscapes(s: string): string {
  // v4: single-pass decoder (sequential replace chains mis-decode `\\` + `x41`)
  return decodeLuaEscapes(s);
}

