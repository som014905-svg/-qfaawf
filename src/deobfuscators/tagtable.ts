// Tagged String-Table Decoder (IronBrew v2 / AztupBrew-style layouts).
//
// Layout handled:
//   local a = {"8<base85 payload>", "4<base64 payload>", ...}   -- tag-prefixed entries
//   local function q(q) return a[q - <offset expr>] end         -- accessor
//   for q,H in ipairs({{lo,hi};...}) do ... end                 -- segment shuffle
//   do
//     local H = { <85-entry char→value alphabet> }              -- custom Ascii85
//     local v = { <64-entry char→value alphabet> }              -- custom base64
//     for a = 1,#I do ... tag decode ... end                    -- runtime decoder
//   end
//
// Strategy (static, no execution):
//   1. Locate the big string table + every alphabet table (char→value maps
//      whose values form a contiguous 0..N-1 range — obfuscated arithmetic
//      like `-301110-(-301481)` is evaluated safely).
//   2. Codec voting: for each frequent first-char tag, try every
//      (alphabet × codec) combination and count how many entries decode to
//      readable text. The codec that unlocks the most readable strings wins.
//   3. Replace each decodable entry IN PLACE with its decoded literal when
//      the value is readable and its first char isn't itself a runtime tag
//      (avoids the runtime decoder double-decoding it).
//   4. Emit the recovered strings as an artifact and unescape every string
//      literal in the output for readability.
//
// The shuffle never matters for the in-place replacement (entries keep their
// source positions), so it is reported but not replayed.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult, DetectionMatch } from "../types";
import { unescapeStringLiterals, reencodeLuaString } from "../utils/lua-utils";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Printable ASCII ratio of a string (0..1). */
function printableRatio(s: string): number {
  if (!s.length) return 0;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 32 && c < 127) n++;
  }
  return n / s.length;
}

/** Safely evaluate an integer arithmetic expression (digits + + - * / % parens only). */
export function evalIntExpr(s: string): number | null {
  const t = s.replace(/\s+/g, "");
  if (!t || t.length > 64) return null;
  if (!/^[0-9+\-*\/%().]+$/.test(t)) return null;
  if (/[*/%]{3,}/.test(t)) return null; // degenerate operator runs
  try {
    const v = Function(`"use strict";return (${t})`)() as unknown;
    if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)) return v;
  } catch {
    /* not evaluable */
  }
  return null;
}

interface TableEntry {
  /** Absolute offset of the opening quote in the source. */
  start: number;
  /** Absolute offset just past the closing quote. */
  end: number;
  /** Decoded value of the literal. */
  value: string;
}

interface AlphabetTable {
  varName: string;
  map: Map<string, number>;
  size: number;
  bodyStart: number;
}

interface StringTable {
  varName: string;
  entries: TableEntry[];
  bodyStart: number;
  bodyEnd: number;
}

/** Scan a region of Lua source for short string literals (with escapes). */
function scanStringLiterals(src: string, from: number, to: number): TableEntry[] {
  const out: TableEntry[] = [];
  let i = from;
  while (i < to) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const start = i;
      const quote = ch;
      i++;
      let value = "";
      while (i < to) {
        const c = src[i];
        if (c === "\\") {
          const n = src[i + 1];
          if (n === "n") { value += "\n"; i += 2; }
          else if (n === "t") { value += "\t"; i += 2; }
          else if (n === "r") { value += "\r"; i += 2; }
          else if (n === "\\") { value += "\\"; i += 2; }
          else if (n === quote) { value += quote; i += 2; }
          else if (n === "\n") { value += "\n"; i += 2; }
          else if (n === "x") {
            const hex = src.slice(i + 2, i + 4);
            if (/^[0-9a-fA-F]{2}$/.test(hex)) { value += String.fromCharCode(parseInt(hex, 16)); i += 4; }
            else { value += "x"; i += 2; }
          } else if (n === "u" && src[i + 2] === "{") {
            const close = src.indexOf("}", i + 3);
            const hex = src.slice(i + 3, close);
            if (close > i + 3 && close - (i + 3) <= 6 && /^[0-9a-fA-F]+$/.test(hex)) {
              value += String.fromCodePoint(parseInt(hex, 16));
              i = close + 1;
            } else { value += "u"; i += 2; }
          } else if (n >= "0" && n <= "9") {
            let d = "";
            let j = i + 1;
            while (j < to && /[0-9]/.test(src[j]) && d.length < 3) { d += src[j]; j++; }
            const code = parseInt(d, 10);
            value += String.fromCharCode(code > 255 ? code & 0xff : code);
            i = j;
          } else { value += n ?? ""; i += 2; }
          continue;
        }
        if (c === quote) { i++; break; }
        if (c === "\n") break; // unterminated
        value += c;
        i++;
      }
      out.push({ start, end: i, value });
      continue;
    }
    i++;
  }
  return out;
}

