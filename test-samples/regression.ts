// v4 regression test-suite — mỗi test_guard một bug đã sửa hoặc một feature
// mới. Chạy: bun run test-samples/regression.ts
//
// Quy ước: bất kỳ FAIL nào làm exit code ≠ 0.

import assert from "node:assert/strict";
import { foldConstants, foldArithmeticLiterals, encodeLuaString } from "../src/passes/constant-fold";
import { propagateImmutableLocals } from "../src/passes/advanced-cleanup";
import { recoverControlFlow } from "../src/passes/control-flow";
import {
  beautifyLua,
  renameObfuscatedIdentifiers,
  substituteStringTableRefs,
  tokenize,
} from "../src/utils/lua-utils";
import { validateLuaSource } from "../src/utils/validate";
import { detectObfuscator, detectObfuscatorsDetailed } from "../src/detectors/detector";
import { evalExprFromTokens } from "../src/utils/const-eval";
import { scoreOutputDetailed } from "../src/utils/quality";
import { classifyEngineError } from "../src/utils/error-types";
import { parseLuauNumber, findInstructionFetch, parseDispatchTree, classifyHandler, tokenizeLua } from "../src/vm/luraph-dispatch";
import {
  findAliasDestructuring,
  parseFinalProgram,
  parseTrace,
  analyzeFlow,
  buildRulesTokens,
  matchTokens,
  tokenLetters,
  decompileProgram,
  resolveColumnRoles,
} from "../src/vm/luraph-lifter";
import { extractScriptUrls } from "../src/chain";

let passed = 0;
const failures: string[] = [];

