// Dedicated static profile for the public HeavyWeightFishing sample from
// joustingmatch/Ouroboros. The sample is a WeAreDevs v1.0.0 layout with a
// nonstandard table name, arithmetic-noise offset, shuffle-before-decode,
// custom base64 alphabet, and a VM/cache layer.
//
// This profile intentionally remains source-to-source: it recovers the
// deterministic string table and numeric accessor calls but never executes
// Roblox or attacker-supplied Lua.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult } from "../types";
import {
  beautifyLua,
  decodeLuaEscapes,
  reencodeLuaString,
  tokenize,
  LuaToken,
  looksLikeLuaSource,
  unescapeStringLiterals,
} from "../utils/lua-utils";
import { evalExprFromTokens } from "../utils/const-eval";
import { foldConstants } from "../passes/constant-fold";
import { inlineOffsetTableLookups, inlineNumericCacheAccessors } from "../passes/static-resolve";
import { analyzeBinaryTreeDispatch } from "../passes/binary-tree-dispatch";
import { abstractExecuteLua } from "../vm/abstract-interpreter";
import { buildDispatcherGraph } from "../vm/dispatcher-graph";

interface Entry {
  raw: string;
  decoded?: string;
}

function trivia(t: LuaToken): boolean {
  return t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment";
}

function sigTokens(src: string): LuaToken[] {
  return [...tokenize(src)].filter((t) => !trivia(t) && t.kind !== "eof");
}

function applyEdits(src: string, edits: Array<{ start: number; end: number; text: string }>): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: string[] = [];
  let cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor) continue;
    out.push(src.slice(cursor, e.start), e.text);
    cursor = e.end;
  }
  out.push(src.slice(cursor));
  return out.join("");
}

function constNumber(tokens: LuaToken[]): number | null {
  const compact = tokens.filter((t) => !trivia(t) && t.kind !== "eof");
  if (!compact.length) return null;
  const ev = evalExprFromTokens(compact, 0);
  if (!ev || ev.endIndex !== compact.length || ev.value.k !== "number") return null;
  const n = ev.value.v;
  return Number.isFinite(n) && Number.isSafeInteger(n) ? n : null;
}

function parseStringBodyList(body: string): string[] {
  const out: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

function parseMap(body: string): Map<string, number> {
  const map = new Map<string, number>();
  const re = /(?:\["((?:\\.|[^"\\])*)"\]|([A-Za-z_][A-Za-z0-9_]*))\s*=\s*([^,;}]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const keyRaw = m[1] ?? m[2];
    const expr = m[3].trim();
    const toks = [...tokenize(expr)].filter((t) => !trivia(t) && t.kind !== "eof");
    const n = constNumber(toks);
    if (keyRaw == null || n == null || n < 0 || n > 63) continue;
    const key = m[1] != null ? decodeLuaEscapes(keyRaw) : keyRaw;
    map.set(key, n);
  }
  return map;
}

function shuffleWeAreDevs(entries: Entry[]): void {
  // Exact three reversal passes from the target sample:
  // reverse(1..933), reverse(1..269), reverse(270..933).
  const reverseRange = (a: number, b: number) => {
    for (let i = a - 1, j = b - 1; i < j; i++, j--) {
      const t = entries[i];
      entries[i] = entries[j];
      entries[j] = t;
    }
  };
  reverseRange(1, entries.length);
  const pivot = Math.min(269, entries.length);
  if (pivot > 1) reverseRange(1, pivot);
  if (pivot + 1 <= entries.length) reverseRange(pivot + 1, entries.length);
}

