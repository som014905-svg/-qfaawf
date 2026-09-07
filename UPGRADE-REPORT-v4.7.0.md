# Upgrade report — v4.7.0

## Scope

Corpus-driven upgrade against the public `terrorlua/obfuscator-samples` repository. The repository currently exposes the 15 labeled families: 77fuscator, Boronide, Hercules, IronBrew2, Ironbrew1, Ironbrew3, LPS, LuaObfuscator, Luraph, MoonSec, MoonVeil, PSU, Prometheus, SynapseXen, and wYnFuscate. It also contains many per-version/subdirectory samples (for example Luraph v2→v15 and MoonSec V2/V3).

## Code changes

- Added `src/passes/static-resolve.ts`.
- Static scalar table lookup inlining (`T[1]` / alias-of-table).
- Pure standard-library alias normalization (`local ch = string.char; ch(...)`).
- Safe top-level literal `loadstring(...)()` unwrapping; nested/dynamic wrappers are left untouched.
- Generic deobfuscator now runs static resolution; the existing validated multi-pass performs provable dispatcher recovery.
- Multi-pass cleanup repeats static table/stdlib resolution before CFF recovery.
- Added regression tests for all new transforms.
- Bumped engine package version to 4.7.0.

## Safety properties

The new pass is source-to-source and does not execute untrusted Lua to discover values. Static table rewrites require scalar literals and single declaration; CFF reuse remains gated by the existing validator.

## Validation in this environment

- Modified TypeScript files successfully transpile with the installed TypeScript compiler.
- Full dependency install/typecheck could not complete because this environment has no working package registry/DNS access; the project dependencies (`tsx`, `wasmoon`, `luau-web`, `@types/node`) are not installed locally.