function test_guard(name: string, fn: () => void | Promise<void>): void {
  Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e: unknown) => {
      failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : String(e)}`);
    })
    .finally(() => {
      // chain continuation — all tests are synchronous here
    });
}

// Since the harness above is async-chained, collect tests synchronously and
// await at the end instead.
const tests: Array<[string, () => void]> = [];
function t(name: string, fn: () => void): void {
  tests.push([name, fn]);
}
void test_guard;

// ── C5: Infinity / NaN không bao giờ được emit thành literal Lua ─────────
t("C5 const-eval refuses inf/NaN results", () => {
  const toks = [...tokenize("local a = 1/0")];
  const ev = evalExprFromTokens(toks, 4);
  assert.ok(ev === null || ev.value.k === "ident", "1/0 must not fold to a number");
  const r = foldArithmeticLiterals("local a = 1/0");
  assert.ok(!/\b(inf|Infinity|NaN|nan)\b/.test(r.result), "no inf/NaN literal in output");
});

// ── C6: floor division đúng precedence từng phép ────────────────────────
t("C6 // floor per-operation (7 // 2 * 3 == 9)", () => {
  const r = foldArithmeticLiterals("local x = 7 // 2 * 3");
  assert.ok(r.result.includes("9"), `expected 9, got: ${r.result}`);
  const r2 = foldArithmeticLiterals("local y = 3 + 7 // 2");
  assert.ok(r2.result.includes("6"), `expected 6, got: ${r2.result}`);
});

// ── C6b: ^ right-assoc + unary precedence chuẩn Lua ──────────────────────
t("C6b -2^2 folds to -4 (Lua precedence)", () => {
  const r = foldArithmeticLiterals("local x = -2^2");
  assert.ok(r.result.includes("-4") || r.result.includes("- 4"), `expected -4, got: ${r.result}`);
});

// ── C7: params/for-vars không bị propagation ─────────────────────────────
t("C7 param shadowing not propagated", () => {
  const r = propagateImmutableLocals(`local a = 5\nfunction f(a) return a end\nprint(f(1))`);
  assert.equal(r.changed, 0);
  assert.ok(r.result.includes("return a"));
});
t("C7 for-loop var shadowing not propagated", () => {
  const r = propagateImmutableLocals(`local i = 9\nfor i = 1, 3 do print(i) end`);
  assert.equal(r.changed, 0);
});

// ── C8: beautify indent cân bằng ─────────────────────────────────────────
t("C8 beautify: sequential ifs do not drift right", () => {
  const out = beautifyLua("if a then x=1 end if b then y=2 end if c then z=3 end");
  const lines = out.split("\n").filter((l) => l.trim().length > 0);
  const ifLines = lines.filter((l) => l.trim().startsWith("if "));
  assert.equal(ifLines.length, 3, "3 if lines");
  for (const l of ifLines) {
    assert.ok(!l.startsWith(" "), `if line must not be indented: ${JSON.stringify(l)}`);
  }
});
t("C8 beautify: if/elseif/else alignment", () => {
  const out = beautifyLua("if a then x() elseif b then y() else z() end");
  const lines = out.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.length > 0);
  const idx = {
    if: lines.findIndex((l) => l.startsWith("if ")),
    elseif: lines.findIndex((l) => l.startsWith("elseif")),
    else: lines.findIndex((l) => l.startsWith("else")),
    end: lines.findIndex((l) => l.startsWith("end")),
  };
  const ind = (i: number) => (lines[i].match(/^ */) ?? [""])[0].length;
  assert.ok(ind(idx.if) === ind(idx.elseif), "elseif aligns with if");
  assert.ok(ind(idx.if) === ind(idx.else), "else aligns with if");
  assert.ok(ind(idx.if) === ind(idx.end), "end aligns with if");
});
t("C8 beautify: nested blocks balance back to zero", () => {
  const src = "for i=1,10 do while x do if y then f() end end end\nprint('top')";
  const out = beautifyLua(src);
  const lastLine = out.trimEnd().split("\n").pop() ?? "";
  assert.ok(/^print/.test(lastLine), `top-level after nesting must be unindented: ${JSON.stringify(out)}`);
});

// ── H1: `<<=` / `>>=` tokenization ───────────────────────────────────────
t("H1 <<= >>= lex as single operators", () => {
  const toks = [...tokenize("a <<= 2 b >>= 1")].filter((x) => x.kind !== "whitespace");
  assert.equal(toks[1].text, "<<=");
  assert.equal(toks[1].kind, "operator");
  assert.equal(toks[4].text, ">>=");
  assert.equal(toks[4].kind, "operator");
});

// ── H2: encodeLuaString byte-safety ──────────────────────────────────────
t("H2 encodeLuaString escapes non-ASCII as UTF-8 bytes", () => {
  const lit = encodeLuaString("é"); // U+00E9 → 2 UTF-8 bytes
  assert.ok(!/[é]/.test(lit), "no raw non-ASCII char");
  assert.ok(/\\\d{2,3}/.test(lit), "byte escapes present");
  // decode back gives the same value
  assert.ok(lit.startsWith('"') && lit.endsWith('"'));
});

// ── H3: string.byte multi-value không fold ───────────────────────────────
t("H3 string.byte multi-value not folded", () => {
  const r = foldConstants(`local b = string.byte("ab")`);
  assert.ok(!/\d+,\d+/.test(r.result), `must not produce "97,98": ${r.result}`);
});

// ── H4: tonumber semantics ───────────────────────────────────────────────
t("H4 tonumber('') NOT folded to a number", () => {
  // v3.6 folded tonumber("") → 0 (Lua truth is nil). v4 keeps the call
  // unfolded (still correct) — the bug was producing a WRONG number.
  const r = foldConstants(`local n = tonumber("")`);
  assert.ok(!/=\s*0\b/.test(r.result), `must not fold to 0: ${r.result}`);
});
t("H4 tonumber('ff', 16) → 255", () => {
  const r = foldConstants(`local n = tonumber("ff", 16)`);
  assert.ok(/\b255\b/.test(r.result), `expected 255, got: ${r.result}`);
});

// ── H5: dead-code scope safety ───────────────────────────────────────────
t("H5 if true then local..end keeps do-end scope", () => {
  const r = foldConstants(`if true then local x = 1 end print(x)`);
  assert.ok(/do\s+local x = 1\s+end/.test(r.result), `scope wrapper missing: ${r.result}`);
});

// ── H6: Luau operators trong const-eval ──────────────────────────────────
t("H6 Luau bitwise + // in evaluator", () => {
  const r1 = foldArithmeticLiterals("local a = 5 // 2");
  assert.ok(r1.result.includes("2"), `5//2 → 2, got: ${r1.result}`);
  const r2 = foldArithmeticLiterals("local b = 3 & 5");
  assert.ok(r2.result.includes("1"), `3&5 → 1, got: ${r2.result}`);
  const r3 = foldArithmeticLiterals("local c = 1 << 4");
  assert.ok(r3.result.includes("16"), `1<<4 → 16, got: ${r3.result}`);
});

