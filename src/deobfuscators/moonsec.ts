// MoonSec deobfuscator.
//
// MoonSec V1/V2:
//   - V2 embeds the program in a VM: `_msec = (function(p1, p2, p3) ...VM...
//     end); _msec({STRING_TABLE}, {[N]=getfenv}, getfenv())`. The string
//     table entries are built from `\ddd` escapes + IIFE and/or tricks
//     (e.g. `'\115\116'..(function(_) return (_ and 'A') or 'B' end)(cond)..'x'`).
//     This deobfuscator statically evaluates the tables and INLINES every
//     `pN[const]` reference back to its concrete value, then rebuilds the
//     invocation with a clean, readable table.
//   - V1 embeds the program as base64/XOR blobs loaded via `loadstring`.
//
// All variants get identifier renaming, constant-noise folding and
// beautification.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult, DetectionMatch } from "../types";
import {
  tryBase64Decode,
  xorDecode,
  looksLikeLuaSource,
  beautifyLua,
  renameObfuscatedIdentifiers,
  bruteForceXorDecode,
  tokenize,
  type LuaToken,
} from "../utils/lua-utils";
import {
  evalExprFromTokens,
  nextSignificant,
  constToLua,
  type ConstValue,
} from "../utils/const-eval";
import { foldConstEvalNoise, encodeLuaString } from "../passes/constant-fold";

interface VmTableEval {
  /** integer key → evaluated value */
  map: Map<number, ConstValue>;
  /** token index of `{` and matching `}` */
  openIdx: number;
  closeIdx: number;
  evaluated: number;
  failed: number;
}

export class MoonSecDeobfuscator implements Deobfuscator {
  id = "moonsec" as const;
  name = "MoonSec Deobfuscator";
  description = "Evaluates MoonSec V2 VM string tables and inlines every constant reference, decodes V1/V3 payloads, renames identifiers and beautifies output.";

