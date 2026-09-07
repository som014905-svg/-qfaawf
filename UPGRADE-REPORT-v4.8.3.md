# v4.8.3 upgrade report

## Corpus-driven review

The public `terrorlua/obfuscator-samples` repository contains multiple labeled families, including LuaObfuscator, Luraph, MoonSec, MoonVeil, IronBrew variants, Prometheus, PSU, SynapseXen, Boronide, Hercules, LPS, 77fuscator, and wYnFuscate. A reviewed LuaObfuscator sample uses chained stdlib aliases (`string.char`, `string.byte`, `string.sub`, `bit32.bxor`, `table.concat`) before its decoder function. citeturn0search0turn0search1

## Updated

- Version bumped from 4.8.2 to 4.8.3.
- Strengthened `normalizeStdlibAliases` to resolve multi-hop aliases up to 8 levels.
- Added cycle and depth guards; unresolved chains are left unchanged.
- Added a regression fixture for `bit32 -> a -> b -> c["bxor"]`.

## Safety

The new logic is token-based and source-to-source. It does not execute the input Lua/Luau program.

## Verification

- Static source review completed.
- ZIP integrity will be checked after packaging.
- Full Bun/TypeScript runtime suite remains environment-dependent.