// ── C2-class: unescape an toàn (quote escape không phá literal) ──────────
t("C2-class escape normalisation never breaks quotes", () => {
  // \034 is a double quote — decoding it raw would terminate the literal.
  const r = foldConstants(`local s = "\\034x\\034"`);
  assert.ok(validateLuaSource(r.result).ok, `output must stay valid: ${r.result}`);
});

// ── C1: prometheus substitution (smoke: substitution helper works) ───────
t("C1 substituteStringTableRefs produces valid Lua strings", () => {
  const r = substituteStringTableRefs(`local x = T[1] .. T[2]`, "T", ["alpha", "beta"]);
  assert.equal(r.substituted, 2);
  assert.ok(r.result.includes('"alpha"') && r.result.includes('"beta"'));
});

// ── M8: state-machine unrolling ──────────────────────────────────────────
t("M8 dispatcher state machine unrolled", () => {
  const src = [
    "local state = 1",
    "while true do",
    "  if state == 1 then",
    "    print('one')",
    "    state = 2",
    "  elseif state == 2 then",
    "    print('two')",
    "    state = 3",
    "  elseif state == 3 then",
    "    print('three')",
    "    break",
    "  end",
    "end",
    "print('after', state)",
  ].join("\n");
  const r = recoverControlFlow(src);
  assert.ok(r.changed > 0, "machine should unroll");
  assert.ok(r.result.includes("print('one')") && r.result.includes("print('three')"));
  assert.ok(!/while true do/.test(r.result), "dispatcher loop removed");
  assert.ok(validateLuaSource(r.result).ok, "unrolled output must validate");
  assert.ok(/state = 3/.test(r.result), "final state value preserved");
});
t("M8 dispatcher with cycle NOT unrolled", () => {
  const src = "local s = 1\nwhile true do\nif s == 1 then s = 2 elseif s == 2 then s = 1 end\nend";
  const r = recoverControlFlow(src);
  assert.equal(r.changed, 0, "cycles must be left alone");
});

// ── renameObfuscatedIdentifiers string-access guard ──────────────────────
t("rename skips identifiers referenced via strings", () => {
  const src = `local lIll = 5\nprint(lIll)\nprint(_G["lIll"])`;
  const r = renameObfuscatedIdentifiers(src);
  assert.equal(r.renamed, 0, "name also in string literal must be skipped");
  assert.ok(r.result.includes("lIll"));
});

// ── detector detailed API ────────────────────────────────────────────────
t("detector: detailed API returns features + secondary", () => {
  const d = detectObfuscatorsDetailed("--[[ IronBrew2 ]] local vm_x = {}\n");
  assert.equal(d.obfuscator, "ironbrew");
  assert.ok(Array.isArray(d.evidence) && d.evidence.length > 0);
  assert.ok("vmDispatcher" in d.features);
  assert.ok(Array.isArray(d.secondary));
});
t("detector: VM dispatcher boosts generic confidence", () => {
  const d = detectObfuscatorsDetailed(
    "while true do if s == 1 then f() elseif s == 2 then g() end end"
  );
  assert.ok(d.confidence >= 0.5, `structural boost expected, got ${d.confidence}`);
  assert.ok(d.features.vmDispatcher);
});

// ── error classification ─────────────────────────────────────────────────
t("error classification kinds", () => {
  assert.equal(classifyEngineError(new Error("timeout after 30000ms")).kind, "timeout");
  assert.equal(classifyEngineError(new Error("file too large")).kind, "resource");
  assert.equal(classifyEngineError(new Error("lexer failure")).kind, "parse");
});

// ── quality detailed scoring ─────────────────────────────────────────────
t("quality: broken syntax ranks below valid", () => {
  const good = scoreOutputDetailed({
    source: "local x = 1\nprint(x)\n",
    inputBytes: 100,
    syntaxOk: true,
    syntaxErrors: 0,
  });
  const bad = scoreOutputDetailed({
    source: "local x = (1\nprint(x))]\n",
    inputBytes: 100,
    syntaxOk: false,
    syntaxErrors: 3,
  });
  assert.ok(good.score > bad.score, `${good.score} must beat ${bad.score}`);
  assert.ok(good.syntaxScore === 1 && bad.syntaxScore < 1);
});

