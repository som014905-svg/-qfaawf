import assert from "node:assert/strict";
import { detectObfuscator } from "../src/detectors/detector";

const cases: Array<[string, RegExp]> = [
  ["-- Obfuscated by IronBrew2\nlocal vm_test = {}", /ironbrew/i],
  ["--[[ This file was protected using Luraph Obfuscator v14.8 ]]", /luraph/i],
  ["-- MoonSec V3\nlocal x = 1", /moonsec/i],
  ["-- MoonVeil v2.1\nlocal x = 1", /moonveil/i],
  ["-- Obfuscated by LuaObfuscator.com\nlocal x = 1", /luaobfuscator/i],
  ["-- Prometheus V2\nlocal x = 1", /prometheus/i],
  ["-- WeAreDevs obfuscator\nlocal x = 1", /wearedevs/i],
  ["-- ironbrew3:tm: v3.0\nlocal x = 1", /ironbrew3/i],
  ["--[ Obfuscated using ironveil v1 - https://discord.gg/qKyZKDWZRQ ]](\n)", /ironveil/i],
];

for (const [src, expected] of cases) {
  const d = detectObfuscator(src);
  assert.ok(expected.test(d.obfuscator), `${d.obfuscator}: ${d.evidence}`);
}
console.log(`corpus-smoke: ${cases.length}/${cases.length} detector fixtures PASS`);
