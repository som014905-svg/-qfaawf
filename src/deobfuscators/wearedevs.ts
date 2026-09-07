// WeAreDevs deobfuscator (improved).
//
// WeAreDevs wraps scripts with:
//   1. A Z table of octal-escaped strings: local Z={"\081\070...", "\065..."; ...}
//      (entries separated by both ',' and ';').
//   2. A `c` character map: local c={["\056"]=0, q=2, b=25, X=4, ...}
//      Keys are either ["\NNN"] string literals or bare identifiers.
//      Values are arithmetic expressions that evaluate to 0..63.
//   3. A decoder loop that walks each string in Z, looks up each character
//      in `c`, accumulates base-64 values, and every 4 chars converts the
//      24-bit number into 3 bytes via string.char. '=' is padding.
//
// This deobfuscator:
//   - Extracts the Z table (handling ',' and ';' separators + \NNN escapes).
//   - Extracts the `c` character map (parsing both ["\NNN"] and identifier keys,
//     evaluating the arithmetic expressions).
//   - Applies the custom base64 decoding to every Z entry.
//   - Emits the decoded string table as artifacts.
//   - Decodes \NNN escapes in the main source and beautifies.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult, DetectionMatch } from "../types";
import { looksLikeLuaSource, beautifyLua, renameObfuscatedIdentifiers, iterStringLiterals, unescapeStringLiterals, decodeLuaEscapes } from "../utils/lua-utils";

export class WeAreDevsDeobfuscator implements Deobfuscator {
  id = "wearedevs" as const;
  name = "WeAreDevs Deobfuscator";
  description = "Extracts the WeAreDevs Z string table + custom base64 (c-map) decoder, recovers all encoded strings, and decodes \\NNN escapes in the loader.";

