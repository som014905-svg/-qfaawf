// Generic Lua/Luau deobfuscator — applies common cleanup passes that help with
// many obfuscators: hex-string decoding, char-code string reconstruction,
// identifier renaming, constant folding, and beautification. Always runs as
// a fallback.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult } from "../types";
import {
  iterStringLiterals,
  looksLikeLuaSource,
  beautifyLua,
  renameObfuscatedIdentifiers,
  tryBase64Decode,
  unescapeStringLiterals,
  reencodeLuaString,
} from "../utils/lua-utils";
import { foldConstants } from "../passes/constant-fold";
import { inlineStaticTables, inlineIndexedObjectTableLookups, normalizeStdlibAliases, normalizeEnvStdlibAliases, unwrapLiteralLoadstring, foldSimpleXorDecoderFunctions, foldEncodedStringTableLiterals } from "../passes/static-resolve";
import { ModernVMDeobfuscator } from "./modern-vm";

export class GenericDeobfuscator implements Deobfuscator {
  id = "generic" as const;
  name = "Generic Cleanup";
  description =
    "Hex/char-code string deobfuscation, static table/stdlib alias resolution, identifier renaming, constant folding, and source beautification. Structural fallback for Lua/Luau VM samples.";

  detect(input: string) {
    // generic always matches — it's the fallback
    const escapeCount = (input.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
    const obfIds = (input.match(/\b[Il1O0_]{4,}\b/g) || []).length;
    const hasLongString = /"[^"]{500,}"|\[\[[^\]]{500,}\]\]/.test(input);
    let score = 0.15;
    if (escapeCount > 30) score += 0.15;
    if (obfIds > 15) score += 0.1;
    if (hasLongString) score += 0.1;
    return {
      obfuscator: "generic" as const,
      confidence: Math.min(0.5, score),
      evidence: `generic signals (escapes: ${escapeCount}, obf-ids: ${obfIds}, long-string: ${hasLongString})`,
    };
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    let work = input;
    let confidence = 0.3;

    // Pass 1: decode \xNN escape-heavy strings inline (only short ones)
    log("generic: scanning string literals for encoded payloads...");
    const literals = [...iterStringLiterals(work)];
    let decodedCount = 0;
    {
      // Collect replacements first, then splice in REVERSE order so the
      // offsets of earlier literals stay valid (splicing with stale offsets
      // used to corrupt large files). Lua-safe re-encoding instead of
      // JSON.stringify (whose \uXXXX escapes are not valid Lua).
      const replacements: Array<{ start: number; end: number; text: string }> = [];
      for (const lit of literals) {
        if (lit.value.length < 4) continue;
        // attempt base64 decode
        const b64 = tryBase64Decode(lit.value);
        if (b64 && looksLikeLuaSource(b64) && b64.length > lit.value.length * 0.6) {
          replacements.push({ start: lit.start, end: lit.end, text: reencodeLuaString(b64, '"') });
        }
      }
      for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        work = work.slice(0, r.start) + r.text + work.slice(r.end);
      }
      decodedCount = replacements.length;
    }
    if (decodedCount > 0) {
      notes.push(`Decoded ${decodedCount} base64 string literal(s)`);
      confidence += 0.1;
    }

    // Pass 2 (v4 REMOVED): the old regex-based `string.char(...)` rewrite ran
    // on RAW source text — it matched inside strings/comments, emitted
    // JSON.stringify escapes (`\uXXXX` — invalid Lua) and accepted codes
    // above 255 (changing Lua byte-string lengths). The token-based
    // `foldStringLibraryCalls` inside foldConstants() handles the same
    // pattern safely, so this pass is gone. See constant-fold.ts.

    // Pass 3: minimal-escape rewrite of string literals (tokenizer-guarded —
    // the old regex replace of `\ddd` broke strings whose escape decoded to
    // newline/quote chars and corrupted long strings).
    try {
      const { result: unescaped, rewritten: unescapedN } = unescapeStringLiterals(work);
      if (unescapedN > 0) {
        work = unescaped;
        notes.push(`Normalised escapes in ${unescapedN} string literal(s)`);
      }
    } catch {
      /* best-effort */
    }

