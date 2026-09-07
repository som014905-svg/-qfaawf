# v4.8.0 upgrade report

## What changed

- Added `normalizeEnvStdlibAliases()` in `engine/src/passes/static-resolve.ts`.
- Resolves safe `getfenv()` indirection such as `env["string"]["\099\104\097\114"]` to `string.char` before constant folding.
- Wired the pass into both the generic engine and the shared multi-pass pipeline.
- Added a regression case in `engine/test-samples/static-resolve.ts`.
- Bumped engine package version to 4.8.0.

## Safety

The new resolver is token-based and allow-lists pure standard-library members. It does not execute the input script.

## Verification

The source files were inspected after the patch. A full TypeScript build could not be completed in this container because the packaged project does not contain/install its `@types/node` dependency (`tsc` reported TS2688). Run `bun install && bun run typecheck && bun run test:static` on a machine with Bun/network access.
