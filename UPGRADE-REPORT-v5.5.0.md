# v5.5.0 upgrade report

## New obfuscator covered: Hercules (zeusssz/hercules-obfuscator)

Hercules is an open-source Lua/Luau obfuscator with a public GitHub repo (214 stars, 71 forks
as of Sep 2026). Its output has three statically-reversible layers:

### Layer 1 — Dead-code garbage blocks
Hercules inserts `if false then local X=N end` and `while false do local X=N break end` blocks
throughout the script to bloat it and confuse static analysers. These are 100% dead and are
now stripped before any other pass.

### Layer 2 — Stdlib glob aliases
At the top of the output, Hercules assigns `RANDOM_NAME = string.char`, `RANDOM_NAME2 = table.concat`,
etc. at global scope. These are resolved to their stdlib targets before the Caesar decode pass so
the IIFE bodies match either aliased or bare calls.

### Layer 3 — Caesar cipher string encoding
Each string literal is replaced by an IIFE:
```lua
(function(s,k) local r="" for i=1,#s do r=r..string.char((string.byte(s,i)+k)%256) end return r end)("\xNN...", SHIFT)
```
The engine brute-forces both `+k` and `−k` directions, picks the decode with printable-ratio ≥ 80%,
and replaces the whole call site with the decoded Lua string literal.

Named-function variants (top-level `local function decode(s,k)...end` + call sites) are also handled.

## New Clyde patterns (sfr-development/Lua-Obfuscator-Clyde-Protection)

The sfr-development Clyde web tool (a newer rewrite, MIT-licensed) emits two new VM shapes:

- **Register-VM** (`vmType="register"`): identified by `local regs={}; local pc=0; while true do` +
  opcode dispatch chain.
- **Stack-VM** (`vmType="stack"`): identified by push/pop array + opcode `if/elseif` chain.
- **LZMA maximum-mode** (`vmLevel="maximum"`): LZMA-compressed bytecode blob. Flagged in the
  output notes; the constant layer above the blob is still recovered.
- **Constant table extraction**: `local NAME = {78,101,119,…}` inside the VM header is folded
  to `local NAME = "New …"` when the printable-ratio check passes.

## Dava fork variants

The `{i,k,f,p}` proto shape (no `u` field) and the `table.concat`-based char-array factory
variant are now detected alongside the original `{i,k,f,u}` shape.

## Validation targets
- All new passes are literal-driven and source-only.
- No dynamic Lua/Luau execution, no HTTP fetching, no key-bypass, no environment access.
- Caesar decode only commits when the decoded string passes the 80% printable-ratio guard.
- Dead-code removal only targets provably-constant condition forms (`if false`, `while false`).