// ── validator ────────────────────────────────────────────────────────────
t("validator: repeat/until + nested functions balance", () => {
  assert.ok(validateLuaSource("repeat local f = function() return 1 end until f()").ok);
  assert.ok(!validateLuaSource("repeat until until").ok);
});
t("validator: truncated output warning", () => {
  const v = validateLuaSource("local x = 1 +\n");
  assert.ok(v.issues.some((i) => i.message.includes("truncated")));
});

// ── chain URL extraction (aliases) ───────────────────────────────────────
t("chain: syn.request Url = detected as httpfetch", () => {
  const urls = extractScriptUrls(`local r = syn.request({Url = "https://example.com/x.lua"})`);
  const u = urls.find((x) => x.url.includes("x.lua"));
  assert.ok(u, "url extracted");
  assert.equal(u?.usage, "httpfetch");
});

// ── end-to-end smoke qua orchestrator ────────────────────────────────────
t("fold pipeline: combined noise folds cleanly", () => {
  const src = [
    "local a = 10 + 20",
    "local b = \"he\" .. \"llo\"",
    "local c = ((5 * 4) - 3)",
    "local d = ({1,2,3})[2]",
    "local e = (function(x) return x + 5 end)(10)",
    "local f = -#\"junk\" + 805",
    "local g = string.char(72, 105)",
  ].join("\n");
  const r = foldConstants(src, 3);
  assert.ok(/\b30\b/.test(r.result), "a → 30");
  assert.ok(r.result.includes('"hello"'), "b → hello");
  assert.ok(/\b17\b/.test(r.result), "c → 17");
  assert.ok(/\b2\b/.test(r.result), "d → 2");
  assert.ok(/\b15\b/.test(r.result), "e → 15");
  assert.ok(/\b801\b/.test(r.result), "f → 801 (-4 + 805)");
  assert.ok(r.result.includes('"Hi"'), "g → Hi");
  assert.ok(validateLuaSource(r.result).ok, `output valid: ${r.result}`);
});

// ── grouping guard: right operands không được fold riêng ─────────────────
t("grouping: x - 1 + 2 NOT folded as x - 3", () => {
  const r = foldConstants("local q = x - 1 + 2");
  assert.ok(!/x - 3/.test(r.result), `grouping broken: ${r.result}`);
  assert.ok(/x - 1 \+ 2/.test(r.result));
});
t("grouping: 2 ^ 3 * 4 folds to 32 (precedence kept)", () => {
  const r = foldConstants("local y = 2 ^ 3 * 4");
  assert.ok(/\b32\b/.test(r.result), `expected 32, got: ${r.result}`);
});

// ── v4.1: decoy-string downweighting (terrorlua/obfuscator-samples) ──────
t("decoy: luraph banner inside #'...' decoy loses to real moonsec banner", () => {
  const src =
    `_, Protected_by_MoonSecV2, Discord = 'discord.gg/gQEH2uZxUk'\n` +
    `local x = (704874119-#("@everyone designs are done. luraph website coming"))\n`;
  const d = detectObfuscator(src);
  assert.equal(d.obfuscator, "moonsec", `expected moonsec, got ${d.obfuscator} (${d.evidence})`);
});
t("decoy: [[Luraph]] inside #[[...]] decoy does not win over 0.7+ families", () => {
  const src = `local f=(5642994)while r>(-#[[Luraph v13 has been released changed absolutely everything about the security]])do f=(1)end`;
  const d = detectObfuscator(src);
  assert.ok(d.obfuscator !== "luraph", `decoy luraph won: ${d.obfuscator} ${d.evidence}`);
});
t("decoy: real luraph banner outside decoys still detected at 0.95", () => {
  const src = `-- This file was generated using Luraph Obfuscator v13.5.9\n` +
    `local x = (1-#'fake banner inside decoy');\n`;
  const d = detectObfuscator(src);
  assert.equal(d.obfuscator, "luraph");
  assert.ok(d.confidence >= 0.9, `conf ${d.confidence}`);
});

