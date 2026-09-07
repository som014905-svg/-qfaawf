# v5.3.0 — X10-DEEP Recursive Convergence

- Adds bounded recursive re-deobfuscation (`--deep`, default 3; max 4).
- If a winning output still has residual obfuscation, the engine feeds that output back through the full deobfuscation portfolio.
- A recursive round is accepted only when static measured quality improves.
- Rejects large output expansion unless accompanied by a substantial quality gain.
- Recursive rounds force `useCache=false` and disable nested recursion to avoid loops.
- Static-only; no untrusted Lua payload is executed as real Roblox code.