  detect(input: string): DetectionMatch | null {
    if (/Protected_by_MoonSecV?\d?/i.test(input)) {
      return { obfuscator: "moonsec", confidence: 0.95, evidence: "MoonSec V2 protection global" };
    }
    if (/MoonSec(?:V\d)?\b/i.test(input)) {
      return { obfuscator: "moonsec", confidence: 0.9, evidence: "MoonSec banner detected" };
    }
    if (/--\s*MoonSec/i.test(input)) {
      return { obfuscator: "moonsec", confidence: 0.85, evidence: "MoonSec comment" };
    }
    return null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    let confidence = 0.4;
    const artifacts: string[] = [];
    let work = input;

    // ------------------------------------------------------------------
    // NEW: MoonSec V2 VM — evaluate the constant tables passed to the VM
    // closure and inline every `pN[const]` reference in the VM body.
    // ------------------------------------------------------------------
    const v2 = this.inlineV2Tables(input, log);
    if (v2) {
      work = v2.output;
      confidence = Math.max(confidence, v2.confidence);
      notes.push(
        `MoonSec V2 VM: đã giải mã ${v2.totalEntries} mục bảng hằng số, inline ${v2.inlinedRefs} tham chiếu trong thân VM.`
      );
      // artifact: the decoded string table (largest map)
      const biggest = v2.maps.reduce((a, b) => (b.size > (a?.size ?? 0) ? b : a), v2.maps[0]);
      if (biggest) {
        const decoded = [...biggest.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([k, v]) => `  [${k}] = ${constToLua(v) ?? "<không hiển thị được>"}`)
          .join("\n");
        artifacts.push(
          `-- MoonSec V2 string table đã giải mã (${biggest.size} mục):\n{\n${decoded}\n}\n`
        );
      }
    } else {
      // ---------------------------------------------------------------
      // Legacy pipeline for V1 / V3 payloads
      // ---------------------------------------------------------------
      log("moonsec: extracting payload...");
      let payload = "";

      // Pattern (b): MoonSec V3 — payload is a long-bracket string passed to :gsub
      const gsubMatch = input.match(/\(\[\[([\s\S]{200,}?)\]\]\)\s*:gsub\(/);
      if (gsubMatch) {
        payload = gsubMatch[1];
        notes.push("Detected MoonSec V3 payload pattern: `([[...]]):gsub('.+', ...)`");
        confidence += 0.2;
      }

      // Pattern (a): classic loadstring("...")
      if (!payload) {
        const loadstrRe = /loadstring\s*\(\s*(?:decode|decompile|decrypt)?\s*\(?["']([A-Za-z0-9+/=_\-\s]{200,})["']\)?\s*\)?/g;
        let m: RegExpExecArray | null;
        while ((m = loadstrRe.exec(input)) !== null) {
          if (m[1].length > payload.length) payload = m[1];
        }
      }

      // Fallback: any huge string literal
      if (!payload) {
        const huge = (input.match(/"[A-Za-z0-9+/=_\-\s]{200,}"/) || [])[0];
        if (huge) payload = huge.slice(1, -1);
      }

      if (payload) {
        log(`moonsec: payload found (${payload.length} chars), attempting base64 decode...`);
        const decoded = tryBase64Decode(payload);
        if (decoded && looksLikeLuaSource(decoded)) {
          artifacts.push(
            `-- MoonSec loadstring payload (base64-decoded, ${decoded.length} bytes)\n${decoded.slice(0, 6000)}${decoded.length > 6000 ? "\n-- ... truncated" : ""}\n`
          );
          notes.push(`Decoded MoonSec loadstring payload (${decoded.length} bytes).`);
          confidence += 0.3;
        } else {
          log("moonsec: base64 failed — trying multi-byte XOR brute-force on payload...");
          const best = bruteForceXorDecode(payload, {
            minKeyLen: 1,
            maxKeyLen: 3,
            maxIterations: 200_000,
          });
          if (best && best.score > 0.4 && looksLikeLuaSource(best.decoded)) {
            const keyLabel =
              best.key && /^[\x20-\x7e]+$/.test(best.key)
                ? JSON.stringify(best.key)
                : "0x" + best.keyBytes.map((b) => b.toString(16).padStart(2, "0")).join("");
            artifacts.push(
              `-- MoonSec payload (XOR key=${keyLabel}, score ${(best.score * 100).toFixed(0)}%)\n${best.decoded.slice(0, 6000)}\n`
            );
            notes.push(`Decoded payload via multi-byte XOR key ${keyLabel}.`);
            confidence += 0.25;
          } else {
            notes.push("Payload not decodable via base64 or multi-byte XOR.");
          }
        }
      } else {
        notes.push("No single loadstring payload located.");
      }

      // MoonSec V3: decode the \NNN escape sequences in each long string and
      // emit them as artifacts.
      const longStrRe = /"((?:\\.|[^"\\]){100,})"/g;
      const allLongStrings: { value: string }[] = [];
      let lm: RegExpExecArray | null;
      while ((lm = longStrRe.exec(input)) !== null) {
        allLongStrings.push({ value: lm[1] });
      }
      if (allLongStrings.length > 0 && !v2) {
        log(`moonsec: decoding ${allLongStrings.length} long string literals (V3 pattern)...`);
        const decodedArtifacts: string[] = [];
        let decodedCount = 0;
        for (const ls of allLongStrings.slice(0, 40)) {
          let decoded = "";
          let i = 0;
          while (i < ls.value.length) {
            if (ls.value[i] === "\\") {
              const digits = ls.value.slice(i + 1).match(/^\d{1,3}/);
              if (digits) {
                const code = parseInt(digits[0], 10);
                if (code >= 0 && code <= 255) {
                  decoded += String.fromCharCode(code);
                  i += 1 + digits[0].length;
                  continue;
                }
              }
              const hex = ls.value.slice(i + 1).match(/^x([0-9a-fA-F]{2})/);
              if (hex) {
                decoded += String.fromCharCode(parseInt(hex[1], 16));
                i += 4;
                continue;
              }
              const next = ls.value[i + 1];
              if (next === "n") { decoded += "\n"; i += 2; continue; }
              if (next === "t") { decoded += "\t"; i += 2; continue; }
              if (next === "r") { decoded += "\r"; i += 2; continue; }
              if (next === '"') { decoded += '"'; i += 2; continue; }
              if (next === "\\") { decoded += "\\"; i += 2; continue; }
              decoded += ls.value[i];
              i++;
            } else {
              decoded += ls.value[i];
              i++;
            }
          }
          if (decoded.length > 0) {
            decodedArtifacts.push(
              `-- Long string (${ls.value.length} raw → ${decoded.length} decoded bytes):\n${decoded.slice(0, 2000)}${decoded.length > 2000 ? "\n-- ... truncated" : ""}\n`
            );
            decodedCount++;
          }
        }
        if (decodedCount > 0) {
          artifacts.push(
            `-- MoonSec V3 decoded string constants (${decodedCount} strings):\n\n` + decodedArtifacts.join("\n")
          );
          notes.push(`Decoded ${decodedCount} long string literal(s) — likely VM bytecode + constants.`);
          confidence += 0.2;
        }
      }

      // Resolve `decode("HEX", key)` calls inline.
      // v4: (a) Lua-safe re-encoding instead of JSON.stringify (`\uXXXX`
      // escapes are invalid Lua); (b) decoder-name heuristic tightened — the
      // old `ss?` alternative also matched a single-letter `s(...)` call and
      // rewrote arbitrary legit calls; (c) only accept mostly-printable
      // results (a wrong key yields byte soup).
      let resolved = 0;
      const decodeRe = /\b([A-Za-z_]\w*)\s*\(\s*"((?:\\.|[^"\\])*)"\s*,\s*(0x[0-9a-fA-F]+|\d+)\s*\)/g;
      work = work.replace(decodeRe, (full, fn: string, payloadStr: string, keyStr: string) => {
        if (!/^(decode|dec|decrypt|decomp|decompress|getstr|decstr|unxor)_?\d*$/i.test(fn)) return full;
        const key = keyStr.startsWith("0x") ? parseInt(keyStr, 16) : parseInt(keyStr, 10);
        if (!Number.isFinite(key)) return full;
        const raw = decodeHex(payloadStr);
        const dec = xorDecode(raw, key & 0xff);
        let printable = 0;
        for (let i = 0; i < dec.length; i++) {
          const c = dec.charCodeAt(i);
          if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
        }
        if (dec.length > 0 && printable / dec.length > 0.9) {
          resolved++;
          return encodeLuaString(dec);
        }
        return full;
      });
      if (resolved > 0) {
        notes.push(`Resolved ${resolved} MoonSec decode(...) call(s).`);
        confidence += 0.15;
      }
    }

