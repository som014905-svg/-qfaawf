// MoonVeil deobfuscator (heuristic, JS-based).
//
// MoonVeil is a newer Luau obfuscator (v1.4.x) that uses a custom VM and
// encrypted string constants. Like Luraph, full devirtualisation requires
// a Luau runtime sandbox. Here we:
//   - Detect the version banner.
//   - Extract the bytecode / opcode tables.
//   - Extract embedded source strings.
//   - Beautify and rename identifiers.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult, DetectionMatch } from "../types";
import { iterStringLiterals, looksLikeLuaSource, beautifyLua, renameObfuscatedIdentifiers } from "../utils/lua-utils";

export class MoonVeilDeobfuscator implements Deobfuscator {
  id = "moonveil" as const;
  name = "MoonVeil Deobfuscator";
  description = "Heuristic recovery for MoonVeil v1.4.x: extracts bytecode, embedded strings, and beautifies the loader. (Full devirtualisation needs luau-vmp-deobf.)";

  detect(input: string): DetectionMatch | null {
    if (/MoonVeil\s*v?1\./i.test(input)) {
      return { obfuscator: "moonveil", confidence: 0.95, evidence: "MoonVeil version banner" };
    }
    if (/\[\[MoonVeil\b/i.test(input)) {
      return { obfuscator: "moonveil", confidence: 0.9, evidence: "MoonVeil banner string" };
    }
    if (/--\s*MoonVeil/i.test(input)) {
      return { obfuscator: "moonveil", confidence: 0.85, evidence: "MoonVeil comment" };
    }
    if (/\bMoonVeil\b/i.test(input)) {
      return { obfuscator: "moonveil", confidence: 0.7, evidence: "MoonVeil token" };
    }
    return null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    let confidence = 0.35;
    const artifacts: string[] = [];

    const banner = input.match(/MoonVeil\s*v?(\d+(?:\.\d+)?)/i);
    if (banner) {
      notes.push(`Detected MoonVeil v${banner[1]}.`);
      artifacts.push(`-- MoonVeil version: v${banner[1]}\n`);
      confidence += 0.05;
    }

    // bytecode / opcode table
    log("moonveil: locating bytecode table...");
    const tableRe = /local\s+(\w+)\s*=\s*\{\s*([0-9xXa-fA-F, \n\r\t]{200,})\s*\}/g;
    let bestTable = "";
    let bestName = "";
    let bestLen = 0;
    let m: RegExpExecArray | null;
    while ((m = tableRe.exec(input)) !== null) {
      if (m[2].length > bestLen) {
        bestLen = m[2].length;
        bestName = m[1];
        bestTable = m[2];
      }
    }
    if (bestTable) {
      const ints = bestTable.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      notes.push(`Found bytecode table '${bestName}' (${ints.length} entries).`);
      artifacts.push(`-- MoonVeil bytecode table '${bestName}' (${ints.length} entries)\nlocal moonveil_bytecode = { ${ints.slice(0, 200).join(", ")}${ints.length > 200 ? ", ..." : ""} }\n`);
      confidence += 0.15;
    }

    // embedded source strings
    log("moonveil: scanning for embedded source strings...");
    const literals = [...iterStringLiterals(input)];
    let srcFound = 0;
    for (const lit of literals) {
      if (lit.value.length > 40 && looksLikeLuaSource(lit.value) && /\b(function|local|return|if|for|while)\b/.test(lit.value)) {
        artifacts.push(`-- Embedded source string (${lit.value.length} bytes)\n${lit.value}\n`);
        srcFound++;
      }
    }
    if (srcFound > 0) {
      notes.push(`Extracted ${srcFound} embedded source string(s).`);
      confidence += 0.2;
    }

    // rename + beautify
    log("moonveil: renaming identifiers and beautifying...");
    const { result: renamed, renamed: renameCount } = renameObfuscatedIdentifiers(input);
    const output = beautifyLua(renameCount > 0 ? renamed : input);
    if (renameCount > 0) {
      notes.push(`Renamed ${renameCount} identifier pattern(s).`);
      confidence += 0.05;
    }

    notes.push("Full MoonVeil VM devirtualisation requires luau-vmp-deobf (Python).");

    return {
      success: true,
      deobfuscator: this.name,
      output,
      notes,
      confidence: Math.min(0.7, confidence),
      artifacts,
      obfuscator: "moonveil",
    };
  }
}