/** Extract a balanced-brace table body after a `local NAME={` match. Returns [bodyStart, bodyEnd). */
function extractBraceBody(src: string, braceOpenIdx: number): [number, number] | null {
  let depth = 1;
  let j = braceOpenIdx + 1;
  while (j < src.length && depth > 0) {
    const c = src[j];
    if (c === '"' || c === "'") {
      // skip string literal so braces inside strings don't count
      const q = c;
      j++;
      while (j < src.length && src[j] !== q) {
        if (src[j] === "\\") j++;
        j++;
      }
      j++;
      continue;
    }
    if (c === "-" && src[j + 1] === "-") {
      // skip comment
      j += 2;
      if (src[j] === "[" && src[j + 1] === "[") {
        // long comment
        const level = longBracketLevelAt(src, j);
        const close = "]" + "=".repeat(level) + "]";
        const end = src.indexOf(close, j);
        j = end < 0 ? src.length : end + close.length;
      } else {
        const end = src.indexOf("\n", j);
        j = end < 0 ? src.length : end + 1;
      }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    j++;
  }
  if (depth !== 0) return null;
  return [braceOpenIdx + 1, j - 1];
}

function longBracketLevelAt(src: string, i: number): number {
  let level = 0;
  let j = i + 1;
  while (src[j] === "=") { level++; j++; }
  return level;
}

/** Parse an alphabet table body: single-char keys → int values (0..N-1 contiguous). */
function parseAlphabet(body: string, offset: number, varName: string): AlphabetTable | null {
  const map = new Map<string, number>();
  const re = /\[\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')\s*\]\s*=\s*([^,;\n}]+)|([A-Za-z_]\w*)\s*=\s*([^,;\n}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    let key: string | null = null;
    let valStr: string;
    if (m[1] !== undefined) {
      const inner = m[1].slice(1, -1);
      key = inner.replace(/\\(.)/g, (_s, c: string) =>
        c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c === "\\" ? "\\" :
        c === "a" ? "\x07" : c === "b" ? "\b" : c === "f" ? "\f" : c === "v" ? "\v" :
        c === "x" ? String.fromCharCode(parseInt(inner.slice(inner.indexOf("\\x") + 2, inner.indexOf("\\x") + 4), 16)) : c
      );
      valStr = m[2];
    } else {
      key = m[3];
      valStr = m[4];
    }
    if (key === null || key.length !== 1) continue;
    const val = evalIntExpr(valStr);
    if (val === null || val < 0 || val > 127) continue;
    if (!map.has(key)) map.set(key, val);
  }
  if (map.size < 32 || map.size > 100) return null;
  // values must form a contiguous 0..N-1 range
  const seen = new Set(map.values());
  if (seen.size !== map.size) return null;
  for (let k = 0; k < map.size; k++) if (!seen.has(k)) return null;
  return { varName, map, size: map.size, bodyStart: offset };
}

interface LayoutScan {
  stringTable: StringTable;
  alphabets: AlphabetTable[];
  tagStats: Map<string, number>;
}

/** Scan the source for the tagged string-table layout. */
export function scanTagTableLayout(src: string): LayoutScan | null {
  // Find every `local NAME={` declaration.
  const declRe = /local\s+([A-Za-z_]\w*)\s*=\s*\{/g;
  const candidates: Array<{ varName: string; bodyStart: number; bodyEnd: number; body: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(src))) {
    const open = m.index + m[0].length - 1;
    const body = extractBraceBody(src, open);
    if (!body) continue;
    const [s, e] = body;
    if (e - s > 4_000_000) continue; // safety cap
    candidates.push({ varName: m[1], bodyStart: s, bodyEnd: e, body: src.slice(s, e) });
    declRe.lastIndex = e;
  }

  // Classify: string tables (many string literals) vs alphabets (char→int maps).
  let bestTable: StringTable | null = null;
  const alphabets: AlphabetTable[] = [];
  for (const cand of candidates) {
    const entries = scanStringLiterals(src, cand.bodyStart, cand.bodyEnd);
    const nonString = cand.body.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, "").trim();
    const isMostlyStrings =
      entries.length >= 10 &&
      nonString.replace(/[,;]/g, "").length < Math.max(20, entries.length * 2);
    if (isMostlyStrings) {
      if (!bestTable || entries.length > bestTable.entries.length) {
        bestTable = { varName: cand.varName, entries, bodyStart: cand.bodyStart, bodyEnd: cand.bodyEnd };
      }
      continue;
    }
    const alpha = parseAlphabet(cand.body, cand.bodyStart, cand.varName);
    if (alpha) alphabets.push(alpha);
  }
  if (!bestTable || bestTable.entries.length < 25) return null;
  if (alphabets.length === 0) return null;

  // Tag statistics: first chars of entries.
  const tagStats = new Map<string, number>();
  for (const e of bestTable.entries) {
    if (!e.value.length) continue;
    const t = e.value[0];
    tagStats.set(t, (tagStats.get(t) ?? 0) + 1);
  }
  return { stringTable: bestTable, alphabets, tagStats };
}

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

