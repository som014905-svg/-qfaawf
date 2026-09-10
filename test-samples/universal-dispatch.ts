import { flattenStateDispatchers } from "../src/passes/state-dispatch-flattener";

const direct = `local state = 1\nwhile true do\n if state < 2 then\n   x=1; state=2\n elseif state < 3 then\n   x=2; state=1\n else return end\nend`;
const affine = `local state = 8\nwhile true do\n state = 20 - state\n if state < 14 then\n   x=1; state=9\n elseif state < 16 then\n   return\n else x=2; state=10 end\nend`;
for (const [name, src] of [["direct",direct],["affine",affine]] as const) {
  const r = flattenStateDispatchers(src, { maxLoops: 8, maxStates: 32, maxOutput: 20_000 });
  if (!r.changed || !/state\s*==/.test(r.result)) throw new Error(`${name}: dispatcher was not flattened`);
}
console.log("universal-dispatch: ok");
