import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeBinaryTreeDispatch, recoverBinaryTreeDispatch } from "../src/passes/binary-tree-dispatch";
import { measureDispatcherResidue } from "../src/utils/dispatcher-metrics";
import { abstractExecuteLua } from "../src/vm/abstract-interpreter";

const sample = readFileSync(new URL("../samples/heavyweightfishing.deobf.lua", import.meta.url), "utf8");
const analyses = analyzeBinaryTreeDispatch(sample, 96);
assert.ok(analyses.length >= 1, "expected at least one numeric dispatcher candidate");
assert.ok(analyses.some((x) => x.variables.length === 1));
const r = recoverBinaryTreeDispatch(sample, { maxLeaves: 64, maxRewrites: 2 });
assert.equal(typeof r.result, "string");
assert.ok(r.analyses.length >= 1);
const metrics = measureDispatcherResidue(sample);
assert.ok(metrics.dispatcherResidue >= 0 && metrics.dispatcherResidue <= 1);
const abs = abstractExecuteLua(sample, 2000);
assert.ok(abs.state.constantsResolved >= 0);
console.log(`v590-structural: OK (${analyses.length} candidate(s), ${r.changed} rewrite(s))`);
