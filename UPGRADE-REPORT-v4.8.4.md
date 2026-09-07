# v4.8.4 upgrade report

## Source review

The supplied Z.ai 5.3 agent analysis reports a WeAreDevs v1.0.0 sample where the existing engine recovered the outer structure/string table but left an additional numeric lookup/cache layer and VM/anti-tamper structure. The report specifically identifies `O[x + 44603]`-style lookup behavior and a decrypt accessor that ultimately resolves `CACHE[bigconst]`. fileciteturn0file0L15-L24 fileciteturn0file0L63-L76

The public corpus contains labeled families including WeAreDevs-adjacent LuaObfuscator, Luraph, MoonSec, MoonVeil, IronBrew, Prometheus, PSU, SynapseXen, Boronide, Hercules, LPS, 77fuscator and wYnFuscate. citeturn0search0turn0search4

## Updated

- Version bumped from 4.8.3 to 4.8.4.
- Added `inlineOffsetTableLookups()` for immutable numeric offset string-table accessors.
- Added `inlineNumericCacheAccessors()` for literal numeric VM-cache assignments/accessors; this targets the cache indirection described in the supplied analysis without executing the VM.
- Integrated both passes into the multi-pass pipeline before generic cleanup.
- Added regression fixtures for both patterns.
- Existing multi-hop standard-library alias handling remains enabled.

## Deliberate limits

The Z.ai report also describes dynamic tracing, Roblox mocks, event firing, remote library loading, and anti-tamper/environment bypasses. fileciteturn0file0L78-L105 Those behaviors are **not** copied into this update. The new passes are static, conservative source transformations: dynamic VM execution, network fetching, key-system bypassing, and environment emulation are not introduced.

## Verification

- Static source inspection completed.
- Typecheck attempted with the available global TypeScript compiler; it could not complete because the package's `@types/node` dependency is not installed in the extracted environment.
- The archive is repackaged and its ZIP integrity is checked.
