// AstroProtect deobfuscator (v2.x)
//
// AstroProtect (seen protecting Roblox "Muscle Legends"/"Lifting" hub scripts)
// wraps the payload in a pure-Lua loader:
//
//   1. A long base64 payload string (`local n = "tL0J..."`).
//   2. A pure-Lua base64 decoder (`s*64+x`, `math.floor(s/m[r])%256`).
//   3. A pure-Lua DEFLATE (RFC 1951) inflator — the giveaway is the classic
//      code-length order table {16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15}
//      plus stored-block handling (`B[D]+B[D+1]*256`).
//   4. The inflated bytes are either Luau source or Luau bytecode handed to
//      `loadstring`.
//
// Because the compression is *standard* raw DEFLATE, we can recover the payload
// entirely in JavaScript: base64-decode the payload literal, then run Node's
// zlib.inflateRawSync. If the inflated bytes look like source we return them
// (optionally folding + beautifying); if they look like Luau/Lua 5.1 bytecode
// we return them as an artifact with an honest note.

import { inflateRawSync, inflateSync } from "node:zlib";
import { Deobfuscator, DeobfuscateContext, DeobfuscateResult } from "../types";
import { beautifyLua, looksLikeLuaSource } from "../utils/lua-utils";
import { foldConstants } from "../passes/constant-fold";

/** Lua/Luau bytecode magics. */
const LUA_MAGIC = 0x1b; // ESC — Lua 5.1 bytecode ("\x1bLua")
const LUAU_MAGIC = 0xcc; // Luau bytecode ("\xCC..." — old) / RS = newer
const RSB_MAGIC = 0x52; // 'R' — Luau "RSB" bytecode

function isProbablyBytecode(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  const b0 = buf[0];
  if (b0 === LUA_MAGIC) return true;
  if (b0 === LUAU_MAGIC) return true;
  if (b0 === RSB_MAGIC && buf[1] === 0x53 && buf[2] === 0x42) return true; // "RSB"
  return false;
}

function printableRatio(buf: Buffer): number {
  if (buf.length === 0) return 0;
  let printable = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
  }
  return printable / buf.length;
}

/** Find the longest base64-alphabet string literal in the source. */
function findBase64Payload(input: string): { value: string; start: number; end: number } | null {
  let best: { value: string; start: number; end: number } | null = null;
  const re = /"([A-Za-z0-9+/=]{400,})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (!best || m[1].length > best.value.length) {
      best = { value: m[1], start: m.index, end: m.index + m[0].length };
    }
  }
  return best;
}

function base64ToBuffer(s: string): Buffer {
  // Strip padding/whitespace noise; ignore '='.
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  return Buffer.from(clean, "base64");
}

export class AstroProtectDeobfuscator implements Deobfuscator {
  id = "astrotect" as const;
  name = "AstroProtect";
  description =
    "Recovers AstroProtect-protected scripts: extracts the base64 payload literal, inflates the raw-DEFLATE stream (zlib), and returns the embedded source / bytecode.";

  detect(input: string) {
    // Banner: "--[[ AstroProtect 2.1.0 ]]" or the DMCA notice mention.
    if (/AstroProtect\s*v?\d+(\.\d+)*/i.test(input) || /AstroProtect/i.test(input)) {
      return {
        obfuscator: "astrotect" as const,
        confidence: 0.95,
        evidence: `AstroProtect banner (matched: ${(input.match(/AstroProtect[^\n]{0,30}/i) || [""])[0]})`,
      };
    }
    // Structural fallback: loadstring-or-load + long base64 + deflate order table.
    const hasLoad = /loadstring\s+or\s+load/.test(input);
    const hasOrderTable = /\{\s*16\s*,\s*17\s*,\s*18\s*,\s*0\s*,\s*8\s*,\s*7\s*,\s*9\s*,\s*6\s*,\s*10\s*,\s*5\s*,\s*11\s*,\s*4\s*,\s*12\s*,\s*3\s*,\s*13\s*,\s*2\s*,\s*14\s*,\s*1\s*,\s*15\s*\}/.test(
      input
    );
    if (hasLoad && hasOrderTable) {
      return {
        obfuscator: "astrotect" as const,
        confidence: 0.75,
        evidence: "loadstring loader + DEFLATE code-length order table (AstroProtect-style)",
      };
    }
    return null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];

    log("astrotect: locating base64 payload literal...");
    const payload = findBase64Payload(input);
    if (!payload) {
      return {
        success: false,
        deobfuscator: this.name,
        output: input,
        notes: ["No long base64 payload literal found — not an AstroProtect build?"],
        confidence: 0,
        obfuscator: "astrotect",
      };
    }
    log(`astrotect: payload literal = ${payload.value.length} chars`);