function customBase64Decode(input: string, map: Map<string, number>): string {
  const bytes: number[] = [];
  let acc = 0;
  let count = 0;
  for (const ch of input) {
    if (ch === "=") {
      // Match the target decoder's partial-quartet handling. With two
      // symbols there is one output byte; with three symbols there are two.
      if (count === 2) bytes.push(Math.floor(acc / 16) & 0xff);
      else if (count === 3) bytes.push(Math.floor(acc / 1024) & 0xff, Math.floor(acc / 4) & 0xff);
      count = 0;
      break;
    }
    const v = map.get(ch);
    if (v == null) continue;
    acc = acc * 64 + v;
    count++;
    if (count === 4) {
      bytes.push(Math.floor(acc / 65536) & 0xff, Math.floor(acc / 256) & 0xff, acc & 0xff);
      acc = 0;
      count = 0;
    }
  }
  if (count === 2) bytes.push(Math.floor(acc / 16) & 0xff);
  else if (count === 3) bytes.push(Math.floor(acc / 64) & 0xff, acc & 0xff);
  return new TextDecoder("latin1").decode(new Uint8Array(bytes));
}

function findMatching(sig: LuaToken[], openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIndex; i < sig.length; i++) {
    if (sig[i].text === open) depth++;
    else if (sig[i].text === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export class HeavyWeightFishingDeobfuscator implements Deobfuscator {
  id = "heavyweightfishing" as const;
  name = "HeavyWeightFishing Specialized Deobfuscator";
  description =
    "Dedicated static decoder for the HeavyWeightFishing WeAreDevs sample: exact shuffle/custom-base64 string table recovery plus numeric accessor folding.";

  detect(input: string) {
    let score = 0;
    const evidence: string[] = [];
    if (/wearedevs\.net\/obfuscator/i.test(input)) {
      score += 0.35;
      evidence.push("WeAreDevs v1.0.0 banner");
    }
    if (/local\s+O\s*=\s*\{[\s\S]*?\}\s*local\s+function\s+B\s*\(B\)\s*return\s+O\[B\+/i.test(input)) {
      score += 0.35;
      evidence.push("O-table + B(B) offset accessor");
    }
    if (/421764\s*\+\s*-377161|44603/.test(input)) {
      score += 0.15;
      evidence.push("target arithmetic-noise offset");
    }
    if (/local\s+B\s*=\s*O\s+local\s+X\s*=\s*math\.floor\s+local\s+Z\s*=\s*string\.char/i.test(input)) {
      score += 0.1;
      evidence.push("target custom-base64 decoder shape");
    }
    if (/32358950058716|3194772571599|wq3YKo5wbFHhzR/.test(input)) {
      score += 0.05;
      evidence.push("target VM/cache/anti-tamper fingerprint");
    }
    if (score < 0.75) return null;
    return {
      obfuscator: "heavyweightfishing" as const,
      confidence: Math.min(0.99, score),
      evidence: evidence.join("; "),
    };
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    const artifacts: string[] = [];
    let work = input;
    let confidence = 0.55;

    if (!/wearedevs\.net\/obfuscator/i.test(work)) {
      return {
        success: false,
        deobfuscator: this.name,
        output: input,
        notes: ["HeavyWeightFishing profile fingerprint did not match."],
        confidence: 0,
        obfuscator: "heavyweightfishing",
      };
    }

    // Locate the exact target O table.
    log("heavyweightfishing: extracting target O string table...");
    const tableMatch = work.match(/local\s+O\s*=\s*\{([\s\S]*?)\}\s*local\s+function\s+B\s*\(B\)\s*return\s+O\[/);
    if (!tableMatch) {
      return {
        success: false,
        deobfuscator: this.name,
        output: input,
        notes: ["Target O string table was not found."],
        confidence: 0,
        obfuscator: "heavyweightfishing",
      };
    }

    const rawEntries = parseStringBodyList(tableMatch[1]);
    if (rawEntries.length < 500) {
      return {
        success: false,
        deobfuscator: this.name,
        output: input,
        notes: [`Target table was unexpectedly small (${rawEntries.length} entries).`],
        confidence: 0,
        obfuscator: "heavyweightfishing",
      };
    }
    notes.push(`Recovered ${rawEntries.length} raw target string-table entries.`);

    const entries: Entry[] = rawEntries.map((raw) => ({ raw: decodeLuaEscapes(raw) }));
    shuffleWeAreDevs(entries);
    notes.push("Replayed the target's three-range table shuffle exactly.");

    // Locate the target Q character map and decode the shuffled string table.
    log("heavyweightfishing: decoding target custom base64 alphabet...");
    const qMatch = work.match(/local\s+Q\s*=\s*\{([\s\S]*?)\}\s*local/);
    if (!qMatch) {
      return {
        success: false,
        deobfuscator: this.name,
        output: input,
        notes: [...notes, "Target Q character map was not found."],
        confidence: 0,
        obfuscator: "heavyweightfishing",
      };
    }
    const qMap = parseMap(qMatch[1]);
    if (qMap.size < 50) {
      return {
        success: false,
        deobfuscator: this.name,
        output: input,
        notes: [...notes, `Target Q map was unexpectedly small (${qMap.size} entries).`],
        confidence: 0,
        obfuscator: "heavyweightfishing",
      };
    }

    let readable = 0;
    for (const e of entries) {
      const decoded = customBase64Decode(e.raw, qMap);
      e.decoded = decoded;
      if ([...decoded].every((c) => {
        const n = c.charCodeAt(0);
        return (n >= 32 && n <= 126) || n === 9 || n === 10 || n === 13;
      })) readable++;
    }
    notes.push(`Decoded ${readable}/${entries.length} target strings as readable text.`);
    confidence += Math.min(0.12, readable / Math.max(entries.length, 1) * 0.12);

    const decodedTable = `local O = {\n${entries
      .map((e) => `  ${reencodeLuaString(e.decoded ?? "", '"')}`)
      .join(",\n")}\n}`;

    artifacts.push(
      `-- HeavyWeightFishing specialized string table\n` +
      `-- source profile: WeAreDevs v1.0.0 / Ouroboros heavyweightfishing.lua\n` +
      `-- entries: ${entries.length}\n` +
      entries.map((e, i) => `-- O[${i + 1}] = ${reencodeLuaString(e.decoded ?? "", '"')}`).join("\n") +
      "\n"
    );

    // Replace target B(expr) accessors using the recovered, shuffled table.
    // Arithmetic inside the argument is handled by the shared safe evaluator.
    log("heavyweightfishing: inlining target B(...) string lookups...");
    const sig = sigTokens(work);
    const accessor = work.match(/local\s+function\s+B\s*\(B\)\s*return\s+O\[B\s*\+\s*\(([\s\S]*?)\)\]\s*end/);
    let offset: number | null = null;
    if (accessor) {
      const offTokens = [...tokenize(accessor[1])].filter((t) => !trivia(t) && t.kind !== "eof");
      offset = constNumber(offTokens);
    }
    if (offset == null) offset = 44603;
    notes.push(`Resolved target B accessor offset = ${offset}.`);

    const callEdits: Array<{ start: number; end: number; text: string }> = [];
    let decodedCalls = 0;
    for (let i = 0; i + 1 < sig.length; i++) {
      if (sig[i].kind !== "identifier" || sig[i].text !== "B" || sig[i + 1].text !== "(") continue;
      const close = findMatching(sig, i + 1, "(", ")");
      if (close < 0) continue;
      const args = sig.slice(i + 2, close);
      const argValue = constNumber(args);
      if (argValue == null) continue;
      const index = argValue + offset;
      if (!Number.isInteger(index) || index < 1 || index > entries.length) continue;
      const value = entries[index - 1]?.decoded;
      if (value == null) continue;
      callEdits.push({ start: sig[i].start, end: sig[close].end, text: reencodeLuaString(value, '"') });
      decodedCalls++;
      i = close;
    }
    if (callEdits.length) {
      work = applyEdits(work, callEdits);
      notes.push(`Inlined ${decodedCalls} literal B(...) lookups using the recovered shuffled table.`);
      confidence += Math.min(0.12, decodedCalls / 2000 * 0.12);
    }

    // The table/accessor/shuffle/decoder prefix is only a runtime bootstrap.
    // Keeping it makes the result look unchanged and can decode the already
    // recovered strings a second time. Replace the whole prefix with the
    // final table while preserving the VM body that consumes it.
    const tableStart = work.search(/local\s+O\s*=\s*\{/);
    const prefixAfterTable = tableStart < 0 ? "" : work.slice(tableStart);
    const vmOffset = prefixAfterTable.search(/\breturn\s*\(\s*function/);
    const vmStart = vmOffset < 0 || tableStart < 0 ? -1 : tableStart + vmOffset;
    if (tableStart >= 0 && vmStart > tableStart) {
      work = work.slice(0, tableStart) + decodedTable + "\n    " + work.slice(vmStart);
      notes.push("Replaced the encoded O-table and runtime string-decoder bootstrap with the recovered table.");
      confidence += 0.08;
    }

    // Apply the generic static resolvers after the specialized string table.
    // They are conservative and source-to-source only.
    try {
      const off = inlineOffsetTableLookups(work);
      if (off.changed) {
        work = off.result;
        notes.push(...off.notes);
      }
      const cache = inlineNumericCacheAccessors(work);
      if (cache.changed) {
        work = cache.result;
        notes.push(...cache.notes);
      }
      const norm = unescapeStringLiterals(work);
      if (norm.rewritten) work = norm.result;
      const folded = foldConstants(work, 2);
      if (folded.folded) {
        work = folded.result;
        notes.push(`Applied ${folded.folded} additional constant-fold(s).`);
      }
    } catch (e: unknown) {
      log(`heavyweightfishing: conservative cleanup skipped (${e instanceof Error ? e.message : String(e)})`);
    }

    // v5.9 structural analysis: record dispatcher/abstract-interpreter facts
    // as artifacts, without executing Roblox, network, or dynamic code.
    try {
      const dispatch = analyzeBinaryTreeDispatch(work, 96);
      if (dispatch.length) {
        notes.push(`Detected ${dispatch.length} nested numeric dispatcher candidate(s) for v5.9 structural recovery.`);
        artifacts.push(`-- v5.9 binary-dispatch analysis\n${JSON.stringify(dispatch, null, 2)}\n`);
        artifacts.push(`-- v5.9 dispatcher graph summary\n${JSON.stringify(buildDispatcherGraph(work, 96), null, 2)}\n`);
      }
      const abs = abstractExecuteLua(work, 6000);
      notes.push(...abs.notes);
      artifacts.push(`-- v5.9 bounded abstract-execution summary\n${JSON.stringify(abs.state, null, 2)}\n`);
    } catch (e: unknown) {
      log(`heavyweightfishing: v5.9 analysis skipped (${e instanceof Error ? e.message : String(e)})`);
    }

    try {
      work = beautifyLua(work);
    } catch {
      // Preserve the recovered source when formatting is not safe.
    }

    if (looksLikeLuaSource(work)) confidence += 0.05;
    notes.push(
      "VM dispatcher and anti-tamper semantics are preserved unless a v5.9 rewrite is proven safe; this profile performs deterministic static recovery plus bounded abstract analysis only."
    );

    return {
      success: true,
      deobfuscator: this.name,
      output:
        `-- HeavyWeightFishing specialized static deobfuscation profile\n` +
        `-- Target: https://raw.githubusercontent.com/joustingmatch/Ouroboros/main/games/heavyweightfishing.lua\n` +
        `-- String table: ${entries.length} entries; recovered B(...) calls: ${decodedCalls}\n\n` +
        work,
      notes,
      confidence: Math.min(0.92, confidence),
      artifacts,
      obfuscator: "heavyweightfishing",
    };
  }
}
