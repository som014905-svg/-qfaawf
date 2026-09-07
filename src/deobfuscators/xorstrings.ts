// XOR-String deobfuscator (luaobfuscator.com family + forks)
//
// luaobfuscator.com output shape:
//
//   local v0=string['char'] local v1=string['byte'] local v2=string['sub']
//   local v3=bit32 or bit    local v4=v3['bxor'] ...
//   function v7(v311,v312) local v313={}; for v424=1,#v311 do
//     v6(v313, v0(v4(v1(v2(v311,v424,v424+1)), v1(v2(v312,1+(v424%#v312),2+(v424%#v312))))%256));
//   end return v5(v313); end
//
//   ... then hundreds of calls:  v7("\225\207\218...", "\126\177...")
//
// The decoder is a plain repeating-key XOR: out[i] = s1[i] ^ s2[(i % #s2)+1]
// (obfuscators vary the modular arithmetic, so we brute-force the key phase
// and pick the offset whose result is mostly-printable ASCII).
//
// This deobfuscator:
//   1. Finds candidate decoder functions (body contains bxor + byte/sub + a
//      for-loop + a %256 mask) and records their names.
//   2. Statically evaluates every `name("literal","literal")` call.
//   3. Replaces the calls with the decoded string literals.
//   4. Runs constant folding (the output is full of `33970936 - 21625258`
//      arithmetic soup) + identifier renaming + beautify.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult } from "../types";
import { beautifyLua, renameObfuscatedIdentifiers } from "../utils/lua-utils";
import { foldConstants, encodeLuaString } from "../passes/constant-fold";

interface DecoderCall {
  start: number;
  end: number;
  value: string;
}

