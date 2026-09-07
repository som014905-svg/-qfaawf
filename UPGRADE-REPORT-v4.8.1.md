# v4.8.1 upgrade report

## Updated in this package

- Version bumped from 4.8.0 to 4.8.1.
- Added a corpus integration manifest covering the 15 top-level families currently visible in `terrorlua/obfuscator-samples` and the Luraph v1→v15 matrix exposed by the repository.
- Added `bun run corpus:update`, which mirrors upstream `.lua`/`.luau` files into `engine/corpus/upstream/` without executing them and records SHA-256 plus upstream Git blob SHA metadata.
- Fixed the shipped test commands by adding `test-samples/detect-batch.ts` and `test-samples/deobf-batch.ts`, both of which were referenced by `package.json` but missing from the 4.8.0 archive.
- Added detector smoke fixtures for representative corpus families.

## Verification

- ZIP integrity: PASS (`unzip -t`).
- `package.json` parses successfully and exposes `corpus:update`, `test:corpus`, and `test:corpus:detect`.
- Full TypeScript execution was not run in this container because the 4.8.0 report already noted the packaged environment may lack the required Bun/Node type dependencies and network installation was unavailable.

## Upstream note

The public repository was checked on 2026-09-03. Its root currently exposes 15 labeled families, including Luraph, MoonSec, MoonVeil, IronBrew variants, LuaObfuscator, Prometheus, PSU, SynapseXen, Boronide, Hercules, LPS, 77fuscator, WeAreDevs, and wYnFuscate. The complete sample bytes are intentionally fetched by the new `corpus:update` command on a network-enabled machine rather than embedded blindly into this archive.