  detect(input: string): DetectionMatch | null {
    if (/wearedevs\.net\/obfuscator/i.test(input)) {
      return { obfuscator: "wearedevs", confidence: 0.9, evidence: "WeAreDevs obfuscator URL banner" };
    }
    if (/WeAreDevs\b/i.test(input)) {
      return { obfuscator: "wearedevs", confidence: 0.85, evidence: "WeAreDevs banner" };
    }
    if (/\[\[WeAreDevs\b/i.test(input)) {
      return { obfuscator: "wearedevs", confidence: 0.85, evidence: "WeAreDevs banner string" };
    }
    if (/--\s*WeAreDevs/i.test(input)) {
      return { obfuscator: "wearedevs", confidence: 0.85, evidence: "WeAreDevs comment" };
    }
    if (/getstr|localStr_\w+|string_table|str_table/i.test(input) && /"[^"]{200,}"/.test(input)) {
      return { obfuscator: "wearedevs", confidence: 0.55, evidence: "getstr/localStr pattern + big string literal" };
    }
    return null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    let confidence = 0.35;
    const artifacts: string[] = [];

    // ============ Step 1: Extract the Z table ============
    log("wearedevs: extracting Z string table...");
    // WeAreDevs uses both ',' and ';' as table entry separators.
    // Find: local Z={ "...", "..."; "...", ... }
    const zTableMatch = input.match(/local\s+Z\s*=\s*\{([\s\S]*?)\}\s*local\s+function\s+S/);
    let zEntries: string[] = [];
    if (zTableMatch) {
      // Extract individual string literals from the table body
      const body = zTableMatch[1];
      zEntries = extractStringLiterals(body);
      notes.push(`Found Z table with ${zEntries.length} string entries.`);
      log(`wearedevs: Z table has ${zEntries.length} entries`);
      confidence += 0.15;
    } else {
      // fallback: find any large table of strings
      const genericTableRe = /local\s+(\w+)\s*=\s*\{((?:\s*"(?:\\.|[^"\\])*"\s*[;,]?\s*){10,})\}/;
      const gm = input.match(genericTableRe);
      if (gm) {
        zEntries = extractStringLiterals(gm[2]);
        notes.push(`Found string table with ${zEntries.length} entries (generic match).`);
        confidence += 0.1;
      }
    }

    // ============ Step 2: Extract the c character map ============
    log("wearedevs: extracting custom base64 character map (c table)...");
    const cMap = extractCMap(input);
    if (cMap.size > 0) {
      notes.push(`Extracted custom base64 map with ${cMap.size} entries.`);
      log(`wearedevs: c-map has ${cMap.size} entries`);
      confidence += 0.15;
    } else {
      notes.push("Could not extract the c character map.");
    }

    // ============ Step 3: Decode the Z entries using the c map ============
    let decodedStrings: string[] = [];
    if (zEntries.length > 0 && cMap.size > 0) {
      log("wearedevs: decoding Z table entries via custom base64...");
      decodedStrings = zEntries.map((enc, i) => {
        const decoded = customBase64Decode(enc, cMap);
        return decoded;
      });

      // Emit decoded string table as artifact
      const lines = decodedStrings.map((s, i) => `-- Z[${i + 1}] = ${JSON.stringify(s)}`);
      artifacts.push(
        `-- WeAreDevs decoded string table (${decodedStrings.length} entries)\n` +
        `-- Recovered via custom base64 decoding using the embedded c-map.\n\n` +
        lines.join("\n") + "\n"
      );

      // Count how many decoded strings look like real Lua identifiers/strings
      const goodCount = decodedStrings.filter((s) => s.length > 0 && /^[\x20-\x7e]+$/.test(s)).length;
      notes.push(`Decoded ${goodCount}/${decodedStrings.length} entries as readable strings.`);
      if (goodCount > decodedStrings.length * 0.5) {
        confidence += 0.25;
      } else {
        confidence += 0.1;
      }

      // Show a preview of the first decoded strings
      const preview = decodedStrings.slice(0, 30)
        .map((s, i) => `  [${i + 1}] ${JSON.stringify(s.slice(0, 60))}${s.length > 60 ? "..." : ""}`)
        .join("\n");
      artifacts.push(`-- Decoded string preview (first 30):\n${preview}\n`);
    } else if (zEntries.length > 0) {
      // Even without the c-map, decode the \NNN escapes so we can see the raw encoded strings
      log("wearedevs: decoding \\NNN escapes in Z table entries (no c-map)...");
      decodedStrings = zEntries.map((s) => decodeNNNEscapes(s));
      const preview = decodedStrings.slice(0, 30)
        .map((s, i) => `  [${i + 1}] ${JSON.stringify(s.slice(0, 60))}${s.length > 60 ? "..." : ""}`)
        .join("\n");
      artifacts.push(`-- Z table entries (\\NNN-decoded, still custom-base64-encoded):\n${preview}\n`);
      confidence += 0.1;
    }

    // ============ Step 4: Decode \NNN escapes in the main source ============
    // v4 CRITICAL FIX: v3.6 ran a raw text-level escape decoder over the
    // WHOLE source. Escapes decoding to `"`, `\\` or a newline BROKE the
    // surrounding string literal (e.g. `"\034"` became `"""` — an early
    // quote termination). The lexer-guarded unescapeStringLiterals() only
    // rewrites INSIDE string literals and re-escapes correctly.
    log("wearedevs: decoding \\NNN decimal escapes in source...");
    let output = input;
    try {
      const un = unescapeStringLiterals(input);
      if (un.rewritten > 0) {
        output = un.result;
        notes.push(`Normalised escapes in ${un.rewritten} string literal(s).`);
      }
    } catch {
      /* best-effort */
    }

    // ============ Step 5: Rename + beautify ============
    log("wearedevs: renaming identifiers and beautifying...");
    const { result: renamed, renamed: renameCount } = renameObfuscatedIdentifiers(output);
    output = beautifyLua(renameCount > 0 ? renamed : output);
    if (renameCount > 0) {
      notes.push(`Renamed ${renameCount} identifier pattern(s).`);
      confidence += 0.05;
    }

    // Add a summary comment at the top
    output =
      `-- ============================================\n` +
      `-- WeAreDevs deobfuscation output\n` +
      `-- Original size: ${input.length} bytes\n` +
      `-- Z table entries: ${zEntries.length}\n` +
      `-- c-map entries: ${cMap.size}\n` +
      `-- Decoded strings: ${decodedStrings.length}\n` +
      `-- ============================================\n\n` +
      output;

    notes.push("WeAreDevs VM control-flow is preserved — full unflattening needs a Luau tracer.");
    notes.push("Decoded string table is in the artifacts file.");

    return {
      success: true,
      deobfuscator: this.name,
      output,
      notes,
      confidence: Math.min(0.85, confidence),
      artifacts,
      obfuscator: "wearedevs",
    };
  }
}

/**
 * Extract all string literals from a chunk of Lua source.
 * Handles double-quoted strings with escapes.
 */
function extractStringLiterals(src: string): string[] {
  const results: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    results.push(m[1]);
  }
  return results;
}

/** Decode \NNN / \xNN / standard escapes inside a string BODY (v4: shared
 *  single-pass decoder in lua-utils — the old local copy was replaced). */
function decodeNNNEscapes(s: string): string {
  return decodeLuaEscapes(s);
}

/**
 * Extract the WeAreDevs `c` character map from the source.
 * Format: local c={["\056"]=0, q=2, b=25, X=4, p=198565-198546, ...}
 * Keys: either ["\NNN"] or bare identifiers.
 * Values: arithmetic expressions (evaluated safely).
 */
function extractCMap(src: string): Map<string, number> {
  const map = new Map<string, number>();

  // Find the c table: local c={ ... }
  // Note: WeAreDevs output is a single long line, so we can't rely on \n.
  // We match up to the first } that is followed by `local` (the next statement).
  const cTableMatch = src.match(/local\s+c\s*=\s*\{([\s\S]*?)\}\s*local/);
  if (!cTableMatch) return map;

  const body = cTableMatch[1];

  // Parse entries. Entries are separated by ',' or ';'.
  // Each entry is either:
  //   ["\NNN"]=VALUE    (string key)
  //   identifier=VALUE (bare key)
  const entryRe = /(?:\["((?:\\.|[^"\\])*)"\]|([A-Za-z_]\w*))\s*=\s*([^,;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body)) !== null) {
    const strKey = m[1]; // ["\NNN"] form
    const idKey = m[2];  // bare identifier form
    const valExpr = m[3].trim();

