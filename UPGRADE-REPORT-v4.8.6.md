# v4.8.6 upgrade report — HeavyWeightFishing specialized profile

## Target

Dedicated profile added for:
`https://raw.githubusercontent.com/joustingmatch/Ouroboros/main/games/heavyweightfishing.lua`

The supplied deobfuscation package identified the sample as a WeAreDevs v1.0.0 layout with a 933-entry string table, a three-range reversal shuffle, an arithmetic-noise offset accessor, a custom 64-symbol map, and a VM/cache layer. The supplied analysis reports examples such as `B(-44122) -> "__index"`, `B(-44556) -> "__gc"`, and `B(-44090) -> "__len"`.

## Added

- `src/deobfuscators/heavyweightfishing.ts`
- dedicated high-confidence fingerprint for the target shape
- exact table-shuffle replay
- custom base64/64-symbol decoder
- arithmetic-expression evaluation for the target `B(...)` accessor
- literal `B(...)` inlining
- conservative handoff to numeric-cache and constant-fold passes
- exact target sample in `engine/samples/heavyweightfishing.lua`
- dedicated regression/smoke test

## Deliberate limits

The supplied external analysis also used dynamic sandbox execution, Roblox environment mocks, remote library loading and key-system manipulation. Those techniques are not embedded in this engine. The specialized profile remains static/source-to-source.

## Verification

- Independently reproduced the target's 933-entry table extraction and shuffle.
- Independently reproduced the target's Q map (64 entries).
- Verified known mappings `B(-44122)`, `B(-44556)`, and `B(-44090)`.
- Archive integrity check performed after repacking.
- Full TypeScript typecheck could not run because the extracted environment lacks `@types/node`; this is reported as an environment limitation, not a passing check.
