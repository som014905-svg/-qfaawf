
# v5.7.0 — Corpus updater reliability and validation notes

- Reworked `scripts-update-corpus.ts` to traverse GitHub's Contents API by
  directory instead of relying on the repository-wide recursive Git tree,
  which can return HTTP 500 for the current public corpus size.
- The generated manifest now records the discovered top-level families and
  prints the family count in the update summary.
- Verified the updater against a small public repository and refreshed the
  documentation to distinguish tested support from unverified obfuscator
  names. The current `terrorlua/obfuscator-samples` tree has no XON family.
- Added a source-tail guard to multi-pass cleanup so Luraph v15 candidates
  cannot be accepted after being truncated during generic formatting.
- Expanded conservative readability renaming to include local/parameter names
  such as `v`, `i`, `j`, and `k`; globals, properties, table keys, and
  reassigned names remain protected.
- Property occurrences no longer suppress renaming of safe local occurrences
  with the same short name. The Luraph v15 sample now renames 55 cryptic
  locals/registers to `arg*`/`num*` names while leaving property accesses intact.
- Readability naming now refines generic arguments by usage: indexed values use
  `tbl*`, callable values use `fn*`, arithmetic/state-like values use `num*`,
  and unknown values use `value*`.

# v5.5.0 — Hercules deobfuscator + Clyde register-VM + Dava fork variants

## New: HerculesDeobfuscator (`hercules.ts`)
- Targets `zeusssz/hercules-obfuscator` v1.x–v2.x output statically.
- **Dead-code elimination**: strips provably-dead `if false then local X=N end`,
  `while false do local X=N break end`, and `if true then local X=N end` blocks.
- **Caesar cipher decode**: detects and evaluates both IIFE-form and named-function-form
  Caesar shift encoders (`string.byte(s,i) ± k) % 256`), recovering the original strings
  even when the IIFE uses aliased stdlib names. Brute-forces both `+k` and `-k` directions,
  keeps the candidate with printable-ratio ≥ 80%.
- **Glob alias resolution**: resolves Hercules top-level `ALIAS = string.char` / `table.concat`
  / `math.floor` etc. assignments so the Caesar decoder and constant-fold passes see plain
  stdlib calls.
- Wired into `ALL_DEOBFUSCATORS` in the orchestrator and given its own `ObfuscatorFamily`
  mapping (no longer falls back to `generic`).
- Added to `ObfuscatorId` in `types.ts`.

## Upgraded: ModernVMDeobfuscator (`modern-vm.ts`)
- **Clyde register-VM detection**: recognises the sfr-development register-VM output shape
  (`local __regs={}; local __pc=0; while true do …`) and stack-VM shape.
- **Clyde LZMA maximum-mode detection**: flags LZMA-compressed payloads and annotates output
  rather than silently failing.
- **Clyde VM constant extraction**: folds `local NAME = {78,101,119,...}` constant tables
  inside the VM header back to string literals when the printable-ratio check passes.
- **Dava fork variants**: `foldDavaCharArrayFactories` now also matches the `table.concat`-based
  variant and the `{i,k,f,p}` (no `u` field) proto shape in the detector.

## Upgraded: detector.ts
- Hercules: added structural patterns for dead-code clusters, `while false do` blocks,
  glob `string.char` alias, and Caesar IIFE — detection now works on banner-less output.
- Clyde: added register-VM, stack-VM, and LZMA maximum-mode structural patterns.
- `ObfuscatorFamily`: added `"hercules"` and `"modern_vm"` variants; `clyde`/`clyde_protection`
  now route to `modern_vm` family instead of `generic`.

## Source-only guarantee maintained
All new passes are purely source-to-source; no Lua/Luau execution, no remote fetching,
no environment or key bypass, no speculative VM lifting without proven-safe literal operations.
# v5.4.0 — Modern VM static-pattern expansion

- Added `ModernVMDeobfuscator` for newer public Luau VM patterns documented by Clyde Protection and `sudo-dava25/LuaU-obfuscator`.
- Added static folding for Clyde-style XOR string factories (`byte[] ^ key`) without executing the protected program.
- Added static folding for Dava-style character-array string factories and nested custom-VM constants.
- Wired the modern VM pass into the orchestrator and recursive multi-pass cleanup so recovered literals feed existing constant propagation and readability passes.
- Added conservative structural detection for randomized-name custom VMs; ambiguous VM bodies are preserved instead of speculatively devirtualized.
- Source-only operation remains enforced: no input Lua/Luau execution, no remote payload execution, and no anti-tamper bypass.

