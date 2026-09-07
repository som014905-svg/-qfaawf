# v4.8.5 upgrade report

## Source review

The supplied Z.ai 5.3 analysis of the HeavyWeightFishing sample shows that the WeAreDevs accessor is not written as a plain numeric offset: the function uses arithmetic-noise such as `B+(421764+-377161)`, and call arguments also use arithmetic expressions such as `-439191+394926`. fileciteturn0file0L15-L20

The analysis also reports a second-stage numeric cache where the effective lookup key is a large numeric constant, while the apparent binary string parameter is a decoy. fileciteturn0file0L63-L76

## Updated

- Version bumped from 4.8.4 to 4.8.5.
- `inlineOffsetTableLookups()` now uses the shared safe constant evaluator for arithmetic-noise offsets and arithmetic-noise call arguments.
- `inlineNumericCacheAccessors()` now accepts constant arithmetic expressions as cache keys where the expression resolves to a safe integer.
- Added a regression fixture based directly on the supplied sample's accessor arithmetic shape.

## Deliberate limits

The Z.ai report also used dynamic VM tracing, Roblox mocks, remote library loading, event firing and environment/key-system manipulation. fileciteturn0file0L78-L105 These are not copied into the static engine. The update remains source-to-source and refuses non-constant expressions.

## Verification

- Static source inspection completed.
- Regression fixture added for the exact arithmetic-noise accessor pattern.
- Full project typecheck remains blocked in the extracted environment by missing Node type definitions / dependency installation; this is reported rather than treated as a pass.
- Archive will be repacked after the source changes.
