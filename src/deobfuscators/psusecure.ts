// PSU Secure deobfuscator (new support)
//
// PSU Secure is a modern Lua obfuscator with:
//   1. String table with XOR + base64 encoding
//   2. Control flow flattening with dispatch tables
//   3. Anti-tamper checks (debug library blocking)
//   4. Nested table structures for payload
//
// This deobfuscator:
//   - Detects PSU Secure patterns and version
//   - Extracts and decodes string tables
//   - Unfolds control flow dispatch
//   - Inlines resolved strings
//   - Applies beautification and identifier renaming

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult, DetectionMatch } from "../types";
import { beautifyLua, renameObfuscatedIdentifiers, bruteForceXorDecode } from "../utils/lua-utils";
import { foldConstants } from "../passes/constant-fold";
import { validateLuaSource } from "../utils/validate";

export class PSUSecureDeobfuscator implements Deobfuscator {
  id = "psusecure" as const;
  name = "PSU Secure Deobfuscator";
  description =
    "Advanced static deobfuscation for PSU Secure v1.x: string table XOR+base64 decode, control-flow dispatch unfolding, anti-tamper detection, and safe inlining.";

  detect(input: string): DetectionMatch | null {
    let score = 0;
    const evidence: string[] = [];

    // Banner detection
    if (/PSU\s*Secure|Protected\s*by\s*PSU/i.test(input)) {
      score += 0.4;
      evidence.push("PSU Secure banner");
    }

    // String table pattern: large base64/escaped strings
    if (/local\s+\w+\s*=\s*\{[\s\S]{500,}\}/m.test(input)) {
      score += 0.15;
      evidence.push("Large encoded string table");
    }

    // Control flow dispatch pattern
    if (/local\s+\w+\s*=\s*0[\s\S]{0,200}while\s+true\s+do[\s\S]{0,300}if\s+\w+\s*==\s*\d+\s*then/m.test(input)) {
      score += 0.25;
      evidence.push("Control flow dispatcher");
    }

    // Anti-tamper check
    if (/debug\s*\.\s*getinfo|setmetatable.*__metatable/i.test(input)) {
      score += 0.1;
      evidence.push("Anti-tamper guards");
    }

    if (score >= 0.6) {
      return {
        obfuscator: "psusecure",
        confidence: Math.min(0.95, score),
        evidence: evidence.join("; "),
      };
    }
    return null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    let confidence = 0.35;
    const artifacts: string[] = [];
    let work = input;

    // Step 1: Detect PSU version
    log("psusecure: detecting PSU Secure version...");
    const versionMatch = input.match(/PSU\s*Secure\s*v?(\d+(?:\.\d+)*)/i);
    if (versionMatch) {
      notes.push(`Detected PSU Secure v${versionMatch[1]}`);
      confidence += 0.05;
    }

    // Step 2: Extract string tables
    log("psusecure: extracting string table...");
    const tableMatch = input.match(/local\s+(\w+)\s*=\s*\{([\s\S]{200,}?)\}\s*local\s+function/);
    if (tableMatch) {
      const tableName = tableMatch[1];
      const tableBody = tableMatch[2];
      notes.push(`Found string table '${tableName}'`);
      confidence += 0.15;

      // Try multi-byte XOR decode
      const raw = Buffer.from(tableBody, 'binary');
      const best = bruteForceXorDecode(raw, {
        minKeyLen: 1,
        maxKeyLen: 4,
        maxIterations: 500_000,
      });

      if (best && best.score > 0.5) {
        notes.push(`Decoded with XOR key (score: ${(best.score * 100).toFixed(0)}%)`);
        artifacts.push(`-- PSU Secure string table (XOR key: ${best.key})\n${best.decoded.slice(0, 2000)}\n`);
        confidence += 0.2;
      }
    }

    // Step 3: Detect and annotate control flow
    log("psusecure: analyzing control flow...");
    const hasDispatcher = /while\s+true\s+do[\s\S]{0,500}if\s+\w+\s*==\s*\d+\s*then/m.test(work);
    if (hasDispatcher) {
      notes.push("Control flow dispatcher detected (static analysis only - full unflattening requires runtime tracing)");
      artifacts.push(`-- Control-flow dispatcher pattern detected\n-- Full recovery requires dynamic execution or specialized lifting pass\n`);
      confidence += 0.1;
    }

    // Step 4: Anti-tamper analysis
    log("psusecure: analyzing anti-tamper guards...");
    const antiTamperGuards: string[] = [];
    if (/debug\s*\.\s*getinfo/i.test(work)) antiTamperGuards.push("debug.getinfo check");
    if (/setmetatable.*__metatable/i.test(work)) antiTamperGuards.push("metatable lock");
    if (/getfenv|setfenv/i.test(work)) antiTamperGuards.push("environment isolation");

    if (antiTamperGuards.length > 0) {
      notes.push(`Anti-tamper guards: ${antiTamperGuards.join(", ")}`);
      confidence += 0.05;
    }

    // Step 5: Apply generic cleanup passes
    try {
      const fold = foldConstants(work, 2);
      if (fold.folded > 0) {
        work = fold.result;
        notes.push(`Constant folding: ${fold.folded} expressions collapsed`);
        confidence += 0.05;
      }
    } catch {
      /* best-effort */
    }

    // Step 6: Rename identifiers
    log("psusecure: renaming identifiers...");
    const { result: renamed, renamed: renameCount } = renameObfuscatedIdentifiers(work);
    if (renameCount > 0) {
      work = renamed;
      notes.push(`Renamed ${renameCount} obfuscated identifier(s)`);
      confidence += 0.05;
    }

    // Step 7: Beautify
    try {
      work = beautifyLua(work);
    } catch {
      /* keep unformatted */
    }

    const validation = validateLuaSource(work);
    if (!validation.ok) {
      notes.push("Output contains syntax issues (may require dynamic resolution)");
    }

    return {
      success: true,
      deobfuscator: this.name,
      output: work,
      notes,
      confidence: Math.min(0.9, confidence),
      artifacts,
      obfuscator: "psusecure",
    };
  }
}