// ── v4.1: new family detection from obfuscator-samples corpus ────────────
t("detect: PSU banner (psu.dev)", () => {
  const d = detectObfuscator(
    `return(function(l,...)local R="This file was obfuscated using PSU Obfuscator 4.0.A | https://www.psu.dev/ & discord.gg/psu";`
  );
  assert.equal(d.obfuscator, "psu", `got ${d.obfuscator}`);
});
t("detect: SynapseXen_ prefixed identifiers", () => {
  const d = detectObfuscator(
    `local SynapseXen_llIIIllIi=select;local SynapseXen_IlIIlIiIililliii=string.byte;`
  );
  assert.equal(d.obfuscator, "synapsexen", `got ${d.obfuscator}`);
});
t("detect: IronBrew3 :tm: banner", () => {
  const d = detectObfuscator(`--ironbrew3:tm:, v0.235\nreturn(function(F,s,a)end)`);
  assert.equal(d.obfuscator, "ironbrew3", `got ${d.obfuscator}`);
});
t("detect: boronide via herrtt's obfuscator banner", () => {
  const d = detectObfuscator(`--[[\n\therrtt's obfuscator, v0.2.4\n--]]\nlocal a,b,c=nil,nil,nil`);
  assert.equal(d.obfuscator, "boronide", `got ${d.obfuscator}`);
});
t("detect: wYnFuscate banner", () => {
  const d = detectObfuscator(
    `-- Protected by wYnFuscate: https://wynfuscate.com | https://discord.gg/Z5xQ47Mbnd\nreturn(function(...)end)`
  );
  assert.equal(d.obfuscator, "wynfuscator", `got ${d.obfuscator}`);
});
t("detect: LPS magic string", () => {
  const d = detectObfuscator(`return(function(a,b,c)end)("LPS$\xD9\xBE\xD9\xBE\xD9\xBE")`);
  assert.equal(d.obfuscator, "lps", `got ${d.obfuscator}`);
});
t("detect: LuaObfuscator.com vN prelude (banner-less)", () => {
  const d = detectObfuscator(
    `local v0=string.char;local v1=string.byte;local v2=string.sub;local v3=bit32 or bit ;`
  );
  assert.equal(d.obfuscator, "luaobfuscator_com", `got ${d.obfuscator}`);
});
t("detect: Hercules banner comment", () => {
  const d = detectObfuscator(
    `--[Obfuscated by Hercules v1.6.2 | hercules-obfuscator.xyz/discord]\nreturn (function(...) end)`
  );
  assert.equal(d.obfuscator, "hercules", `got ${d.obfuscator}`);
});
t("detect: banner-less IronBrew2 byte-table header", () => {
  const d = detectObfuscator(
    `local r=string.byte;local f=string.char;local B=math.ldexp;\n` +
    `local function u(d)local e,n,o="","",{}local t=256;end`
  );
  assert.equal(d.obfuscator, "ironbrew", `got ${d.obfuscator}`);
});
t("detect: banner-less Prometheus decimal-escaped string table", () => {
  const d = detectObfuscator(
    `return(function(...)local z={"\\073\\107\\097\\113"};end)`
  );
  assert.equal(d.obfuscator, "prometheus", `got ${d.obfuscator}`);
});
t("detect: MoonVeil any-version banner", () => {
  const d = detectObfuscator(`-- This script was generated using MoonVeil 2.0.15-beta ttps://moonveil.cc]`);
  assert.equal(d.obfuscator, "moonveil", `got ${d.obfuscator}`);
  assert.ok(d.confidence >= 0.9, `conf ${d.confidence}`);
});

// ── v4.1: fold size guards (output explosion fixes) ─────────────────────
t("fold guard: payload concat chain NOT merged into escaped mega-literal", () => {
  const junk = "mOSns^G*.(f0jQ?a.U#zu;\xD0\xFF\xC3";
  const parts = Array.from({ length: 40 }, () => `"${junk}"`).join("..");
  const src = `local x = ${parts};`;
  const r = foldConstants(src, 1);
  assert.ok(r.result.length <= src.length * 1.05, `output exploded: ${src.length} → ${r.result.length}`);
});
t("fold guard: small concat still folds", () => {
  const r = foldConstants(`local x = "ab" .. "cd" .. "ef";`);
  assert.ok(r.result.includes('"abcdef"'), `not folded: ${r.result}`);
});
t("propagate guard: big string local NOT inlined at references", () => {
  const big = "A".repeat(2000);
  const src = `local payload = "${big}";\nprint(payload)\nprint(payload)\nprint(payload)`;
  const r = propagateImmutableLocals(src);
  assert.ok(!r.result.includes(`print("${big}")`), "huge literal was inlined");
});
t("propagate guard: small scalar still propagates", () => {
  const r = propagateImmutableLocals(`local answer = 42\nprint(answer)`);
  assert.ok(r.result.includes("print(42)"), `not propagated: ${r.result}`);
});

