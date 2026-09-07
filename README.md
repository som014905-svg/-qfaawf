# 🔓 Luau Deobfuscation Engine

Engine deobfuscate script **Luau / Lua** (Roblox) — chạy standalone bằng **Bun**. Core không cần dependency (`node:zlib` + `node:crypto` có sẵn); engine **Luraph VM Structural Decoder** dùng thêm `luau-web` (Luau WASM thật) — optional, tự fallback về static analysis nếu thiếu.

> ⚠️ **Lưu ý pháp lý**: Công cụ này chỉ dành cho mục đích **học tập / phân tích bảo mật / audit code**. Bạn chịu trách nhiệm khi sử dụng.

> ✅ **v4.3.0**: **Luraph VM decompiler** — pipeline đầy đủ `payload → bytecode → opcode → symbolic IR → structured Luau source`: alias destructuring parse + final program dump ngay tại dispatch đầu tiên + execution trace (xác minh jump `target = col[vip]+1`, 42/42) + symbolic scratch machine cho multi-step ops + token-list matcher (30+ semantic rules). Mẫu Luraph v14.7 281KB: **410 instructions → 376 lifted (92%)**, output là Luau hợp lệ, recovery 55%→85%, runtime 17.8s→~6s. Xem `CHANGELOG.md`.

> ✅ **v4.2.0**: **Luraph v14.6+ VM structural decode** — parse dispatch-tree của interpreter trực tiếp từ loader (202 opcode handlers) + chạy loader trong sandbox Luau WASM (luau-web/Asyncify) để dump chương trình VM đã decode (opcodes/constants/operands) → disassembly annotation. Xem `CHANGELOG.md`.