    const compressed = base64ToBuffer(payload.value);
    log(`astrotect: base64-decoded ${compressed.length} bytes`);

    // Try raw deflate first (AstroProtect uses raw blocks), then zlib-wrapped.
    let inflated: Buffer | null = null;
    let method = "";
    for (const [name, buf] of [
      ["inflateRaw", compressed],
      ["inflate", compressed],
      ["inflateRaw(skip 2)", compressed.subarray(2)],
    ] as Array<[string, Buffer]>) {
      try {
        inflated = name === "inflate" ? inflateSync(buf) : inflateRawSync(buf);
        method = name;
        break;
      } catch {
        /* try next */
      }
    }
    if (!inflated || inflated.length === 0) {
      return {
        success: false,
        deobfuscator: this.name,
        output: input,
        notes: ["Base64 payload found but DEFLATE inflation failed (non-standard stream)."],
        confidence: 0.2,
        obfuscator: "astrotect",
      };
    }
    log(`astrotect: ${method} → ${inflated.length} bytes (printable ${(printableRatio(inflated) * 100).toFixed(1)}%)`);

    if (isProbablyBytecode(inflated)) {
      // Recovered bytecode — honest artifact, no fake devirtualisation.
      notes.push(`Recovered ${inflated.length} bytes of embedded Luau/Lua bytecode (compressed payload).`);
      notes.push("Bytecode needs a Luau decompiler (e.g. unluau) for source-level recovery.");
      return {
        success: true,
        deobfuscator: this.name,
        output: `-- AstroProtect: recovered embedded bytecode (${inflated.length} bytes)\n-- magic: 0x${inflated[0].toString(16)}\n` +
          `-- Use a Luau decompiler to continue.\n`,
        artifacts: [hexDumpArtifact(inflated)],
        notes,
        confidence: 0.55,
        obfuscator: "astrotect",
      };
    }

    // Source path: decode as text, fold, beautify.
    let source = inflated.toString("latin1");
    const ratio = printableRatio(inflated);
    if (ratio < 0.85) {
      notes.push(`Inflated payload is only ${(ratio * 100).toFixed(1)}% printable — returning raw artifact.`);
      return {
        success: true,
        deobfuscator: this.name,
        output: `-- AstroProtect: inflated payload (${inflated.length} bytes, ${(ratio * 100).toFixed(1)}% printable)\n`,
        artifacts: [hexDumpArtifact(inflated)],
        notes,
        confidence: 0.4,
        obfuscator: "astrotect",
      };
    }

    notes.push(`Decompressed payload: ${inflated.length} bytes of Luau source (via ${method}).`);
    notes.push("Inner layer may itself be VM-obfuscated — see output.");

    // Constant-fold the recovered source (it usually contains arithmetic soup).
    try {
      const fold = foldConstants(source, 2);
      if (fold.folded > 0) {
        source = fold.result;
        notes.push(`Constant folding applied ${fold.folded} fold(s) to recovered source.`);
      }
    } catch (e: unknown) {
      log(`astrotect: fold failed (${e instanceof Error ? e.message : String(e)})`);
    }

    // Beautify with a size guard.
    try {
      if (source.length < 3_000_000) source = beautifyLua(source);
    } catch (e: unknown) {
      log(`astrotect: beautify failed (${e instanceof Error ? e.message : String(e)})`);
    }

    // Confidence scales with how source-like the payload is.
    let confidence = 0.75;
    if (looksLikeLuaSource(source)) confidence = 0.9;
    if (source.length > input.length * 0.5) confidence = Math.min(0.95, confidence + 0.05);

    return {
      success: true,
      deobfuscator: this.name,
      output: source,
      artifacts: [`-- AstroProtect payload (${inflated.length} bytes inflated, ${method})`],
      notes,
      confidence,
      obfuscator: "astrotect",
    };
  }
}

function hexDumpArtifact(buf: Buffer): string {
  const lines: string[] = [`-- bytecode artifact: ${buf.length} bytes`];
  for (let i = 0; i < Math.min(buf.length, 4096); i += 16) {
    const slice = buf.subarray(i, i + 16);
    const hex = [...slice].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...slice].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${i.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  |${ascii}|`);
  }
  if (buf.length > 4096) lines.push(`-- ... ${buf.length - 4096} more bytes (truncated)`);
  return lines.join("\n");
}
