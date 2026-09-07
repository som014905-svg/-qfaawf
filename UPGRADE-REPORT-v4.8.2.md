# v4.8.2 upgrade report

## Corpus review

The public `terrorlua/obfuscator-samples` repository currently exposes labeled families including LuaObfuscator, Luraph, MoonSec, MoonVeil, IronBrew variants, Prometheus, PSU, SynapseXen, Boronide, Hercules, LPS, 77fuscator, and wYnFuscate. The repository also contains a LuaObfuscator ChaoticGood sample whose emitted code uses a local `string.char`/`string.byte`/`string.sub` + `bit32.bxor` + `table.concat` decoder function.

A current Luraph v14.8 sample is also present in the corpus and is large (about 1.2 MB), reinforcing the existing decision to keep corpus mirroring separate from automatic execution.

## Updated in this package

- Version bumped from 4.8.1 to 4.8.2.
- Added a safe static decoder pass for the common literal XOR helper shape.
- Expanded stdlib alias normalization for bracket notation and `bit32 or bit` alias chains.
- Wired the new pass into generic and multi-pass cleanup.
- Added a regression fixture.

## Verification

- ZIP integrity: will be checked after packaging.
- Static source review completed for the new pass; it only transforms literal-string decoder calls and does not execute the source.
- Full TypeScript/Bun test execution is not available in this container because Bun and the package's Node type dependencies are absent.

## Upstream limitation

The container cannot directly clone GitHub because outbound DNS/network access is unavailable. The corpus review therefore used the public GitHub repository pages available through web access rather than pretending that a complete fresh local corpus was downloaded. The shipped `corpus:update` command remains the authoritative way to mirror the complete corpus on a network-enabled machine.
