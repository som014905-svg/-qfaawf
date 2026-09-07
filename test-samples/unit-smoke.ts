import { foldConstants } from "../src/passes/constant-fold";
import assert from "node:assert/strict";
import { isProbablyUrl, fetchFromUrl } from "../src/utils/fetcher";
import { extractScriptUrls } from "../src/chain";
import { validateLuaSource } from "../src/utils/validate";
import { detectObfuscator } from "../src/detectors/detector";

assert.equal(isProbablyUrl("https://example.com/a.lua"), true);
assert.equal(isProbablyUrl("  file.lua"), false);

const urls = extractScriptUrls(`local u = "https://example.com/a.lua"; loadstring(game:HttpGet(u))()`);
assert.equal(urls[0]?.usage, "loadstring");
assert.equal(urls[0]?.score, 95);

const directUrls = extractScriptUrls(`loadstring(game:HttpGet("https://example.com/direct.lua"))()`);
assert.equal(directUrls[0]?.usage, "loadstring");
assert.equal(directUrls[0]?.score, 100);

const concatenatedUrl = extractScriptUrls(
  `loadstring(game:HttpGet("https://example.com/" .. "script.lua"))()`
);
assert.equal(concatenatedUrl[0]?.url, "https://example.com/script.lua");
assert.equal(concatenatedUrl[0]?.usage, "loadstring");
assert.equal(concatenatedUrl[0]?.dynamic, false);

assert.equal(validateLuaSource("local x = (1 + 2)\n").ok, true);
assert.equal(validateLuaSource("local x = (1 + 2\n").ok, false);

const d = detectObfuscator("-- Obfuscated by IronBrew2\nlocal vm_test = {}\n");
assert.equal(d.obfuscator, "ironbrew");

console.log("unit-smoke: OK");

import { propagateImmutableLocals } from "../src/passes/advanced-cleanup";

const propagation = propagateImmutableLocals(`local a = "hello"\nlocal b = 42\nprint(a .. b)\n`);
if (!propagation.result.includes(`print("hello" .. 42)`)) {
  throw new Error("immutable-local propagation regression");
}

const reassigned = propagateImmutableLocals(`local a = "hello"\na = "world"\nprint(a)\n`);
if (reassigned.changed !== 0 || !reassigned.result.includes("print(a)")) {
  throw new Error("reassigned locals must not be propagated");
}

const callGuard = foldConstants(`local b = 42\nreturn tostring(b + 1)\n`, 3);
if (!callGuard.result.includes('return "43"') || /tostring\s+43\b/.test(callGuard.result)) {
  throw new Error("call folding regression");
}
