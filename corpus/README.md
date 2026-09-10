# Corpus integration

This directory is the integration point for the public `terrorlua/obfuscator-samples` corpus:

- Repository: https://github.com/terrorlua/obfuscator-samples
- Expected layout: `<Obfuscator>/<Version or Variant>/<sha>.lua`
- The updater preserves the upstream directory layout and writes a manifest with SHA-256 hashes.

The updater is intentionally opt-in and downloads source samples only. The deobfuscation engine never executes corpus files as trusted code.

## Refresh

```bash
bun run corpus:update
```

Optional environment variables:

```bash
CORPUS_REF=main bun run corpus:update
CORPUS_DIR=./corpus/upstream bun run corpus:update
CORPUS_MAX_BYTES=3000000 bun run corpus:update
```

## Validate detector coverage

```bash
bun run test:corpus:detect
```

## Run deobfuscation over the corpus

```bash
bun run test:corpus
```

Large or VM-heavy samples can be slow. Use `CORPUS_DIR` to point the harness at a local mirror.


v5.9.0 corpus pass: nested numeric dispatcher analysis + regression metadata.