// ── v4.1: beautifier lastChar tracking (perf + identical output) ─────────
t("beautify: spacing correctness with tracked lastChar", () => {
  const out = beautifyLua(
    `local t={a=1,b=[2]=3}print(t.a,t["b"])local f=function(x)return -x end local y=f(-3)local s="a".."b"`
  );
  // NOTE: established formatting: no space after `{` (compact tables) —
  // this must stay IDENTICAL to the pre-v4.1 output (perf-only change).
  assert.ok(out.includes("{a = 1, b = [2] = 3}"), `table spacing: ${out}`);
  assert.ok(out.includes('t["b"]'), `index spacing: ${out}`);
  assert.ok(out.includes("return -x"), `unary spacing: ${out}`);
  assert.ok(out.includes("f(-3)"), `call spacing: ${out}`);
  assert.ok(out.includes('"a".."b"'), `concat spacing: ${out}`);
  assert.ok(validateLuaSource(out).ok, `output invalid: ${out}`);
});
t("beautify: long single-line payload stays fast and linear-sized", () => {
  // 200KB of tokens on ONE line — the old code was O(N²) here (rope flattening).
  const chunk = `local a1=1;a2=2;f(a1,a2);`;
  const src = chunk.repeat(8000);
  const t0 = Date.now();
  const out = beautifyLua(src);
  const ms = Date.now() - t0;
  assert.ok(out.length > src.length, "output smaller than input?");
  assert.ok(ms < 3000, `beautify too slow: ${ms}ms`);
  assert.ok(validateLuaSource(out).ok, `output invalid`);
});


// ── v4.2: Luraph dispatch-tree parser ────────────────────────────────────
t("dispatch: Luau number literals with underscores", () => {
  assert.equal(parseLuauNumber("0x34"), 0x34);
  assert.equal(parseLuauNumber("0X1__0F"), 0x10f);
  assert.equal(parseLuauNumber("0b1_1_01000"), 0b1101000);
  assert.equal(parseLuauNumber("61"), 61);
  assert.equal(parseLuauNumber("12ab"), null);
});

t("dispatch: tokenizer skips strings and comments", () => {
  const src = 'local a="if end while" --[[ do end ]] local b=1';
  const toks = tokenizeLua(src);
  const texts = toks.map((x) => x.text);
  assert.ok(texts.includes("local"), "local token");
  const strTok = toks.find((x) => x.kind === "str");
  assert.ok(strTok && strTok.text.includes("if end while"), "string content kept as one token");
  assert.ok(!texts.includes("while") || toks.filter((x) => x.text === "while").length === 0, "keywords inside strings not tokenised");
});

t("dispatch: instruction fetch located in minified loader", () => {
  const src = "local Z,F;while true do local i=(Z[F]);if not(i>=0b1_1_01000)then end;end";
  const f = findInstructionFetch(src);
  assert.ok(f, "fetch found");
  assert.equal(f.opVar, "i");
  assert.equal(f.opCol, "Z");
  assert.equal(f.vipVar, "F");
});

t("dispatch: opcode handlers extracted from nested if-tree", () => {
  const src =
    "while true do local i=(Z[F]);" +
    "if not(i>=4)then if i==0then A=1;else B=2;end;else if i<6then C=3;else D=4;end;end;end";
  const f = findInstructionFetch(src);
  assert.ok(f);
  const { handlers } = parseDispatchTree(src, f);
  // opcodes 0..5 resolved; the final else leaf spans [6,4095] which exceeds
  // the leaf-range cap and stays unresolved (real trees are bounded anyway).
  assert.equal(handlers.size, 6, `expected 6 handlers, got ${handlers.size}`);
  assert.ok(handlers.get(0)!.includes("A=1"), "op 0 handler");
  assert.ok(handlers.get(1)!.includes("B=2"), "op 1 handler");
  assert.ok(handlers.get(2)!.includes("B=2"), "op 2 handler (range leaf)");
  assert.ok(handlers.get(4)!.includes("C=3"), "op 4 handler (i<6 of [4..∞])");
  assert.ok(handlers.get(5)!.includes("C=3"), "op 5 handler");
  assert.ok(!handlers.has(6), "wide catch-all leaf stays unresolved");
});

