# v5.4.0 upgrade report

Modern public Luau obfuscation patterns researched and added:

- Clyde Protection: scope-aware identifier renaming, XOR string encoding, control-flow scrambling, stack/register VM, and maximum mode with polymorphic dispatch/LZMA are documented by the upstream public repository. The engine now statically targets the literal XOR string layer; the VM body is not guessed.
- sudo-dava25/LuaU-obfuscator: randomized VM names, serialized `{i,k,f,u}` custom bytecode, and character-code-array constants are documented upstream. The engine now statically recovers the constant layer and leaves the custom interpreter intact when full source lifting cannot be proven safe.
- Hercules and other 2026-era families remain covered by the existing detector/generic pipeline; no new Hercules-specific speculative VM was added without a stable public sample format.

Validation target: all new rewrites are source-only and literal-driven.
