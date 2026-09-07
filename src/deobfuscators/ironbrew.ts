// IronBrew2 deobfuscator.
//
// IronBrew2 produces a VM-based obfuscated Lua script. The classic layout is:
//   1. A large string-table (encoded with a per-character XOR against a key
//      derived from the script) — `local stringTable = "..."`.
//   2. A `vm_<x>` table mapping opcode numbers to handler functions.
//   3. A big dispatch loop that walks a bytecode array and calls handlers.
//
// This deobfuscator focuses on the recoverable parts:
//   - Detect the string-table constant.
//   - Recover the original strings via multi-byte XOR brute-force
//     (1..3 byte keys + a list of common multi-byte keys).
//   - Map the vm_ table to a readable opcode list.
//   - Substitute `tableVar[N]` references back into the source with the
//     decoded literal so the recovered strings appear inline.
//   - Emit the recovered strings + a beautified, partially-decoded script.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult, DetectionMatch } from "../types";
import {
  beautifyLua,
  bruteForceXorDecode,
  substituteStringTableRefs,
  decodeLuaEscapes,
} from "../utils/lua-utils";
import { encodeLuaString } from "../passes/constant-fold";

export class IronBrewDeobfuscator implements Deobfuscator {
  id = "ironbrew" as const;
  name = "IronBrew2 Deobfuscator";
  description = "Recovers the XOR-encoded IronBrew2 string table (multi-byte key brute-force) and emits a beautified, partially-devirtualised script with string-table references substituted back into the source.";

  detect(input: string): DetectionMatch | null {
    if (/IronBrew2?\b/i.test(input)) {
      return {
        obfuscator: "ironbrew",
        confidence: 0.9,
        evidence: "IronBrew banner detected",
      };
    }
    if (/--\s*Obfuscated\s*by\s*IronBrew/i.test(input)) {
      return { obfuscator: "ironbrew", confidence: 0.9, evidence: "IronBrew obfuscation comment" };
    }
    // v4.1: banner-less IronBrew2 output — the gsub byte-table VM header:
    //   local function M(i)local e,n,t="","",{}local a=256;
    if (/local function \w+\(\w+\)local \w+,\w+,\w+="","",\{\}local \w+=256/.test(input)) {
      return { obfuscator: "ironbrew", confidence: 0.85, evidence: "IronBrew2 byte-table VM header" };
    }
    // heuristic: vm_ table + bit32 helper + big string literal
    const hasVmTable = /vm_\w*\s*=\s*\{/.test(input);
    const hasBigString = /"[^"]{300,}"/.test(input) || /\[\[[^\]]{300,}\]\]/.test(input);
    const hasBit = /\bbit(?:32)?\b/.test(input);
    if (hasVmTable && hasBigString && hasBit) {
      return { obfuscator: "ironbrew", confidence: 0.65, evidence: "vm_ table + large string + bit helper (IronBrew-like layout)" };
    }
    return null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    let confidence = 0.4;
    const artifacts: string[] = [];

    // Step 1: locate the string-table assignment. IronBrew / AztupBrew uses
    // either `local h = "..."` (double-quoted) or `local h = n('...')` /
    // `local h = decode('...')` (single-quoted, wrapped in a decoder call).
    log("ironbrew: locating string table...");
    const strTableRe = /local\s+(\w+)\s*=\s*(?:n\(|decode\()?"((?:\\.|[^"\\])*)"/g;
    let tableVar = "";
    let tableEnc = "";
    let bestLen = 0;
    let m: RegExpExecArray | null;
    while ((m = strTableRe.exec(input)) !== null) {
      if (m[2].length > bestLen) {
        bestLen = m[2].length;
        tableVar = m[1];
        tableEnc = m[2];
      }
    }
    // Also try single-quoted strings (AztupBrew uses these)
    const strTableRe2 = /local\s+(\w+)\s*=\s*(?:n\(|decode\()?'([^']{100,})'/g;
    while ((m = strTableRe2.exec(input)) !== null) {
      if (m[2].length > bestLen) {
        bestLen = m[2].length;
        tableVar = m[1];
        tableEnc = m[2];
      }
    }
    if (!tableVar) {
      notes.push("Could not locate the IronBrew string table.");
      return { success: false, deobfuscator: this.name, output: input, notes, confidence: 0.1, obfuscator: "ironbrew" };
    }
    notes.push(`Found string table '${tableVar}' (${bestLen} encoded chars).`);