function decodeLuaEscapeString(raw: string): string {
  // raw includes the surrounding quotes; handle \NNN, \xNN, \n, \t, \\, \", \'
  const body = raw.slice(1, -1);
  let out = "";
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "\\") {
      const rest = body.slice(i + 1);
      let m: RegExpMatchArray | null;
      if ((m = rest.match(/^(\d{1,3})/))) {
        out += String.fromCharCode(parseInt(m[1], 10) & 0xff);
        i += 1 + m[1].length;
        continue;
      }
      if ((m = rest.match(/^x([0-9a-fA-F]{2})/))) {
        out += String.fromCharCode(parseInt(m[1], 16));
        i += 3;
        continue;
      }
      const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v", "\\": "\\", '"': '"', "'": "'" };
      if (rest[0] in simple) {
        out += simple[rest[0]];
        i += 2;
        continue;
      }
      out += rest[0] ?? "";
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** XOR s1 with repeating key s2, starting the key at phase `phase` (0-based). */
function xorWithPhase(s1: string, s2: string, phase: number): string {
  const kLen = s2.length;
  let out = "";
  for (let i = 0; i < s1.length; i++) {
    out += String.fromCharCode((s1.charCodeAt(i) ^ s2.charCodeAt((i + phase) % kLen)) & 0xff);
  }
  return out;
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

/** Try every key phase, return the best mostly-printable result. */
function decodeBest(s1: string, s2: string): { value: string; ratio: number } {
  let best = { value: xorWithPhase(s1, s2, 0), ratio: -1 };
  if (s2.length === 0) return { value: s1, ratio: 1 };
  for (let phase = 0; phase < s2.length; phase++) {
    const value = xorWithPhase(s1, s2, phase);
    const ratio = printableRatio(value);
    if (ratio > best.ratio) best = { value, ratio };
    if (ratio > 0.98) break; // good enough
  }
  return best;
}

/** Find all `NAME("lit", "lit")` two-string-literal calls, grouped by NAME. */
function findTwoLiteralCalls(
  input: string
): Map<string, Array<{ s1raw: string; s2raw: string; start: number; end: number }>> {
  const map = new Map<string, Array<{ s1raw: string; s2raw: string; start: number; end: number }>>();
  const re = new RegExp(
    `\\b([A-Za-z_][A-Za-z0-9_]*)\\s*\\(\\s*(${STRING_RE.source})\\s*,\\s*(${STRING_RE.source})\\s*\\)`,
    "g"
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const name = m[1];
    const arr = map.get(name) ?? [];
    arr.push({ s1raw: m[2], s2raw: m[3], start: m.index, end: m.index + m[0].length });
    map.set(name, arr);
  }
  return map;
}

/** A decoder name is any identifier whose two-literal calls mostly XOR-decode
 *  to printable ASCII. This is usage-based and self-validating — it works
 *  even when the decoder body is aliased beyond recognition. */
function findDecoderNames(input: string): string[] {
  // v4: size guard — the two-literal regex scan is O(n·k) over the whole
  // source; on multi-MB payloads (rare for this obfuscator family) it burns
  // the entire engine budget in detect() AND deobfuscate().
  if (input.length > 4_000_000) return [];
  const usage = findTwoLiteralCalls(input);
  const names: string[] = [];
  for (const [name, calls] of usage) {
    if (calls.length < 3) continue;
    // Validate on a sample of calls (cap for perf on huge files).
    const sample = calls.slice(0, 50);
    let good = 0;
    for (const c of sample) {
      const s1 = decodeLuaEscapeString(c.s1raw);
      const s2 = decodeLuaEscapeString(c.s2raw);
      if (!s1.length || !s2.length) continue;
      // A real XOR payload is NOT already readable natural text — plain API
      // calls like createPopup("File Error", "message...") are not decoders.
      if (printableRatio(s1) >= 0.95 && /[a-z]{4}/i.test(s1)) continue;
      const { ratio } = decodeBest(s1, s2);
      if (ratio >= 0.9) good++;
    }
    if (good >= Math.max(3, Math.ceil(sample.length * 0.8))) names.push(name);
  }
  return names;
}

const STRING_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/;

export class XorStringsDeobfuscator implements Deobfuscator {
  id = "luaxor" as const;
  name = "XOR-String Evaluator";
  description =
    "Statically evaluates repeating-key XOR string-decrypt calls (luaobfuscator.com style `f(\"...\",\"...\")`), inlines the decoded strings, then folds arithmetic soup + renames + beautifies.";

  detect(input: string) {
    if (input.length > 4_000_000) return null; // v4 size guard
    const names = findDecoderNames(input);
    if (names.length === 0) return null;
    let callCount = 0;
    for (const name of names) {
      const re = new RegExp(`\\b${name}\\s*\\(\\s*${STRING_RE.source}\\s*,\\s*${STRING_RE.source}\\s*\\)`, "g");
      callCount += (input.match(re) || []).length;
    }
    if (callCount >= 3) {
      return {
        obfuscator: "luaxor" as const,
        confidence: Math.min(0.95, 0.6 + callCount * 0.005),
        evidence: `XOR string-decoder ${names.map((n) => `${n}()`).join(", ")} with ${callCount} two-literal call(s)`,
      };
    }
    return null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    let work = input;

    const names = findDecoderNames(input);
    if (names.length === 0) {
      return { success: false, deobfuscator: this.name, output: input, notes: ["decoder function not found"], confidence: 0, obfuscator: "luaxor" };
    }
    log(`luaxor: decoder function(s): ${names.join(", ")}`);

    let totalReplaced = 0;
    let goodReplacements = 0;

    for (const name of names) {
      // Collect edits for this decoder (work mutates between decoders).
      const edits: DecoderCall[] = [];
      const callRe = new RegExp(`\\b${name}\\s*\\(\\s*(${STRING_RE.source})\\s*,\\s*(${STRING_RE.source})\\s*\\)`, "g");
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(work)) !== null) {
        const s1 = decodeLuaEscapeString(m[1]);
        const s2 = decodeLuaEscapeString(m[2]);
        if (!s1.length || !s2.length) continue;
        const { value, ratio } = decodeBest(s1, s2);
        if (ratio < 0.7) continue; // skip garbage decodes
        edits.push({ start: m.index, end: m.index + m[0].length, value });
        if (ratio > 0.9) goodReplacements++;
      }
      // Apply edits right-to-left.
      edits.sort((a, b) => b.start - a.start);
      for (const e of edits) {
        work = work.slice(0, e.start) + encodeLuaString(e.value) + work.slice(e.end);
      }
      totalReplaced += edits.length;
      log(`luaxor: ${name}() → ${edits.length} call(s) inlined`);
    }

    if (totalReplaced === 0) {
      return {
        success: false,
        deobfuscator: this.name,
        output: input,
        notes: ["Decoder found but no two-literal calls could be evaluated."],
        confidence: 0.15,
        obfuscator: "luaxor",
      };
    }

    notes.push(`Statically evaluated ${totalReplaced} XOR string-decrypt call(s) (${goodReplacements} high-confidence).`);

    // Constant folding — luaobfuscator.com buries numbers in arithmetic soup.
    try {
      const fold = foldConstants(work, 3);
      if (fold.folded > 0) {
        work = fold.result;
        notes.push(`Constant folding applied ${fold.folded} fold(s).`);
      }
    } catch (e: unknown) {
      log(`luaxor: fold failed (${e instanceof Error ? e.message : String(e)})`);
    }

    // Rename obfuscated identifiers (v123 soup → readable-ish).
    try {
      const { result: renamed, renamed: count } = renameObfuscatedIdentifiers(work);
      if (count > 0) {
        work = renamed;
        notes.push(`Renamed ${count} obfuscated identifier pattern(s).`);
      }
    } catch (e: unknown) {
      log(`luaxor: rename failed (${e instanceof Error ? e.message : String(e)})`);
    }

    // Beautify with size guard.
    try {
      if (work.length < 3_000_000) work = beautifyLua(work);
    } catch (e: unknown) {
      log(`luaxor: beautify failed (${e instanceof Error ? e.message : String(e)})`);
    }

    const confidence = Math.min(0.95, 0.55 + goodReplacements * 0.01 + (totalReplaced > 100 ? 0.15 : 0));

    return {
      success: true,
      deobfuscator: this.name,
      output: work,
      notes,
      confidence,
      obfuscator: "luaxor",
    };
  }
}