/** Custom-alphabet Ascii85 (IronBrew "8" tag): 5 chars → 4 bytes, pad value 84. */
function decodeAscii85(s: string, map: Map<string, number>): string {
  const out: number[] = [];
  let pos = 0;
  const len = s.length;
  while (pos < len) {
    const remaining = len - pos;
    const chunk = remaining >= 5 ? 5 : remaining;
    let acc = 0;
    let valid = chunk > 1;
    for (let a = 0; a < 5; a++) {
      let u: number;
      if (a < chunk) {
        const val = map.get(s[pos + a]);
        if (val === undefined) { valid = false; break; }
        u = val;
      } else {
        u = 84;
      }
      acc = acc * 85 + u;
    }
    if (valid) {
      const b1 = Math.floor(acc / 16777216) % 256;
      const b2 = Math.floor(acc / 65536) % 256;
      const b3 = Math.floor(acc / 256) % 256;
      const b4 = acc % 256;
      if (chunk === 5) out.push(b1, b2, b3, b4);
      else if (chunk === 4) out.push(b1, b2, b3);
      else if (chunk === 3) out.push(b1, b2);
      else if (chunk === 2) out.push(b1);
    }
    pos += chunk;
  }
  return bytesToLatin1(out);
}

/** Custom-alphabet base64 (IronBrew "4" tag) with `=` padding support. */
function decodeCustomBase64(s: string, map: Map<string, number>): string {
  const out: number[] = [];
  let acc = 0;
  let cnt = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const val = map.get(ch);
    if (val !== undefined) {
      acc = acc + val * Math.pow(64, 3 - cnt);
      cnt++;
      if (cnt === 4) {
        cnt = 0;
        out.push(Math.floor(acc / 65536), Math.floor((acc % 65536) / 256), acc % 256);
        acc = 0;
      }
    } else if (ch === "=") {
      out.push(Math.floor(acc / 65536));
      if (i >= s.length - 1 || s[i + 1] !== "=") {
        out.push(Math.floor((acc % 65536) / 256));
      }
      break;
    } else {
      return "\u0000"; // unknown char → runtime would throw/skip; treat as undecodable
    }
  }
  return bytesToLatin1(out);
}

function bytesToLatin1(bytes: number[]): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b & 0xff);
  return s;
}