    // ------------------------------------------------------------------
    // Constant-noise folding: `(-#"msg"+803)` → 798, `#{1,{},','}` → 3,
    // IIFE and/or string-building tricks → concrete strings.
    // ------------------------------------------------------------------
    try {
      const folded = foldConstEvalNoise(work);
      if (folded.folded > 0) {
        work = folded.result;
        notes.push(`Constant-noise fold: ${folded.folded} biểu thức.`);
        confidence = Math.min(0.9, confidence + 0.05);
      }
    } catch {
      /* best-effort */
    }

    // Rename obfuscated identifiers
    log("moonsec: renaming identifiers...");
    const { result: renamed, renamed: renameCount } = renameObfuscatedIdentifiers(work);
    if (renameCount > 0) {
      work = renamed;
      notes.push(`Renamed ${renameCount} identifier pattern(s).`);
      confidence = Math.min(0.9, confidence + 0.03);
    }

    // Beautify
    work = beautifyLua(work);

    return {
      success: true,
      deobfuscator: this.name,
      output: work,
      notes,
      confidence: Math.min(0.88, confidence),
      artifacts,
      obfuscator: "moonsec",
    };
  }

  // ---------------------------------------------------------------------
  // MoonSec V2 VM table evaluation + reference inlining
  // ---------------------------------------------------------------------

  /**
   * Find `NAME = (function(p1, p2, ...) ... end)` plus its invocation
   * `NAME({...}, {...}, ...)`; evaluate the table arguments and inline
   * every `pN[const]` reference inside the VM body.
   */
  private inlineV2Tables(
    input: string,
    log: (m: string) => void
  ): {
    output: string;
    maps: [Map<number, ConstValue>, ...Map<number, ConstValue>[]];
    totalEntries: number;
    inlinedRefs: number;
    confidence: number;
  } | null {
    if (input.length > 12_000_000) return null; // memory guard

    // v4.1 PERF: one scan collecting every `NAME({` invocation position.
    // The old code sliced `input` and built a fresh RegExp per candidate
    // assignment — O(N²) on VM files with thousands of closures (moonsec-v2:
    // 9.2s → milliseconds).
    const invokeLastPos = new Map<string, number>();
    const invRe = /(?<![\w.])([A-Za-z_]\w*)\s*\(\s*\{/g;
    let im: RegExpExecArray | null;
    while ((im = invRe.exec(input)) !== null) {
      invokeLastPos.set(im[1], im.index); // last occurrence wins
    }

    // 1) find the assignment: NAME = (function(params)
    // v4.1 PERF: `([A-Za-z_]\w*)\s*=\s*\(\s*function` backtracks
    // catastrophically in JSC on dense minified Lua (179KB file → 9.3s).
    // Instead, locate the cheap `=(function(` anchor and scan the name
    // backwards by hand.
    const assignRe = /=\s*\(\s*function\s*\(([^)]{0,200})\)/g;
    let m: RegExpExecArray | null;
    let chosen: { name: string; params: string[]; assignEnd: number } | null = null;

    const candidates: Array<{ name: string; params: string[]; assignEnd: number }> = [];
    while ((m = assignRe.exec(input)) !== null) {
      // identifier ending right before the `=` (allowing whitespace)
      let e = m.index;
      while (e > 0 && /\s/.test(input[e - 1])) e--;
      let s = e;
      while (s > 0 && /\w/.test(input[s - 1])) s--;
      if (s === e) continue; // no identifier directly before `=`
      if (!/[A-Za-z_]/.test(input[s])) continue; // must start with letter/_
      const name = input.slice(s, e);
      const params = m[1]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (params.length < 2 || params.length > 6) continue;
      // invocation must exist AFTER this assignment: NAME({
      const ip = invokeLastPos.get(name);
      if (ip !== undefined && ip > m.index + m[0].length) {
        candidates.push({ name, params, assignEnd: m.index + m[0].length });
      }
    }
    // pick the LAST candidate (the VM invocation sits near the end of file)
    chosen = candidates[candidates.length - 1];
    if (!chosen) return null;

    log(`moonsec V2: found VM closure ${chosen.name}(${chosen.params.join(", ")})`);

    // 2) tokenize once
    let toks: LuaToken[];
    try {
      toks = [...tokenize(input)];
    } catch {
      return null;
    }

    // token index of the first token of the VM body
    const bodyStartTok = firstTokenAtOrAfter(toks, chosen.assignEnd);
    if (bodyStartTok < 0) return null;

    // 3) find the invocation token index: identifier `name` followed by ( {
    let invokeTok = -1;
    for (let i = toks.length - 1; i >= 0; i--) {
      const t = toks[i];
      if (t.kind === "identifier" && t.text === chosen.name) {
        const p = nextSignificant(toks, i + 1);
        const b = p >= 0 ? nextSignificant(toks, p + 1) : -1;
        if (p >= 0 && toks[p].text === "(" && b >= 0 && toks[b].text === "{") {
          invokeTok = i;
          break;
        }
      }
    }
    if (invokeTok < 0 || invokeTok <= bodyStartTok) return null;

    // 4) parse the invocation args (only table constructors)
    const openParen = nextSignificant(toks, invokeTok + 1);
    const maps: Array<Map<number, ConstValue>> = [];
    const tableSpans: Array<{ openIdx: number; closeIdx: number; paramIdx: number; failedSpans: Array<[number, number]> }> = [];
    let cursor = nextSignificant(toks, openParen + 1);
    let paramIdx = 0;
    let totalEntries = 0;
    while (cursor >= 0 && paramIdx < chosen.params.length) {
      const t = toks[cursor];
      if (t.text === "{") {
        const ev = this.evalTableEntries(toks, cursor);
        if (ev && ev.map.size >= 5) {
          maps[paramIdx] = ev.map;
          tableSpans.push({ openIdx: cursor, closeIdx: ev.closeIdx, paramIdx, failedSpans: ev.failedSpans });
          totalEntries += ev.map.size;
        }
        // advance past this table
        const after = ev ? nextSignificant(toks, ev.closeIdx + 1) : -1;
        if (ev && after >= 0 && toks[after].text === ",") {
          cursor = nextSignificant(toks, after + 1);
          paramIdx++;
          continue;
        }
        break;
      }
      break;
    }
    if (maps.length === 0 || totalEntries < 10) return null;

    log(
      `moonsec V2: evaluated ${tableSpans.length} table(s), ${totalEntries} entries total`
    );

    // 5) inline pN[const] references in the VM body region
    type Edit = { start: number; end: number; replacement: string };
    const edits: Edit[] = [];
    let inlinedRefs = 0;

    for (let i = bodyStartTok; i < invokeTok; i++) {
      const t = toks[i];
      if (t.kind !== "identifier") continue;
      const pIdx = chosen.params.indexOf(t.text);
      if (pIdx < 0) continue;
      const map = maps[pIdx];
      if (!map) continue;
      const br = nextSignificant(toks, i + 1);
      if (br < 0 || toks[br].text !== "[") continue;
      const ev = evalExprFromTokens(toks, br + 1);
      if (!ev) continue;
      const close = nextSignificant(toks, ev.endIndex);
      if (close < 0 || toks[close].text !== "]") continue;
      if (ev.value.k !== "number" || !Number.isInteger(ev.value.v)) continue;
      const val = map.get(ev.value.v);
      if (val === undefined) continue;
      const lit = constToLua(val);
      if (lit === null) continue;
      edits.push({ start: t.start, end: toks[close].end, replacement: lit });
      inlinedRefs++;
      i = close; // skip past the inlined reference
    }

    // 6) rebuild the tables as readable literals
    for (const span of tableSpans) {
      const map = maps[span.paramIdx];
      const openTok = toks[span.openIdx];
      const closeTok = toks[span.closeIdx];
      const lines: string[] = [];
      for (const k of [...map.keys()].sort((a, b) => a - b)) {
        const lit = constToLua(map.get(k)!);
        if (lit !== null) lines.push(`  [${k}] = ${lit},`);
      }
      if (lines.length === 0) continue;
      let rebuilt = "{\n" + lines.join("\n") + "\n}";
      // keep raw text of entries that failed evaluation
      if (span.failedSpans.length > 0) {
        const rawParts = span.failedSpans.map(
          ([s, e]) => input.slice(s, e).replace(/\s+/g, " ").trim()
        );
        rebuilt +=
          " --[[ các mục không eval được, giữ nguyên:\n" +
          rawParts.map((r) => "-- " + r.slice(0, 200)).join("\n") +
          "\n]]";
      }
      edits.push({ start: openTok.start, end: closeTok.end, replacement: rebuilt });
    }

    if (inlinedRefs === 0 && edits.length === 0) return null;

    // 7) apply edits (sorted by start, descending so indices stay valid)
    edits.sort((a, b) => b.start - a.start);
    let out = input;
    for (const e of edits) {
      out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    }

    const confidence = Math.min(0.87, 0.6 + Math.min(0.25, inlinedRefs / 400));
    return { output: out, maps: maps as [Map<number, ConstValue>, ...Map<number, ConstValue>[]], totalEntries, inlinedRefs, confidence };
  }

  /**
   * Evaluate `{[key]=value, ...}` table constructor entries starting at
   * `openIdx` (the `{` token). Returns per-entry results and the closing
   * `}` token index. Entries that fail evaluation keep their raw span.
   */
  private evalTableEntries(
    toks: LuaToken[],
    openIdx: number
  ): { map: Map<number, ConstValue>; closeIdx: number; failedSpans: Array<[number, number]> } | null {
    const map = new Map<number, ConstValue>();
    const failedSpans: Array<[number, number]> = [];
    let i = nextSignificant(toks, openIdx + 1);
    let closeIdx = -1;
    let guard = 0;

    while (i >= 0 && guard++ < 200_000) {
      const t = toks[i];
      if (t.kind === "eof") return null;
      if (t.text === "}") {
        closeIdx = i;
        break;
      }
      if (t.text === "," || t.text === ";") {
        i = nextSignificant(toks, i + 1);
        continue;
      }
      // `[key] = value` entry
      if (t.text === "[") {
        const keyEv = evalExprFromTokens(toks, i + 1);
        const afterKey = keyEv ? nextSignificant(toks, keyEv.endIndex) : -1;
        const eq =
          afterKey >= 0 && toks[afterKey].text === "]"
            ? nextSignificant(toks, afterKey + 1)
            : -1;
        if (keyEv && afterKey >= 0 && toks[afterKey].text === "]" && eq >= 0 && toks[eq].text === "=") {
          const valEv = evalExprFromTokens(toks, eq + 1);
          const afterVal = valEv ? nextSignificant(toks, valEv.endIndex) : -1;
          if (
            valEv &&
            afterVal >= 0 &&
            (toks[afterVal].text === "," || toks[afterVal].text === ";" || toks[afterVal].text === "}")
          ) {
            if (keyEv.value.k === "number" && Number.isInteger(keyEv.value.v)) {
              map.set(keyEv.value.v, valEv.value);
            } else {
              failedSpans.push([toks[i].start, toks[afterVal].end]);
            }
            if (toks[afterVal].text === "}") {
              closeIdx = afterVal;
              break;
            }
            i = nextSignificant(toks, afterVal + 1);
            continue;
          }
        }
      }
      // fallback: skip to the next top-level , ; } inside this table
      const skip = skipToEntryEnd(toks, i);
      if (skip < 0) return null;
      failedSpans.push([toks[i].start, toks[skip].end]);
      if (toks[skip].text === "}") {
        closeIdx = skip;
        break;
      }
      i = nextSignificant(toks, skip + 1);
    }

    if (closeIdx < 0) return null;
    return { map, closeIdx, failedSpans };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function firstTokenAtOrAfter(toks: LuaToken[], offset: number): number {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "eof") break;
    if (t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment") continue;
    if (t.start >= offset) return i;
  }
  return -1;
}

/** Walk from token i, tracking (), [], {} nesting, until a depth-0 `,` `;` or `}`. */
function skipToEntryEnd(toks: LuaToken[], i: number): number {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    const t = toks[j];
    if (t.kind === "eof") return -1;
    if (t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment") continue;
    if (t.text === "(" || t.text === "[" || t.text === "{") {
      depth++;
    } else if (t.text === ")" || t.text === "]") {
      depth--;
    } else if (t.text === "}") {
      if (depth === 0) return j;
      depth--;
    } else if ((t.text === "," || t.text === ";") && depth === 0) {
      return j;
    }
  }
  return -1;
}

function decodeHex(s: string): string {
  const cleaned = s.replace(/\\x([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  if (/^[0-9a-fA-F\s]+$/.test(cleaned) && cleaned.replace(/\s/g, "").length % 2 === 0) {
    const hex = cleaned.replace(/\s/g, "");
    let out = "";
    for (let i = 0; i < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
  }
  return cleaned;
}
