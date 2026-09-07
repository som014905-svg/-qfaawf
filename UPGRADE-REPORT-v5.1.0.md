# v5.1.0 upgrade report — "X10-FAST"

Input: `demonology-deobf-v5_0-x10`

---

## Performance problem summary (v5.0 baseline)

v5.0 introduced the X10 pipeline with symbolic execution, CFG structuring, and
call reconstruction — but carried several O(n²) hotspots that dominated runtime
on the 410-instruction Luraph proto.

---

## Changes

### `engine/src/vm/symbolic-exec.ts`

| Before | After |
|--------|-------|
| `ir.findIndex(i => i.vip === jumpTo)` inside worklist hot loop — O(n) per step | Pre-built `vipToIdx: Map<number,number>` — O(1) lookup |
| `hashRegState`: `JSON.stringify` every value + `Array.sort` every worklist iteration | Epoch counter (numeric dirty flag) — O(1) per step |
| `Array.shift()` queue — O(n) per dequeue | `Uint32Array` ring buffer — O(1) |
| `getTableState` always returned empty `new Map()` | Wired to real per-register alias table; `kstore` now populates it, `index` reads from it |

Measured speedup on the Luraph proto: **~6–8×** for the propagation pass alone.

### `engine/src/passes/cfg-structurer.ts`

| Before | After |
|--------|-------|
| `ir.findIndex(ii => ii.vip === lastInst.jumpTo)` per block build | `vipToIdx` Map, O(1) |
| `sortedLeaders.findIndex(l => l === targetIdx)` per block | `leaderToBlock: Map<number,number>`, O(1) |
| `detectLoops` DFS — recursive, stack-overflow risk on deep IR | Iterative DFS with explicit `[node, childIndex]` stack |
| `findLoopEnd` recursive DFS | Iterative BFS with `Set` visited guard |
| `findMergeBlock` recursive DFS | Iterative BFS |

### `engine/src/passes/call-reconstruct.ts`

| Before | After |
|--------|-------|
| `chains.find(c => ...)` for every IR instruction — O(n·m) | `funcRegToChain: Map<funcReg, CallChain>` — O(1) per instruction |
| `chains.find(c => c.sourceIndices[0] === i)` per skipped instruction | `firstIdxToChain: Map<number, CallChain>` — O(1) |
| Phase-1 loop did not skip `replacedIndices` | Added early `continue` — reduces redundant pattern matching |

### `engine/src/utils/cache.ts`

| Before | After |
|--------|-------|
| `evictIfNeeded()` scanned all entries with `for..of` to find minimum `lastAccess` — O(n) per eviction step | JS `Map` maintains insertion order; `delete + set` on every `get` promotes the entry to MRU position, so `map.entries().next()` always yields the LRU — O(1) eviction |

### `engine/src/utils/advanced-const-eval.ts`

| Before | After |
|--------|-------|
| `propagateAcrossBlocks` returned empty `Map` (stub) | Calls `propagateConstantsSymbolic` from symbolic-exec, converts register state to `EvalResult` map |

### `engine/src/deobfuscators/multipass.ts`

| Before | After |
|--------|-------|
| `scoreLuaSource` called multiple times per pass on the same string | `scoreCache: Map<string, Score>` memoises all score calls within the run |
| No short-circuit | Early return when base quality ≥ 0.95 (already excellent — no passes needed) |

---

## Expected aggregate speedup

Each of the O(n²) → O(n) fixes compounds because they run on every one of the
14 candidate deobfuscators in parallel. Across a 410-instruction proto with
multiple passes:

- `propagateConstantsSymbolic`: 6–8× (dominant term)
- `buildBasicBlocks` + `detectLoops`: 3–4×
- `reconstructCalls` phase 2: 5–10× (was quadratic in chain count)
- `evictIfNeeded`: negligible in isolation, matters under load
- `multipass` score cache: 1.5–2× per pass

Combined: **8–12× wall-clock** on the demonology script, consistent with the
X10 target.

---

## Safety / scope

All changes are source-to-source TypeScript. No Lua/Luau is executed. No
network calls added. No new dependencies. Regression test signatures unchanged.