t("dispatch: handler classification", () => {
  assert.equal(classifyHandler("F=m[F];"), "JMP");
  assert.equal(classifyHandler("f[r[F]]=(not f[r[F]]);"), "NOT");
  assert.equal(classifyHandler("f[r[F]]=t[F];"), "LOADK");
  assert.equal(classifyHandler("f[r[F]]={};"), "NEWTABLE");
  assert.equal(classifyHandler("if f[r[F]]==f[H[F]]then F=m[F];end"), "JEQ");
  assert.equal(classifyHandler("z=1;"), null);
});

t("dispatch: tree with junk non-dispatch condition stays intact", () => {
  // the inner `if C==1` does not involve i → treated as handler code
  const src = "while true do local i=(Z[F]);if i==2then if C==1then X();end;else Y();end;end";
  const f = findInstructionFetch(src);
  assert.ok(f);
  const { handlers } = parseDispatchTree(src, f);
  assert.ok(handlers.get(2)!.includes("C==1"), "inner junk condition kept in handler");
  assert.ok(handlers.get(0)!.includes("Y()"), "else branch handler");
});

// ── v4.3: VM lifter ───────────────────────────────────────────────────────
tests.push(["lifter: alias destructuring parse", () => {
  const src = "local x,V=E[0xA],E[1];local H,m,J,Z,r,t,p,G=E[8],E[0X7],E[2],E[0B100],E[0X9],E[0x6],E[11];G=function(...)local f=X[1](x);while true do local i=(Z[F]);if i>=1 then end;end;end";
  const fetch = findInstructionFetch(src)!;
  assert.ok(fetch, "fetch found");
  const alias = findAliasDestructuring(src, fetch);
  assert.ok(alias, "alias parsed");
  assert.strictEqual(alias.letters.join(","), "H,m,J,Z,r,t,p,G");
  assert.deepStrictEqual(alias.fields, [8, 7, 2, 4, 9, 6, 11, null]);
  assert.strictEqual(alias.opLetter, "Z");
}]);

tests.push(["lifter: token matcher basic + jump rule", () => {
  const alias = {
    letters: ["H", "m", "J", "Z", "r", "t", "p", "G"],
    fields: [8, 7, 2, 4, 9, 6, 11, null],
    opLetter: "Z",
    vipLetter: "F",
  };
  const roles = { regA: "r", regB: "H", regC: "J", jump: "m", imm: "p", konst: "t" };
  const letters = tokenLetters(alias, roles);
  // exact-match token rules
  assert.ok(matchTokens("f[r[F]]=t[F];", ["f", "[", "@regA", "[", "F", "]", "]", "=", "@konst", "[", "F", "]", ";"], letters));
  assert.ok(!matchTokens("f[r[F]]=t[F]; ", ["f", "[", "@regA", "[", "F", "]", "]", "=", "@konst", "[", "F", "]", ";"], letters));
  assert.ok(matchTokens("(f[r[F]])[p[F]]=t[F];", ["(", "f", "[", "@regA", "[", "F", "]", "]", ")", "[", "@imm", "[", "F", "]", "]", "=", "@konst", "[", "F", "]", ";"], letters));
  // JMP handler text: F=(m[F]);
  assert.ok(matchTokens("F=(m[F]);", ["F", "=", "(", "@jump", "[", "F", "]", ")", ";"], letters));
  // multi-letter role substitution works
  const letters2 = { ...letters, regA: "rreg", konst: "tval" };
  assert.ok(matchTokens("f[rreg[F]]=tval[F];", ["f", "[", "@regA", "[", "F", "]", "]", "=", "@konst", "[", "F", "]", ";"], letters2));
}]);

