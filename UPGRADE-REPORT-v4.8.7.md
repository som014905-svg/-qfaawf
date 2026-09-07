# v4.8.7 upgrade report

Input: `demonology-deobf-v4.8.6-heavyweightfishing`

## Corpus review

Reviewed the public `terrorlua/obfuscator-samples` family list and the public Prometheus example shape. The upstream collection currently includes 15 top-level families; Prometheus documents control-flow flattening and constant encryption, and its example output uses a dense string table of encoded fragments.

## Code changes

- Added strict static decoding for dense immutable base64 string tables.
- Integrated it into generic cleanup and the multi-pass pipeline.
- Added regression coverage.
- Bumped engine version to 4.8.7.

## Safety / scope

The new pass is source-to-source and only processes literal table entries. No Lua/Luau input is executed. No network fetching or runtime tracing was added.
