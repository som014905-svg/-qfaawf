# 🔍 ĐIỂM CẦN NÂNG CẤP — Kiểm tra engine còn yếu ở đâu

> File này liệt kê các điểm còn yếu của engine **hiện tại**, kèm mức ưu tiên
> và gợi ý cách làm — để bạn kiểm tra và quyết định nâng cấp tiếp theo.

## Đánh giá tổng quan

| Nhóm | Hiện trạng |
|---|---|
| Obfuscator decode trực tiếp (AstroProtect, XOR-string, tagtable) | ✅ 85–97% — mạnh |
| VM reconstruction (Luraph v14.8, MoonSec V2) | ✅ 72–93% — hoạt động tốt |
| Luraph v14.6–14.8 VM decompilation (v4.3) | ✅ 92% lifted — bytecode → Luau source |
| Loader chain-following | ✅ Mới có — depth 4 |
| Chuỗi cipher Luraph v14.4 bytecode | ✅ Giải qua sandbox runtime capture (v4.2) |
| File input bị cắt từ nguồn | ℹ️ Lỗi file gốc, không phải engine |

## Ưu tiên cao

### 1. ~~Luraph VM devirtualization~~ ✅ DECỂ THÀNH SOURCE Ở v4.3.0
- ✅ **v4.3.0**: pipeline đầy đủ `payload → bytecode → opcode → symbolic IR → Luau source`.
  Alias destructuring + final program dump (fetch-site instrumentation, không còn
  snapshot thiếu) + execution trace (xác minh jump `target = col[vip]+1`, 42/42) +
  symbolic scratch machine (multi-step ops gộp thành 1 dòng) + token-list matcher
  (30+ rules, miễn nhiễm bracket-mangling). Mẫu v14.7 281KB: 410 instructions →
  376 lifted (92%), output Luau hợp lệ qua validator.
- Còn lại (future work): ~170 opcode chưa có rule (hiện giữ comment `-- OP_n`);
  nested protos cần coverage chạy guest tốt hơn (crash `nil.new` trong script
  logic — nil từ register value, không phải global); conditional jump (JGE/JNE)
  đã có rule nhưng chưa gặp mẫu thực thi; register-to-variable renaming có
  lifetime analysis.
- ✅ **Đã làm đúng cách gợi ý** (capture runtime decoder bằng sandbox):
  engine mới `luraph-vm-decode.ts` chạy loader trong sandbox Luau WASM thật
  (luau-web/Asyncify), wrap mọi method call và dump chương trình VM đã decode
  (opcodes/constants/operands/registers) + disassembly annotation đầy đủ.
  Test thực tế trên mẫu Luraph v14.7 281KB: 208 opcode handlers + 3 protos
  (389/329/77 instructions). Constants per-string cipher giờ đọc được qua
  sandbox trace thay vì brute-force tĩnh.
- Còn lại (future work): decompile bytecode → Luau source đầy đủ (cần
  semantics cho ~200 opcodes — hiện 24 op đã classify); nested protos cần
  guest execution coverage tốt hơn 16s budget.

### 2. Luraph bảng string prefix `8` (trong `luraph.ts`)
- Bảng string bắt đầu bằng `8` (nhiều mẫu 2024) decode sai còn sót
- **Gợi ý**: so sánh 2 mẫu đã decode đúng/sai, tìm offset khác nhau.
  Hoặc route qua structural decoder (v4.2) vốn đọc constants động.

### 3. Readability pass cho output VM (khó đọc)
- ✅ **Đã làm ở v3.4.0** — `renameCrypticLocals`: `local a = {...}` →
  `local tbl1 = {...}`, `function(a, b)` → `function(arg1, arg2)` với
  type inference, scope-safe (skip nếu trùng property/table-key). Tự chạy
  trong multipass cho mọi engine. Test gojotech: 175 biến rename.
- Còn lại: biến được REASSIGN (`a = a + 1` trong dispatcher VM) vẫn giữ tên
  cũ vì conservative — cần scope analysis đầy đủ mới rename an toàn được.
  Loop var `for v424 = 1, n` cũng chưa rename (cùng lí do).

## Ưu tiên trung bình

### 4. 2 validation issues còn sót
- ✅ `pastefy3` — **giờ ✓ OK** từ v3.4.0 (multipass 5 pass + rename)
- `arise-crossover` (Luraph v14.4.1): 80% còn 2 issue bracket — cải thiện
  cùng lúc với điểm 1 (cipher per-string).

### 5. Chain resolver: URL động
- ✅ ~~Chặn URL theo host~~ — **đã bỏ ở v3.3.1**: mọi link được liệt kê,
  Discord CDN (host script phổ biến) được theo như thường
- URL build bằng concatenation (`"https://"..host.."/x.lua"`) hoặc `%s` format
  → đánh dấu `dynamic`, không theo được
- **Gợi ý**: constant-fold chuỗi concat trước khi extract URL; evaluator cho
  `string.format("%s", ...)` khi tham số là literal.

### 6. Depth chain > 4
- ✅ **Đã nâng ở v3.4.0**: depth 4 → **15 bước** (+ backtrack 10 hop chết).
  Test HOHO hub: 26 bước — tới script chính 166KB + 6 script Luraph ngụy
  trang .json trên Discord CDN.
- Còn lại: URL động (xem điểm 5) là rào cản chính để đi sâu hơn nữa.

## Ưu tiên thấp

### 7. WeAreDevs script thật Noob Hub (57%)
- 1.35MB, string table 5036 entries — đọc được API chính (ESP/aimbot/
  FireServer) nhưng phần thân còn table-index noise
- Đã có sandbox trace; cần pass table-flatten.

### 8. IronBrew 65–67%
- GUI source đọc được, còn opcode mapping thủ công
- **Gợi ý**: build opcode frequency table từ sample đã biết mapping.

### 9. File input bị cắt từ nguồn (không phải lỗi engine)
- `pastefy1` (Bacon Guard): 67 lỗi bracket — file gốc truncated
- `pastefy2` (Luraph v15): 29 lỗi bracket — file gốc truncated
- Muốn test đúng thì fetch lại từ nguồn.

## Cách kiểm tra nhanh sau khi mở zip

```bash
cd luau-deobf-engine
bun run src/cli.ts samples/gojotech.lua          # 95% VALID
bun run src/cli.ts samples/musclelegend2.lua     # 97% VALID
bun run src/cli.ts samples/noobhub.lua           # 93% VALID (VM)
bun run "https://raw.githubusercontent.com/XRoLLu/Rolly_Hub/main/open-source-trash-loader.exe.yeah" --chain
# → theo chuỗi tới MS2_WHAT.lua → MoonSec 90% VALID
```

Kết quả kỳ vọng: 4/4 static check passed. Nếu mẫu nào fail → xem điểm yếu tương ứng ở trên.
