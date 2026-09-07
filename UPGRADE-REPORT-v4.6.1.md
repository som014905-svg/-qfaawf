# Deobf engine update — v4.6.1

## What was fixed

1. **Normal emission no longer flattens control flow**
   - `structureProgram()` now emits through the CFG-aware `structureAndEmit()` path.
   - VM jumps, conditional branches, labels, and returns are preserved.
   - `flattenAndEmit()` stays available only as an explicit debug/fallback function.

2. **Coverage metric**
   - Counts surviving instructions that contain statements, jumps, conditional jumps, or returns.

3. **IR type error**
   - Fixed `baseStmt` narrowing in `collapseGlobalChains()` so `.src` is only accessed on an assignment statement.

4. **Metadata/docs**
   - Engine version bumped to 4.6.1.
   - Changelog and README updated.

## Current limitation

The engine can only recover source semantics that are actually recoverable from the decoded VM/trace. A static pass cannot guarantee the original author variable names or reconstruct dynamic payload behavior that is never observed. The next quality jump is stronger opcode inference + trace-assisted register/data-flow recovery.

## Validation

Core VM TypeScript modules pass a no-emit TypeScript compilation check:

`src/vm/luraph-structure.ts`
`src/vm/luraph-lifter.ts`
`src/vm/luraph-finalize.ts`
`src/vm/luraph-dispatch.ts`