> ✅ **v4.1.0**: validated trên corpus [terrorlua/obfuscator-samples](https://github.com/terrorlua/obfuscator-samples) — **39/39 samples detected đúng** (15 families: 77fuscator, Boronide, Hercules, IronBrew1/2/3, LPS, LuaObfuscator.com, Luraph, MoonSec, MoonVeil, PSU, Prometheus, SynapseXen, WeAreDevs, wYnFuscate); **decoy-string downweighting** (chống fake banner `#'Luraph...'`); sửa 3 bug O(N²) (beautify 27s→95ms, moonsec 9.4s→0.2s); chặn output explosion (wYnFuscate 4616KB→1329KB); 50 regression tests. Xem `CHANGELOG.md`.

> ✅ **v4.0.0**: audit toàn diện — 8 critical bugs (output sai logic / feature chết) + 8 high fixes; winner selection theo chất lượng output; state-machine unrolling; weighted-evidence detector. Xem `CHANGELOG.md`.

> 📦 **Tài liệu kèm theo**:
> - `CHANGELOG.md` — lịch sử các bản nâng cấp engine (mới nhất: v3.6.0 Advanced constant propagation + regression fixes)
> - `UPGRADE-POINTS.md` — 🔍 **các điểm còn yếu cần nâng cấp tiếp** (ưu tiên cao/trung bình/thấp + gợi ý cách làm + cách test nhanh)

---

## 🆕 Chain resolver: gấp URL literal

Loader chain giờ nhận diện URL được tạo từ các chuỗi literal nối bằng `..`, ví dụ:

```lua
loadstring(game:HttpGet("https://example.com/" .. "script.lua"))()
```

URL được gấp bằng vị trí token, không thực thi Lua. URL chứa biến, phép tính động
hoặc placeholder `%s` vẫn được đánh dấu `dynamic` và không tự động follow.

```bash
npx tsx test-samples/unit-smoke.ts
```


## 🆕 v4.8.6 — HeavyWeightFishing specialized profile

- Adds a dedicated `heavyweightfishing.ts` profile for the public `joustingmatch/Ouroboros` `heavyweightfishing.lua` sample.
- Replays its exact three-range O-table shuffle, parses the arithmetic-noise `B(B)` offset accessor, decodes the embedded custom 64-symbol map, and inlines literal `B(...)` references.
- Feeds the recovered source into the existing conservative numeric-cache/constant-fold passes.
- Static only: no Roblox execution, HTTP loading, key validation, or dynamic bypass is embedded in the engine.


For the dedicated HeavyWeightFishing profile, the engine recognizes the public Ouroboros sample and applies a target-specific static string-table decoder before the generic cleanup pipeline.

```bash
bun run src/cli.ts samples/heavyweightfishing.lua --seq
```

## 🆕 v4.8.2 corpus-driven static decoder improvements

- Added a safe static pass for LuaObfuscator-style literal XOR decoder functions.
- Expanded stdlib alias normalization to support bracket-indexed members, `bit32` aliases, and `table.insert`.
- The pass is wired into generic and multi-pass cleanup and only folds literal arguments; it never executes input Lua.

## 🆕 v4.8.1 corpus refresh tooling

The package now ships a reproducible updater for the public `terrorlua/obfuscator-samples` corpus.
Run `bun run corpus:update` to mirror the current Lua/Luau samples locally, then use
`bun run test:corpus:detect` and `bun run test:corpus` for detection/deobfuscation sweeps.
The updater records SHA-256 hashes and the upstream Git blob SHA in `corpus/upstream/manifest.json`.

### Corpus validation status

The upstream repository currently exposes 15 top-level families. It does
**not** currently contain an XON sample, so XON support is not claimed until a
reproducible sample is available and passes the detector/deobfuscation harness.

```bash
# Refresh the public corpus and write hashes/family statistics
bun run corpus:update

# Check detector coverage, then run the deobfuscation sweep
bun run test:corpus:detect
bun run test:corpus
```

The updater walks GitHub directories individually, which avoids the HTTP 500
failure caused by the repository-wide recursive tree endpoint on large corpus
snapshots.

## 🆕 v4.8 corpus-driven structural cleanup

Bản 4.7 bổ sung lớp `static-resolve` dùng chung cho các family mà corpus mẫu có nhưng engine trước đây chủ yếu rơi về `generic`: **Boronide, Hercules, LPS, PSU, SynapseXen, wYnFuscate, IronBrew3 và 77fuscator forks**. Pass chỉ rewrite cấu trúc chứng minh được an toàn: static scalar tables, pure stdlib aliases, literal `loadstring(...)` wrappers; dispatcher/CFF tiếp tục chạy qua multi-pass và candidate mới chỉ được giữ khi qua static validation.

Repository mẫu hiện có nhiều biến thể/version; Luraph trải từ v2 tới v15, MoonSec có V2/V3, MoonVeil có nhiều v1.x/2.x release, và wYnFuscate có `2026Q3` cùng `ClosedBeta`.

## ✨ Hỗ trợ các obfuscator

| Obfuscator | Engine | Kỹ thuật |
|---|---|---|
| **Luraph** v14.4 → v15 | `luraph.ts` | Trích payload base85 + Zstd/DEFLATE, unescape chuỗi, harvest constants từ bytecode |
| **Luraph v14.8 VM mode** | `luraph-vm.ts` | ★ v2: chạy VM trong sandbox Lua (wasmoon) với proxy env, trace execution 6 kịch bản (happy + failure) → **tái tạo code Lua sạch** của script gốc (guard, anti-analysis trap, loader URL). Proto dump + constants chuyển vào artifacts |
| **Luraph v14.6–v14.8 VM mode (`LPH]`)** | `luraph-vm-decode.ts` + `luraph-lifter.ts` | ★★★ v4.3 **Decompiler**: alias destructuring + final program dump (fetch-site instrumentation) + execution trace + symbolic scratch machine + token-list semantic rules (30+) → **decompile thẳng ra Luau source** (92% coverage trên mẫu v14.7 281KB). v4.2 Structural Decoder: 208 opcode handlers + disassembly annotation. Không cần tool ngoài. |
| **IronBrew / AztupBrew** | `ironbrew.ts` | VM state machine partial recovery |
| **MoonSec v2** | `moonsec.ts` | ★ v3: **đánh giá tĩnh string table VM** (IIFE and/or trick + escape soup) và inline mọi tham chiếu `p[N]` → chuỗi/number thật; tái tạo bảng hằng số dạng đọc được |
| **MoonSec v3** | `moonsec.ts` | unwrap loader + fold |
| **MoonVeil** | `moonveil.ts` | string decrypt + fold |
| **Prometheus / Prometheus v2** | `prometheus.ts` | layer unwrap |
| **WeAreDevs** | `wearedevs.ts` | loader strip |
| **AstroProtect 2.1.0** | `astrotect.ts` | base64 → inflateRaw (zlib) → recover source **nguyên vẹn** |
| **XOR-String obfuscators** | `xorstrings.ts` | dò decoder theo usage (có guard chống false-positive với script plain), brute-force key, inline chuỗi decode |
| **Tagged String-Table VM** (IronBrew v2/Aztup) | `tagtable.ts` | decode string table bằng custom base85/base64 alphabet, codec voting, replace in-place |
| **QMarker VM** | `qmarker-vm.ts` | VM dispatcher analysis |
| **Clyde / sudo-dava custom VMs** | `modern-vm.ts` | static XOR string-factory + char-array constant recovery; giữ VM body nếu chưa chứng minh lift an toàn |
| **luaobfuscator.com (LuaXOR)** | `xorstrings.ts` | family routing |
| **BaconGuard / mcr4 / khác** | `generic.ts` + fold | constant-fold mạnh + beautify |
| **~55 biến thể khác** | detector tự nhận diện | family mapping |

Kèm theo:

- **★ Loader Chain Resolver** (`chain.ts`): script không mã hoá nhưng gọi `loadstring(game:HttpGet(url))()` → **tự theo chuỗi** tải + deobf script đích (tối đa 15 bước, chống vòng lặp, bỏ qua URL động `%s`/`..` · **KHÔNG chặn host nào** (Discord/YouTube/webhook/repo đều được liệt kê; URL trong ngữ cảnh loadstring/HttpGet được theo bất kể host) · URL hỏng → tự thử URL kế tiếp (backtrack, tối đa 10 hop chết)). Dùng qua CLI `--chain` hoặc API `runDeobfChain()`
- **★ v4 Output-ranked winner selection** (`orchestrator.ts`): engine thắng được chọn theo **chất lượng output đo được** (syntax 45% + readability 20% + recovery 20% + cleanliness 15% + engine confidence 15%) — không còn chuyện engine tự báo confidence cao mà output tệ/hởng hơn vẫn thắng. Output có lỗi syntax tự động nhường cho candidate hợp lệ kế tiếp
- **★ v4 Dispatcher state-machine unrolling** (`passes/control-flow.ts`): unroll `while true do if state == N ...` flattening khi chứng minh được an toàn (state hằng, không cycle, đủ branch) — kèm guard bảo toàn giá trị state sau loop
- **★ v4 Weighted-evidence detector** (`detectObfuscatorsDetailed()`): evidence list có trọng số + structural features (VM dispatcher / string-table VM / CFF / encoded constants / custom decoder / loader wrapper / env checks / nested layers) + secondary families — API `detectObfuscator()` cũ giữ nguyên
- **★ v4 Error classification**: mỗi engine failure được phân loại timeout / parse / unsupported / malformed / runtime / resource
- **★ Const-expression evaluator** (`const-eval.ts`): tính được `(-#"junk msg"+803)`, `#{1,'nil',(function()...end)()}`, IIFE `(function(_) return (_ and 'A') or 'B' end)(cond)`, `('\115\116'):rep(2)`… → fold thành literal (pass N trong pipeline fold)
- **★ Readability pass** (`renameCrypticLocals`): đổi tên biến rác thành tên đọc được theo kiểu suy luận — `local a = {...}` → `local tbl1`, `function(a, b)` → `function(arg1, arg2)`, `local lIllI = "x"` → `local str1`… scope-safe (không đụng global/property/table-key trùng tên), tự chạy trong multipass cho mọi engine
- **Constant folding engine** nhiều pass (10 pass A→I+N): gộp số học, unwrap parens/tables, unary sign, unescape chuỗi `\ddd`/`\xXX`/`\u{XXXX}`/`\z`
- **Detector** nhận diện ~55 obfuscator + banner
- **Roblox API scanner**: đếm `GetService`, `FireServer`, `SendKeyEvent`… trong output
- **Static validator**: kiểm tra syntax (balanced brackets, unclosed blocks, hiểu if-expression Luau…) sau khi deobf
- **LRU cache** theo SHA-256 input

---

## 🚀 Cài đặt

Yêu cầu duy nhất: [**Bun**](https://bun.sh) ≥ 1.1 (hỗ trợ TypeScript native + `zstdDecompressSync`):

```bash
curl -fsSL https://bun.sh/install | bash
```

Giải nén zip này là chạy được ngay — **không cần `bun install`** (không có dependency nào).

> 🔬 **Tùy chọn — Luraph v14.8 VM Analyzer**: muốn decode sâu VM mode (dump proto +
> decrypt constants + phát hiện loader URL) thì cài thêm:
> ```bash
> bun add wasmoon   # Lua 5.4 WebAssembly — engine tự nhận diện khi có sẵn
> ```

---

## 📦 Cách dùng

### 1. CLI — deobf 1 file hoặc URL

```bash
# Deobf file local (output: gojotech.deobf.lua)
bun run src/cli.ts samples/gojotech.lua

# Chỉ định output + ghi artifacts (constants recover được)
bun run src/cli.ts samples/gojotech.lua -o out.lua --artifacts

# Deobf trực tiếp từ URL (pastebin, github raw, gist, pastefy…)
bun run src/cli.ts "https://pastebin.com/raw/kbNcNw9B"

# ★ Theo chuỗi loader: script gọi loadstring(game:HttpGet(url))() → tự tải
#   + deobf script đích (tối đa 15 bước, chống vòng lặp)
bun run src/cli.ts "https://raw.githubusercontent.com/.../loader.lua" --chain

# File lớn (≥300KB) — tự chạy sequential; hoặc ép bằng --seq
bun run src/cli.ts big-script.lua --seq
```

Output console:

```
✔ Obfuscator phát hiện : luraph (95%)
  ✓ Luraph Deobfuscator        conf= 90%  1420ms
  ✓ Generic Deobfuscator       conf= 62%  310ms
★ Engine thắng        : Luraph Deobfuscator · confidence 90%
★ Validation          : syntax OK (0 issues)
★ Roblox API          : 364 calls / 87 API · services: Players, Workspace…
💾 Output              : gojotech.deobf.lua (141 KB)
```

### 2. Test harness — chạy hết sample

```bash
bun run test
bun run test:regression-samples/run-tests.ts

# Smoke test không cần network
npx tsx test-samples/unit-smoke.ts
```

Chạy toàn bộ file trong `samples/`, xuất output + logs vào `test-samples/out/`, in bảng tổng kết.

### 3. Dùng như thư viện (API)

```ts
import { runDeobfuscation } from "./src/deobfuscators/orchestrator";

const input = `...mã Lua obfuscated...`;

const report = await runDeobfuscation(
  { input, baseName: "my-script", source: "text", log: (m) => console.log(m) },
  {
    timeoutMs: 30_000,        // timeout mỗi engine
    acceptThreshold: 0.5,     // dừng sớm khi engine đạt ngưỡng này
    maxPasses: 3,             // số pass constant-fold
    minPassImprovement: 0.015,
    parallel: input.length < 300_000, // false = chạy tuần tự (file lớn)
  }
);

console.log(report.detected);   // { obfuscator: "luraph", confidence: 0.95, evidence: "..." }
console.log(report.best);       // { deobfuscator, confidence, output, artifacts, notes… }
console.log(report.validation); // { ok: true, summary: "syntax OK", issues: [] }
console.log(report.roblox);     // { found: true, totalCalls: 364, services: ["Players", …] }
```

`report.best.output` là chuỗi Lua đã deobfuscate.

---

## 📁 Cấu trúc thư mục

```
luau-deobf-engine/
├── package.json            # standalone — 0 dependency
├── tsconfig.json
├── README.md               # file này
├── src/
│   ├── cli.ts              # CLI entry (bun run src/cli.ts …)
│   ├── types.ts            # Deobfuscator / DeobfuscateResult / context types
│   ├── detectors/
│   │   └── detector.ts     # nhận diện ~55 obfuscator + family mapping
│   ├── deobfuscators/
│   │   ├── orchestrator.ts # điều phối: detect → chạy engines → multipass → validate
│   │   ├── luraph.ts       # Luraph v14–v15 (base85 + Zstd payload)
│   │   ├── astrotect.ts    # AstroProtect 2.1.0 (zlib inflateRaw)
│   │   ├── xorstrings.ts   # XOR-string decoder (usage-based + brute-force key)
│   │   ├── tagtable.ts     # Tagged string-table VM (IronBrew v2/AztupBrew)
│   │   ├── ironbrew.ts     # IronBrew
│   │   ├── moonsec.ts      # MoonSec v2/v3
│   │   ├── moonveil.ts     # MoonVeil
│   │   ├── prometheus.ts   # Prometheus
│   │   ├── wearedevs.ts    # WeAreDevs
│   │   ├── qmarker-vm.ts   # QMarker VM
│   │   ├── multipass.ts    # cleanup đa pass
│   │   └── generic.ts      # fallback: fold + beautify
│   ├── passes/
│   │   └── constant-fold.ts # constant folding 9 pass (A→I)
│   └── utils/
│       ├── lua-utils.ts    # Lua tokenizer + parser + beautifier + printer
│       ├── validate.ts     # static syntax validation
│       ├── quality.ts      # scoring source
│       ├── roblox-detector.ts # Roblox API scanner
│       ├── fetcher.ts      # fetch URL (pastebin/github/gist/gitlab…)
│       ├── cache.ts        # LRU cache
│       └── rate-limit.ts   # rate limit (nếu nhúng vào bot)
├── samples/                # 4 sample demo
│   ├── gojotech.lua        # XOR-string → engine decode 95% VALID
│   ├── musclelegend2.lua   # AstroProtect → recover 97% VALID
│   ├── web-0x9nWQiF.lua    # Luraph v14.7
│   └── web-a4d1ZVZB.lua
└── test-samples/
    └── run-tests.ts        # harness
```

---

## ⚙️ Cách engine chọn kết quả

1. **Detector** quét banner/pattern → xác định obfuscator + family
2. **Orchestrator** cho mỗi engine tự `detect()` → xếp hạng theo confidence
3. Chạy các engine (parallel hoặc sequential) — engine nào **confidence cao nhất** thắng
4. **Multi-pass cleanup**: constant-fold + beautify tối đa 3 pass
5. **Validate** syntax tĩnh + quét Roblox API → trả report đầy đủ

---

## 📊 Kết quả thực tế (21 script thật test bằng harness)

| Sample | Obfuscator | Kết quả |
|---|---|---|
| musclelegend2 | AstroProtect | **97% · VALID** — recover toàn bộ source |
| gojotech | XOR-string | **95% · VALID** — 160 chuỗi decode inline |
| web-gist2 | Luraph v14.7 | **90% · VALID** — 92KB source recovered qua Zstd |
| pastefy3 | Luraph | **82% · VALID** — 154 constants harvested |
| arise-crossover | Luraph | **80% · VALID** |
| pastebin-kbNcNw9B | Tagged string-table VM | **85% · VALID** — 94/371 chuỗi inline |
| web-pastebin3 | IronBrew | **67% · VALID** |
| mcr4 | mcr4 | **VALID** — fold 7639 lần |

---

## 🛠️ Viết thêm engine mới

```ts
// src/deobfuscators/my-engine.ts
import { Deobfuscator, DeobfuscateContext, DeobfuscateResult } from "../types";

export class MyEngine implements Deobfuscator {
  id = "generic" as const;              // hoặc thêm ObfuscatorId mới trong types.ts
  name = "My Engine";
  description = "Mô tả ngắn";

  detect(input: string) {
    return /TÊN_OBFUSCATOR/.test(input)
      ? { obfuscator: "generic" as const, confidence: 0.9, evidence: "banner found" }
      : null;
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    // ctx.input = mã nguồn gốc
    // ctx.log("...")     = ghi log
    return {
      success: true,
      deobfuscator: this.name,
      output: transform(ctx.input),
      confidence: 0.9,
      obfuscator: "generic",
      notes: ["ghi chú cho user"],
    };
  }
}
```

Rồi đăng ký vào `ALL_DEOBFUSCATORS` trong `orchestrator.ts`.

---

## ❓ Troubleshooting

- **`zstdDecompressSync is not a function`** → Bạn đang chạy Node.js cũ. Dùng **Bun** hoặc Node ≥ 22.15.
- **Hết bộ nhớ (OOM) với file lớn** → thêm `--seq`, hoặc giảm `parallel: false` khi gọi API.
- **Output vẫn còn bảng chuỗi encode** → VM bytecode-level encryption (Luraph v14.4): engine chỉ harvest constants ra file `.artifacts.lua` (honest partial).
- **Input bị cắt từ nguồn** (block không khớp) → lỗi file gốc, không phải engine. Fetch lại script.


## v3.6.0 — Advanced constant propagation

- Added a conservative immutable-local propagation pass.
- Propagates scalar locals that are initialized once and never reassigned.
- Protects table keys, property/method names, and reassigned locals.
- Runs after constant folding so recovered literals can flow into later expressions.
- Added regression coverage for propagation and reassignment safety.


## 4.6.1 output behavior

The normal Luraph lifter preserves jump/branch control-flow through final emission. The legacy flatten emitter is retained only as a debug/fallback export because stripping VM control-flow can produce syntactically plausible but semantically incorrect Luau.