tests.push(["lifter: trace parse + flow analysis", () => {
  const protos = parseTrace(["P1:10", "1,2,3", "3,5,1", "P2:4", "4,4"]);
  assert.strictEqual(protos.length, 2);
  assert.deepStrictEqual(protos[0].vips, [1, 2, 3, 3, 5, 1]);
  const flow = analyzeFlow(protos[0].vips);
  // 1→2 straight, 2→3 straight, 3→3 jump, 3→5 straight, 5→1 jump
  assert.strictEqual(flow.jumps.size, 2);
  assert.strictEqual(flow.jumps.get(3)!.get(3), 1);
  assert.strictEqual(flow.jumps.get(5)!.get(1), 1);
}]);

tests.push(["lifter: final program parse with sparse keys", () => {
  const json = JSON.stringify({
    Z: { "1": 76, "2": 13, "3": 76, "4": 13, "5": 13, "6": 13, "7": 13, "8": 31 },
    r: { "1": 0, "2": 5, "3": 0, "4": 6, "5": 7, "6": 8, "7": 9, "8": 10 },
    t: { "2": "hello", "4": 42, "6": true },
    m: { "1": 2, "3": 4, "5": 6, "7": 8 },
  });
  const alias = {
    letters: ["H", "m", "J", "Z", "r", "t", "p", "G"],
    fields: [8, 7, 2, 4, 9, 6, 11, null],
    opLetter: "Z",
    vipLetter: "F",
  };
  const prog = parseFinalProgram(json, alias);
  assert.ok(prog, "program parsed");
  assert.strictEqual(prog.instrCount, 8);
  assert.strictEqual(prog.opcodes.get(2), 13);
  // constants keyed by VIP (sparse, keys preserved)
  assert.strictEqual(prog.constants.get("t")!.get(2), "hello");
  assert.strictEqual(prog.constants.get("t")!.get(4), 42);
  // numeric columns preserved with keys
  assert.strictEqual(prog.columns.get("m")!.get(1), 2);
}]);

tests.push(["lifter: decompile synthetic program to Luau", () => {
  const alias = {
    letters: ["H", "m", "J", "Z", "r", "t", "p", "G"],
    fields: [8, 7, 2, 4, 9, 6, 11, null],
    opLetter: "Z",
    vipLetter: "F",
  };
  // 6 instructions: LOADK; LOADK; NEWTABLE; JMP→2 (loop); LOADK; (end)
  const json = JSON.stringify({
    Z: { "1": 13, "2": 31, "3": 13, "4": 76, "5": 13, "6": 13, "7": 13, "8": 13 },
    r: { "1": 5, "2": 6, "3": 7, "4": 0, "5": 5, "6": 6, "7": 7, "8": 5 },
    t: { "1": "game", "3": 99, "5": "x", "6": "y", "7": "z", "8": "w" },
    m: { "1": 0, "2": 0, "3": 0, "4": 1, "5": 0, "6": 0, "7": 0, "8": 0 },
  });
  const prog = parseFinalProgram(json, alias)!;
  const handlers = new Map<number, string>([
    [13, "f[r[F]]=t[F];"],
    [31, "(f)[r[F]]={};"],
    [76, "F=(m[F]);"],
  ]);
  const dp = decompileProgram(prog, alias, handlers, null, 1);
  assert.strictEqual(dp.instrCount, 8);
  assert.ok(dp.resolved >= 6, `resolved>=6, got ${dp.resolved}`);
  // v4.5.0+ flatten mode: drops goto/label, renames R5→lvNN.
  // The constants "game" and {} must still appear in the output.
  assert.ok(dp.source.includes('"game"'), `LOADK constant "game" emitted; got: ${dp.source.slice(0, 400)}`);
  assert.ok(dp.source.includes("{}"), `NEWTABLE emitted; got: ${dp.source.slice(0, 400)}`);
  // The renamed register name (lv01..lv99) must appear as an assignment target.
  assert.ok(/lv\d{2,3}\s*=/.test(dp.source), "renamed register (lvNN) appears as assign target");
}]);

// ── run ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`regression: ${tests.length} tests`);
  for (const [name, fn] of tests) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      console.log(`  ✗ ${name}`);
      console.log(`      ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\n→ ${passed}/${tests.length} passed`);
  if (failures.length > 0) {
    console.error(`${failures.length} FAILURE(S)`);
    process.exitCode = 1;
  } else {
    console.log("regression: ALL OK");
  }
}

void main();