# v5.2.0 — X10-DEEP

- Added bounded portfolio refinement: up to 4 strongest deobfuscation candidates are independently passed through deeper multi-pass cleanup before final ranking.
- Increased multi-pass convergence budget from 8 to 12 passes and raised the early-exit quality gate to 98.5%.
- Lowered refinement acceptance threshold so small but meaningful readability/constant-recovery improvements are retained.
- Kept source-only/static behavior; no untrusted Lua is executed by the refinement layer.

# v4.8.7

- Added `foldEncodedStringTableLiterals()` for dense immutable base64 string tables, motivated by the table-of-encoded-fragments shape shown in public Prometheus examples.
- Wired the pass into generic cleanup and the shared multi-pass pipeline; it only rewrites literal table entries when strict printable/Lua-ish and table-density checks pass.
- Added regression coverage and kept the corpus updater/source samples non-executable.

# v4.8.6

- Added a dedicated `HeavyWeightFishingDeobfuscator` for the public `joustingmatch/Ouroboros` `games/heavyweightfishing.lua` sample.
- Replays the target's three reversal shuffle passes on the 933-entry `O` string table.
- Parses the target's arithmetic-noise `B(B)` offset accessor (`421764+-377161` → `44603`).
- Parses the embedded `Q` 64-symbol map and decodes the custom base64-style string table statically.
- Inlines literal `B(...)` references and then feeds the result through existing conservative cache/constant-fold cleanup.
- Adds the exact target as a regression sample and a dedicated smoke test.
- Does not execute Roblox/Lua, load remote libraries, bypass key systems, or use dynamic tracing.

# v4.8.5

- Hardened WeAreDevs numeric offset-table folding to evaluate arithmetic-noise offsets and literal call arguments with the safe constant evaluator.
- Hardened numeric VM-cache accessor folding to accept arithmetic-noise numeric keys instead of only bare literals.
- Added regression coverage mirroring the supplied HeavyWeightFishing sample shape (`421764+-377161`, `-439191+394926`).
- No dynamic Lua/Luau execution, network fetching, or environment/key bypassing was added.

# v4.8.4

- Added conservative WeAreDevs numeric offset-table lookup inlining.
- Added conservative numeric VM-cache accessor inlining for literal cache writes.
- Added regression fixtures for both patterns.
- No input Lua/Luau execution is performed by these passes.

# v4.8.3

- Hardened standard-library alias resolution to follow up to 8 safe alias hops.
- Added cycle/depth guards so cyclic aliases are rejected instead of guessed.
- Added regression coverage for multi-hop bracket aliases such as `a -> b -> c["bxor"]`.

## 4.8.2 — corpus-driven static decoder improvements

- Added `foldSimpleXorDecoderFunctions()` for the literal XOR string-decoder shape observed in LuaObfuscator samples.
- Expanded safe stdlib alias resolution to bracket-indexed members such as `string["char"]`, `table["insert"]`, and `bit32["bxor"]`.
- Added one-hop alias-chain resolution for `bit32 or bit` wrappers.
- Wired the XOR decoder pass into both generic cleanup and the shared multi-pass pipeline.
- Added a regression fixture for the static XOR decoder.
- The new pass is source-to-source and literal-only; it does not execute untrusted Lua.

# Changelog

## 4.8.1 — corpus refresh tooling + test harness fix

- Added `corpus/manifest.json` tracking the current top-level families and Luraph version matrix observed in `terrorlua/obfuscator-samples`.
- Added `scripts-update-corpus.ts` to mirror the upstream Lua/Luau corpus into `corpus/upstream/` and emit SHA-256/upstream-SHA metadata.
- Added working `test-samples/detect-batch.ts` and `test-samples/deobf-batch.ts`; `package.json` previously referenced these files without shipping them.
- Added `corpus:update` package script.
- Kept corpus refresh/download separate from execution: downloaded samples are treated as untrusted source text and are never run by the updater.

## 4.8.0

- Added `normalizeEnvStdlibAliases()` in `src/passes/static-resolve.ts`.
- Resolves safe `getfenv()` indirection such as `env["string"]["\\099\\104\\097\\114"]` to `string.char` before constant folding.
- Wired the pass into both the generic engine and the shared multi-pass pipeline.
- Added a regression case in `test-samples/static-resolve.ts`.