// ---------------------------------------------------------------------------
// Deobfuscator
// ---------------------------------------------------------------------------

interface CodecChoice {
  alphabet: AlphabetTable;
  codec: "ascii85" | "base64";
  readableCount: number;
}

export class TagTableDeobfuscator implements Deobfuscator {
  id = "tagtable_vm" as const;
  name = "Tagged String-Table Decoder";
  description =
    "Decodes IronBrew v2 / AztupBrew-style tagged string tables (custom-alphabet Ascii85 + base64 entries), inlines the recovered strings, and normalises escape sequences.";

  detect(input: string): DetectionMatch | null {
    if (input.length > 8_000_000) return null;
    let scan: LayoutScan | null = null;
    try {
      scan = scanTagTableLayout(input);
    } catch {
      return null;
    }
    if (!scan) return null;
    const total = scan.stringTable.entries.length;
    const covered = [...scan.tagStats.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .reduce((acc, [, n]) => acc + n, 0);
    const coverage = total ? covered / total : 0;
    const hasBigAlpha = scan.alphabets.some((a) => a.size === 85);
    if (total >= 25 && coverage >= 0.6 && (hasBigAlpha || scan.alphabets.length >= 2)) {
      return {
        obfuscator: "tagtable_vm",
        confidence: 0.85,
        evidence: `tagged string table (${total} entries, top-tag coverage ${(coverage * 100).toFixed(0)}%) + ${scan.alphabets.length} custom alphabet(s) (sizes: ${scan.alphabets.map((a) => a.size).join(", ")})`,
      };
    }
    return null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    const artifacts: string[] = [];
    let confidence = 0.45;

    log("tagtable: scanning for tagged string table + alphabets...");
    const scan = scanTagTableLayout(input);
    if (!scan) {
      return {
        success: false,
        deobfuscator: this.name,
        output: input,
        notes: ["Layout not found at deobfuscate time."],
        confidence: 0.1,
        obfuscator: "tagtable_vm",
      };
    }
    const { stringTable, alphabets, tagStats } = scan;
    const total = stringTable.entries.length;
    notes.push(`Found string table '${stringTable.varName}' with ${total} tagged entries.`);
    notes.push(`Found ${alphabets.length} custom alphabet(s): ${alphabets.map((a) => `${a.varName}(${a.size})`).join(", ")}.`);

    // ---- Codec voting per tag -------------------------------------------
    log(`tagtable: voting codecs across ${alphabets.length} alphabet(s)...`);
    const codecByTag = new Map<string, CodecChoice>();
    const sortedTags = [...tagStats.entries()].sort((a, b) => b[1] - a[1]);
    for (const [tag, count] of sortedTags) {
      if (count < 5) continue;
      const tagged = stringTable.entries.filter((e) => e.value[0] === tag).slice(0, 80);
      let best: CodecChoice | null = null;
      let secondBest = 0;
      for (const alpha of alphabets) {
        for (const codec of ["ascii85", "base64"] as const) {
          let readable = 0;
          for (const e of tagged) {
            const dec =
              codec === "ascii85"
                ? decodeAscii85(e.value.slice(1), alpha.map)
                : decodeCustomBase64(e.value.slice(1), alpha.map);
            if (dec && dec.length >= 2 && printableRatio(dec) >= 0.9) readable++;
          }
          if (!best || readable > best.readableCount) {
            if (best) secondBest = best.readableCount;
            best = { alphabet: alpha, codec, readableCount: readable };
          } else if (readable > secondBest) {
            secondBest = readable;
          }
        }
      }
      if (best && best.readableCount >= 3 && best.readableCount > secondBest) {
        codecByTag.set(tag, best);
        log(`    tag "${tag}": ${count} entries → ${best.codec} via ${best.alphabet.varName} (${best.readableCount}/${tagged.length} readable)`);
      } else if (best && best.readableCount >= 3) {
        // ambiguous between alphabets but still meaningful — keep it
        codecByTag.set(tag, best);
        log(`    tag "${tag}": ${count} entries → ${best.codec} via ${best.alphabet.varName} (${best.readableCount} readable, ambiguous)`);
      }
    }

    if (codecByTag.size === 0) {
      notes.push("Codec voting failed — no alphabet produced readable strings.");
      return {
        success: false,
        deobfuscator: this.name,
        output: input,
        notes,
        confidence: 0.15,
        obfuscator: "tagtable_vm",
      };
    }

    // ---- Decode + replace in place --------------------------------------
    log("tagtable: decoding entries and inlining readable strings...");
    const tagSet = new Set(codecByTag.keys());
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    const readableStrings: Array<{ index: number; value: string }> = [];
    const decodedAll: string[] = new Array(total);
    for (let i = 0; i < total; i++) {
      const e = stringTable.entries[i];
      if (!e.value.length) continue;
      const tag = e.value[0];
      const choice = codecByTag.get(tag);
      if (!choice) continue;
      const dec =
        choice.codec === "ascii85"
          ? decodeAscii85(e.value.slice(1), choice.alphabet.map)
          : decodeCustomBase64(e.value.slice(1), choice.alphabet.map);
      decodedAll[i] = dec;
      if (!dec || !dec.length) continue;
      const ratio = printableRatio(dec);
      if (ratio < 0.85) continue; // binary payload — keep encoded form
      if (tagSet.has(dec[0])) continue; // would be double-decoded at runtime
      replacements.push({ start: e.start, end: e.end, text: reencodeLuaString(dec, '"') });
      readableStrings.push({ index: i + 1, value: dec });
    }

    if (replacements.length === 0) {
      notes.push("No readable strings could be inlined.");
      return {
        success: false,
        deobfuscator: this.name,
        output: input,
        notes,
        confidence: 0.2,
        obfuscator: "tagtable_vm",
      };
    }

    // Apply replacements back-to-front so offsets stay valid.
    replacements.sort((a, b) => b.start - a.start);
    let output = input;
    for (const r of replacements) {
      output = output.slice(0, r.start) + r.text + output.slice(r.end);
    }
    notes.push(`Inlined ${replacements.length}/${total} decoded string(s); ${total - replacements.length} entries are binary VM payloads and stay encoded.`);

    // ---- Artifacts --------------------------------------------------------
    const artifactLines: string[] = [];
    artifactLines.push(`-- Tagged string table: ${total} entries, ${readableStrings.length} readable`);
    for (const [tag, choice] of codecByTag) {
      artifactLines.push(`-- Codec: tag "${tag}" → ${choice.codec} (alphabet ${choice.alphabet.varName}, ${choice.alphabet.size} symbols)`);
    }
    artifactLines.push("--");
    for (const rs of readableStrings.slice(0, 600)) {
      const one = rs.value.length > 200 ? rs.value.slice(0, 200) + "…" : rs.value;
      artifactLines.push(`[${rs.index}] ${JSON.stringify(one)}`);
    }
    artifacts.push(artifactLines.join("\n") + "\n");

    // Interesting identifiers (Roblox / Lua API surface) among decoded strings.
    const interesting = readableStrings
      .map((r) => r.value)
      .filter((v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) && v.length >= 3);
    const uniq = [...new Set(interesting)].sort();
    if (uniq.length > 0) {
      artifacts.push(
        `-- ${uniq.length} identifier-like strings recovered:\n` +
          uniq.slice(0, 400).map((s) => `-- ${s}`).join("\n") + "\n"
      );
    }

    // ---- Unescape every string literal for readability --------------------
    log("tagtable: normalising string literal escapes...");
    const un = unescapeStringLiterals(output);
    if (un.rewritten > 0) {
      output = un.result;
      notes.push(`Normalised escapes in ${un.rewritten} string literal(s).`);
    }

    confidence = Math.min(0.92, 0.5 + Math.min(0.3, replacements.length / 300) + (codecByTag.size > 1 ? 0.05 : 0));
    notes.push("VM bytecode entries are preserved encoded — full devirtualisation needs runtime tracing.");

    return {
      success: true,
      deobfuscator: this.name,
      output,
      notes,
      confidence,
      artifacts,
      obfuscator: "tagtable_vm",
    };
  }
}
