// Q-Marker VM deobfuscator
//
// Targets a family of custom/private Roblox obfuscators that share:
//   1. A string table `aV` where every entry starts with a marker char
//      (commonly 'Q').
//   2. A 3-layer decoder chain:  pV[ QV( DV(idx), bigKey ) ]
//        - DV(g) = aV[g + OFFSET]   (pure index lookup)
//        - QV(g, C) = XOR-decode string g with a PRNG seeded by C
//        - pV[decoded] = cached lookup table
//   3. A character→value map used by the PRNG (similar to WeAreDevs c-map).
//
// This deobfuscator:
//   - Extracts the aV string table.
//   - Parses the DV offset.
//   - Extracts the char→value map.
//   - For each pV[QV(DV(idx, key))] call in the source, tries to decode
//     the corresponding aV entry. We can't fully reproduce the PRNG without
//     running it, but we CAN resolve DV() statically (it's just an index).
//   - Emits the resolved DV() indices as artifacts so the user can see which
//     aV entries are referenced.
//   - Falls back to generic cleanup + beautify for the rest.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult, DetectionMatch } from "../types";
import { beautifyLua, renameObfuscatedIdentifiers } from "../utils/lua-utils";

export class QMarkerVMDeobfuscator implements Deobfuscator {
  id = "qmarker_vm" as const;
  name = "Q-Marker VM Deobfuscator";
  description = "Recovers the Q-marker string table + DV() index lookups + char-value map for the 3-layer pV[QV(DV())] decoder chain used by private Roblox obfuscators.";

  detect(input: string): DetectionMatch | null {
    // Need at least 2 of: Q-marker table, 3-layer chain, DV(idx, bigKey)
    let score = 0;
    const evidence: string[] = [];
    if (/local\s+\w+\s*=\s*\{"Q[^"]*",\s*"Q[^"]*"/.test(input)) {
      score += 0.4;
      evidence.push("Q-marker string table");
    }
    if (/pV\s*\[\s*\w+V\s*\(\s*\w+V\s*\(/.test(input)) {
      score += 0.45;
      evidence.push("3-layer decoder chain pV[XV(YV(...))]");
    }
    if (/\bDV\s*\(\s*-?\d+\s*,\s*\d{10,}\s*\)/.test(input)) {
      score += 0.4;
      evidence.push("DV(idx, bigKey) decoder pattern");
    }
    if (score >= 0.8) {
      return { obfuscator: "qmarker_vm", confidence: Math.min(0.95, score), evidence: evidence.join(" + ") };
    }
    return null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    let confidence = 0.35;
    const artifacts: string[] = [];

    // Step 1: Extract the aV string table
    log("qmarker_vm: extracting string table...");
    // Find the table by name: local <name> = { "Q...", ... }
    // We locate the opening `local <name> = {` then collect every string
    // literal up to the matching closing `}`.
    let tableName = "";
    const strings: string[] = [];
    const tableStartMatch = input.match(/local\s+(\w+)\s*=\s*\{\s*"(?:\\.|[^"\\])*"/);
    if (tableStartMatch) {
      tableName = tableStartMatch[1];
      const startIdx = tableStartMatch.index! + tableStartMatch[0].length;
      // Walk forward collecting string literals until we hit `}` at the same
      // depth or a `local`/`function` keyword.
      const litRe = /"((?:\\.|[^"\\])*)"/g;
      litRe.lastIndex = tableStartMatch.index!;
      let lm: RegExpExecArray | null;
      let lastEnd = tableStartMatch.index!;
      while ((lm = litRe.exec(input)) !== null) {
        // Stop if we've gone past the table (heuristic: 200+ chars without a string)
        if (lm.index - lastEnd > 500) break;
        strings.push(lm[1]);
        lastEnd = lm.index + lm[0].length;
        // Stop if next non-whitespace is `}` followed by `local` or `function`
        const after = input.slice(lastEnd, lastEnd + 50);
        if (/^\s*\}\s*(local|function|do\b|\bend\b)/.test(after)) break;
        if (strings.length > 10000) break; // safety cap
      }
      notes.push(`Found string table '${tableName}' with ${strings.length} entries.`);
      log(`qmarker_vm: string table has ${strings.length} entries`);
      confidence += 0.15;
    } else {
      notes.push("String table not found in expected form.");
    }

    // Step 2: Parse the DV offset
    // DV is defined as: function DV(g) return aV[g + OFFSET] end
    log("qmarker_vm: parsing DV offset...");
    const dvMatch = input.match(/function\s+DV\s*\(\s*(\w+)\s*\)\s*return\s+\w+\s*\[\s*\1\s*\+\s*(-?\d+)\s*\]/);
    let dvOffset = 0;
    if (dvMatch) {
      dvOffset = parseInt(dvMatch[2], 10);
      notes.push(`DV offset: ${dvOffset} (DV(g) = ${tableName || "aV"}[g + ${dvOffset}]).`);
      confidence += 0.1;
    } else {
      notes.push("DV offset not found — using 0.");
    }

    // Step 3: Extract the char→value map (the big table after DV definition)
    log("qmarker_vm: extracting char-value map...");
    const mapMatch = input.match(/do\s+local\s+g\s*=\s*\{([\s\S]*?)\}\s*local\s+function/);
    let charMap: Record<string, number> = {};
    if (mapMatch) {
      const body = mapMatch[1];
      // Parse entries like: a=29, ["5"]=23, ["+"]=1, d=56
      const entryRe = /(?:\["((?:\\.|[^"\\])*)"\]|([A-Za-z_]\w*))\s*=\s*(-?\d+)/g;
      let em: RegExpExecArray | null;
      let count = 0;
      while ((em = entryRe.exec(body)) !== null) {
        const key = em[1] !== undefined ? em[1] : em[2];
        const val = parseInt(em[3], 10);
        charMap[key] = val;
        count++;
      }
      notes.push(`Extracted char-value map with ${count} entries.`);
      log(`qmarker_vm: char map has ${count} entries`);
      if (count > 0) confidence += 0.1;
    }

