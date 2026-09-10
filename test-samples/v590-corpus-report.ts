import { readFileSync, writeFileSync } from "node:fs";
import { analyzeBinaryTreeDispatch } from "../src/passes/binary-tree-dispatch";
import { buildDispatcherGraph } from "../src/vm/dispatcher-graph";
import { abstractExecuteLua } from "../src/vm/abstract-interpreter";
import { measureDispatcherResidue } from "../src/utils/dispatcher-metrics";

const path = new URL("../samples/heavyweightfishing.deobf.lua", import.meta.url);
const source = readFileSync(path, "utf8");
const report = {
  sample: "heavyweightfishing.deobf.lua",
  version: "v5.9.0",
  dispatcherCandidates: analyzeBinaryTreeDispatch(source, 96),
  dispatcherGraph: buildDispatcherGraph(source, 96),
  abstractState: abstractExecuteLua(source, 6000),
  metrics: measureDispatcherResidue(source),
};
writeFileSync(new URL("../samples/heavyweightfishing.v590.analysis.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(`v590-corpus-report: wrote ${report.dispatcherCandidates.length} dispatcher candidate report(s)`);
