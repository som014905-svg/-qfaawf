import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HeavyWeightFishingDeobfuscator } from "../src/deobfuscators/heavyweightfishing";

const input = readFileSync(new URL("../samples/heavyweightfishing.lua", import.meta.url), "utf8");
const deob = new HeavyWeightFishingDeobfuscator();
const detected = deob.detect(input);
assert.ok(detected, "HeavyWeightFishing profile should detect the supplied sample");
assert.equal(detected?.obfuscator, "heavyweightfishing");
assert.ok((detected?.confidence ?? 0) >= 0.9);

const result = await deob.deobfuscate({
  input,
  baseName: "heavyweightfishing",
  source: "attachment",
  log: () => undefined,
});

assert.equal(result.success, true);
assert.ok(result.confidence > 0.5);
assert.match(result.output, /HeavyWeightFishing specialized static deobfuscation profile/);
assert.ok(result.artifacts?.some((x) => x.includes("HeavyWeightFishing specialized string table")));
assert.ok(result.notes?.some((x) => /B\(\.\.\.\) lookups/.test(x)));

console.log("heavyweightfishing-specialized: OK");