    // Step 4: Find all DV(idx, key) calls and resolve the indices
    log("qmarker_vm: resolving DV() index calls...");
    const dvCallRe = /\bDV\s*\(\s*(-?\d+)\s*,\s*(\d+)\s*\)/g;
    const dvCalls: { idx: number; key: string; resolvedIdx: number; entry: string }[] = [];
    let dm2: RegExpExecArray | null;
    while ((dm2 = dvCallRe.exec(input)) !== null) {
      const idx = parseInt(dm2[1], 10);
      const key = dm2[2];
      const resolvedIdx = idx + dvOffset;
      // aV is 1-indexed in Lua, but we use 0-indexed here
      const entry = strings[resolvedIdx - 1] || strings[resolvedIdx] || "(out of range)";
      dvCalls.push({ idx, key, resolvedIdx, entry });
    }
    if (dvCalls.length > 0) {
      notes.push(`Resolved ${dvCalls.length} DV() calls → string indices.`);
      log(`qmarker_vm: resolved ${dvCalls.length} DV calls`);
      confidence += 0.15;

      // Emit the resolved calls as artifacts (first 100)
      const lines = dvCalls.slice(0, 100).map((c) => {
        const entry = c.entry.length > 60 ? c.entry.slice(0, 60) + "..." : c.entry;
        return `DV(${c.idx}, ${c.key}) → aV[${c.resolvedIdx}] = ${JSON.stringify(entry)}`;
      });
      artifacts.push(
        `-- Q-Marker VM: resolved DV() index calls (${dvCalls.length} total, showing first 100)\n` +
        `-- Each call maps to a string in the aV table.\n\n` +
        lines.join("\n") + "\n"
      );
    }

    // Step 5: Emit the raw string table (first 100 entries) as artifact
    if (strings.length > 0) {
      const preview = strings.slice(0, 100).map((s, i) => `aV[${i + 1}] = ${JSON.stringify(s)}`).join("\n");
      artifacts.push(`-- Q-Marker VM string table '${tableName}' (${strings.length} entries, first 100):\n${preview}\n... (truncated)\n`);
    }

    // Step 6: Emit the char-value map as artifact
    if (Object.keys(charMap).length > 0) {
      const mapStr = Object.entries(charMap)
        .sort((a, b) => a[1] - b[1])
        .map(([k, v]) => `  ${JSON.stringify(k).padEnd(6)} = ${v}`)
        .join("\n");
      artifacts.push(`-- Q-Marker VM char-value map (${Object.keys(charMap).length} entries):\n${mapStr}\n`);
    }

    // Step 7: rename + beautify
    log("qmarker_vm: renaming identifiers and beautifying...");
    const { result: renamed, renamed: renameCount } = renameObfuscatedIdentifiers(input);
    const output = beautifyLua(renameCount > 0 ? renamed : input);
    if (renameCount > 0) {
      notes.push(`Renamed ${renameCount} identifier pattern(s).`);
      confidence += 0.05;
    }

    notes.push("Q-Marker VM uses XOR+PRNG decoder (QV) — full string decode requires runtime execution.");
    notes.push("Artifacts include: string table, DV() index resolution, char-value map.");

    return {
      success: true,
      deobfuscator: this.name,
      output,
      notes,
      confidence: Math.min(0.75, confidence),
      artifacts,
      obfuscator: "qmarker_vm",
    };
  }
}