    // Step 2: decode the escape sequences into raw bytes
    const raw = decodeEscapes(tableEnc);

    // Step 3: multi-byte XOR brute-force (1..3 byte keys + common strings).
    log("ironbrew: brute-forcing XOR key (1-3 byte + common keys) over string table...");
    const best = bruteForceXorDecode(raw, {
      minKeyLen: 1,
      maxKeyLen: 3,
      maxIterations: 200_000,
    });
    const bestDecoded = best?.decoded ?? "";
    const bestKey: string | null = best ? best.key : null;
    const bestScore = best?.score ?? -1;

    if (bestKey !== null && bestScore > 0.4) {
      const keyLabel = displayKey(bestKey);
      notes.push(`Decoded string table with key=${keyLabel} (score ${(bestScore * 100).toFixed(0)}%).`);
      artifacts.push(`-- Recovered IronBrew2 string table (key=${keyLabel})\nlocal recovered_strings = ${encodeLuaString(bestDecoded.slice(0, 4000))}${bestDecoded.length > 4000 ? " .. ..." : ""}\n`);
      confidence += 0.25;
    } else {
      notes.push("Could not confidently XOR-decode the string table (key space exhausted).");
    }

    // Step 3b: if the decoded string table looks like newline-separated
    // strings (IronBrew's classic layout), split it into individual entries
    // so we can substitute `table[N]` references back into the source.
    let decodedEntries: string[] = [];
    if (bestDecoded) {
      decodedEntries = bestDecoded.split("\n").map((s) => s.replace(/\r$/, ""));
      // Only use the entries if there are enough of them to look like a real table.
      if (decodedEntries.length < 4) decodedEntries = [];
    }

    // Step 4: extract the vm_ opcode handler table as a readable list
    log("ironbrew: extracting vm_ opcode table...");
    // IronBrew output is often a single long line, so split on both \n and
    // the closing-brace-followed-by-local pattern.
    const vmRe = /vm_\w*\s*=\s*\{([\s\S]*?)\}\s*(?:--|local|return|\n\s*\n)/;
    const vmMatch = input.match(vmRe);
    if (vmMatch) {
      const handlers = vmMatch[1]
        .split(/\n|,\s*/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      artifacts.push("-- vm_ opcode handler table\n" + handlers.map((h, i) => `op[${i}] = ${h}`).join("\n") + "\n");
      notes.push(`Extracted ${handlers.length} vm_ opcode handlers.`);
      confidence += 0.1;
    } else {
      notes.push("vm_ opcode table not found in the expected form.");
    }

    // Step 5: emit beautified source. If we decoded the string table
    // confidently, also substitute `tableVar[N]` references back into the
    // source so the recovered literals appear inline.
    let output = input;
    if (bestScore > 0.4 && bestDecoded) {
      output = output.replace(
        new RegExp(`(local\\s+${escapeRe(tableVar)}\\s*=\\s*)"((?:\\\\.|[^"\\\\])*)"`),
        `$1-- decoded below\n$1 = ${encodeLuaString(bestDecoded.slice(0, 4000))}${bestDecoded.length > 4000 ? " .. ..." : ""}`
      );
      if (decodedEntries.length > 0) {
        log(`ironbrew: substituting ${decodedEntries.length} decoded strings back into source...`);
        const sub = substituteStringTableRefs(output, tableVar, decodedEntries);
        if (sub.substituted > 0) {
          output = sub.result;
          notes.push(`Substituted ${sub.substituted} ${tableVar}[N] reference(s) with decoded literals.`);
          confidence += 0.1;
        }
      }
    }
    output = beautifyLua(output);

    notes.push("IronBrew VM devirtualisation is partial — opcode semantics require runtime tracing for a full recovery.");

    return {
      success: true,
      deobfuscator: this.name,
      output,
      notes,
      confidence: Math.min(0.88, confidence),
      artifacts,
      obfuscator: "ironbrew",
    };
  }
}

function displayKey(k: string): string {
  // Render printable keys as JSON, non-printable as hex bytes.
  if (/^[\x20-\x7e]+$/.test(k)) return JSON.stringify(k);
  return "0x" + Array.from(Buffer.from(k, "binary")).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeEscapes(s: string): string {
  // v4: single-pass decoder — sequential replace chains mis-decode `\\` + `x41`.
  return decodeLuaEscapes(s);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
