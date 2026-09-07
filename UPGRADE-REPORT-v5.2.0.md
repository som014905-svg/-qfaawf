# Upgrade report — v5.2.0 X10-DEEP

## Main changes

The engine now uses a bounded refinement portfolio instead of relying on a single post-processing winner. After all specialized deobfuscators finish, the top four candidates by measured output quality are each sent through a deeper cleanup loop, then re-ranked.

### Why this is stronger

A VM-specific lifter can expose more semantics while temporarily producing a less readable intermediate form. Previously that candidate could lose before cleanup. The new portfolio stage lets specialized outputs receive the same constant propagation, table resolution, control-flow recovery, and generic cleanup before the final selection.

### Convergence changes

- Multi-pass hard cap: 8 -> 12 iterations.
- Early-exit quality gate: 95% -> 98.5%.
- Refinement acceptance threshold: <= 1% quality loss tolerance for intermediate safe transforms.

### Safety

The added refinement path remains source-to-source/static. It does not execute the input Lua/Luau payload.