    // Pass 4: resolve safe static aliases/tables used by many VM loaders.
    // Modern public Luau VM families (Clyde/Dava-style) expose literal-only
    // string factories that are safe to fold without executing the VM.
    log("generic: decoding modern VM literal factories...");
    try {
      const modern = new ModernVMDeobfuscator();
      const md = modern.detect(work);
      if (md) {
        const mr = await modern.deobfuscate({ ...ctx, input: work, log: () => {} });
        if (mr.output && mr.output !== work) {
          work = mr.output;
          notes.push(...(mr.notes ?? []).slice(0, 6));
          confidence += 0.04;
        }
      }
    } catch {
      // best-effort
    }

    // Pass 4b: resolve safe static aliases/tables used by many VM loaders.
    log("generic: resolving static tables and stdlib aliases...");
    try {
      const envAlias = normalizeEnvStdlibAliases(work);
      if (envAlias.changed > 0) {
        work = envAlias.result;
        notes.push(...envAlias.notes);
        confidence += 0.03;
      }
      const alias = normalizeStdlibAliases(work);
      if (alias.changed > 0) {
        work = alias.result;
        notes.push(...alias.notes);
        confidence += 0.03;
      }
      const xorDec = foldSimpleXorDecoderFunctions(work);
      const encodedTables = foldEncodedStringTableLiterals(xorDec.result);
      if (encodedTables.changed > 0) {
        work = encodedTables.result;
        notes.push(...encodedTables.notes);
        confidence += Math.min(0.1, encodedTables.changed * 0.005);
      }
      if (xorDec.changed > 0) {
        work = xorDec.result;
        notes.push(...xorDec.notes);
        confidence += Math.min(0.12, xorDec.changed * 0.01);
      }
      const indexed = inlineIndexedObjectTableLookups(work);
      if (indexed.changed > 0) {
        work = indexed.result;
        notes.push(...indexed.notes);
        confidence += Math.min(0.18, indexed.changed * 0.0008);
      }
      const tables = inlineStaticTables(work);
      if (tables.changed > 0) {
        work = tables.result;
        notes.push(...tables.notes);
        confidence += Math.min(0.12, tables.changed * 0.005);
      }
      const unwrapped = unwrapLiteralLoadstring(work);
      if (unwrapped.changed > 0) {
        work = unwrapped.result;
        notes.push(...unwrapped.notes);
        confidence += 0.05;
      }
    } catch (e: unknown) {
      log(`generic: static resolver skipped (${e instanceof Error ? e.message : String(e)})`);
    }

    // Pass 5: rename obfuscated identifiers (Il1/O0 soup)
    log("generic: renaming obfuscated identifiers...");
    const { result: renamed, renamed: renameCount } = renameObfuscatedIdentifiers(work);
    if (renameCount > 0) {
      work = renamed;
      notes.push(`Renamed ${renameCount} obfuscated identifier pattern(s)`);
      confidence += 0.05;
    }

    // Pass 6: constant folding — fold "a".."b".."c", string.* calls,
    // tonumber/tostring, bit32.*, arithmetic, _G["x"], dead-code.
    log("generic: running constant-folding pass...");
    try {
      const fold = foldConstants(work, 2);
      if (fold.folded > 0) {
        work = fold.result;
        notes.push(`Constant folding applied ${fold.folded} fold(s).`);
        for (const n of fold.notes.slice(0, 6)) notes.push(n);
        confidence += Math.min(0.15, fold.folded * 0.01);
      }
    } catch (e: unknown) {
      log(`generic: constant-fold failed (${e instanceof Error ? e.message : String(e)}), skipping`);
    }

    // Pass 7: beautify (with safety guard for very large files)
    log("generic: beautifying output...");
    try {
      work = beautifyLua(work);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      log(`generic: beautify failed (${message}), using unformatted output`);
      notes.push(`Beautify skipped: ${message}`);
    }

    notes.push("Generic cleanup applied — for VM-based obfuscators, output is partial.");
    confidence = Math.min(0.7, confidence);

    return {
      success: true,
      deobfuscator: this.name,
      output: work,
      notes,
      confidence,
      obfuscator: "generic",
    };
  }
}