    let key: string;
    if (strKey !== undefined) {
      key = decodeNNNEscapes(strKey);
    } else if (idKey !== undefined) {
      key = idKey;
    } else {
      continue;
    }

    const value = safeEvalArithmetic(valExpr);
    if (value !== null && value >= 0 && value < 64) {
      map.set(key, value);
    }
  }

  return map;
}

/**
 * Safely evaluate a simple arithmetic expression that only contains
 * numbers, +, -, *, /, %, ^, and parentheses. No variables, no function calls.
 */
function safeEvalArithmetic(expr: string): number | null {
  // Only allow: digits, +, -, *, /, %, ^, (, ), spaces, and minus signs
  if (!/^[\d+\-*/%^()\s]+$/.test(expr)) return null;
  try {
    // Lua uses ^ for exponentiation; JS uses **. Replace.
    const jsExpr = expr.replace(/\^/g, "**");
    const result = Function(`"use strict"; return (${jsExpr});`)();
    if (typeof result === "number" && !isNaN(result) && isFinite(result)) {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Custom base64 decoder using the WeAreDevs c-map.
 * Each character maps to a 6-bit value via the c-map.
 * Every 4 characters → 3 bytes (24 bits).
 * '=' is padding (end of string, may produce fewer bytes).
 */
function customBase64Decode(encoded: string, cMap: Map<string, number>): string {
  // First decode \NNN escapes in the encoded string
  const raw = decodeNNNEscapes(encoded);
  if (raw.length === 0) return "";

  let bits = 0;
  let bitCount = 0;
  let out = "";

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "=") {
      // padding — stop
      break;
    }
    const val = cMap.get(ch);
    if (val === undefined) {
      // Unknown character — skip (might be noise)
      continue;
    }
    bits = (bits << 6) | val;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      const byte = (bits >> bitCount) & 0xff;
      out += String.fromCharCode(byte);
    }
  }

  return out;
}
