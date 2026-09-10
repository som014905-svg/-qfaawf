# Luau Deobfuscation Engine
update:6.0.0
fix các lớp VM còn lại: tăng khả năng phân tích dispatcher, khôi phục state/control-flow có kiểm soát, giảm mã hóa còn sót và làm output dễ đọc hơn.

> Lưu ý pháp lý: Công cụ này chỉ dành cho học tập, phân tích bảo mật và audit code. Không sử dụng cho hành vi trái pháp luật, vượt quyền, đánh cắp mã nguồn hoặc phá cơ chế bảo vệ. Người sử dụng tự chịu trách nhiệm với input, output và kết quả.

Các script trong workspace là dữ liệu do người dùng cung cấp hoặc lấy từ nguồn công khai để kiểm thử. Công cụ không đảm bảo khôi phục chính xác mọi chương trình VM và không tự ý bypass key system.

## Cài đặt

Yêu cầu Bun hoặc Node.js hiện đại:

```bash
npm install
```

Nếu dependency VM không khả dụng, engine sẽ tự fallback về phân tích tĩnh.

## Sử dụng

```bash
npx tsx src/cli.ts input.lua -o output.deobf.lua
npx tsx src/cli.ts input.lua --seq --artifacts
npx tsx test-samples/unit-smoke.ts
```

API chính nằm trong `src/deobfuscators/orchestrator.ts`. Kết quả gồm output,
engine được chọn, validation tĩnh, notes và artifacts nếu có.

## Hỗ trợ

Engine có các lớp xử lý cho Luraph, IronBrew, MoonSec, MoonVeil, Prometheus,
WeAreDevs, AstroProtect, XOR string, tagged string-table, các VM Luau hiện đại
và generic cleanup. Mức khôi phục phụ thuộc format, input và runtime state của
VM.

Output VM chưa chứng minh được sẽ được giữ dưới dạng phân tích hoặc artifact
thay vì tự đoán thành source có thể sai semantics.

## Quyền sử dụng

Chỉ phân tích code mà bạn có quyền xem hoặc được phép kiểm thử. Không tải,
chạy hoặc phát tán payload không rõ nguồn gốc.

{ghi chú của bypass00000:cái này vẫn đang up từ từ nên khi sài có thể gặp lỗi hoặc deobf ko vừa ý bạn nhưng đây beta thui chưa chính thức beta vẫn up từ từ file 5ae248d6527b5c01.deobf.lua là file luarph v15.0 deobf và nó deobf hơi lỏ ヾ(•ω•`)o nếu bạn ko biết sài thì tui lười hd lắm nên tự tìm hiểu đi nha}
## v6.0.0 — Advanced VM / dispatcher recovery

The v6.0 line promotes the structural recovery work into the main release: stronger nested numeric dispatcher analysis, function-level state normalization (`state = CONSTANT - state`), state-transition and basic-block recovery, conservative alias propagation, evidence-based semantic identifier recovery, dispatcher/alias residue scoring, and bounded symbolic analysis. The pipeline remains static-only and does not execute Roblox APIs, network requests, dynamic code loading, or attacker-controlled payloads.

The HeavyWeightFishing/WeAreDevs path is tuned to handle the harder `state = CONSTANT - state` and nested-comparison patterns with function-level dispatcher lifting, normalized state transitions, and conservative structured inlining. The v6.0 regression sample recovered 44 dispatcher loops / 236 state visits from a 34k-line Luast output while reducing `while true do` dispatchers from 369 to 313. Patterns that cannot be proven safe are preserved rather than guessed. When recovery cannot be proven safely, the unresolved behavior is preserved as analysis data instead of guessed source.

## v6.1.0 update

- Universal cross-family dispatcher flattening is now applied after each targeted deobfuscator.
- Supports direct integer dispatchers plus affine state normalization (`C - state`, `C + state`, `state ± C`).
- Function-level recovery, alias propagation, semantic recovery, scoring, static analysis, and regression passes remain enabled for every supported family.
- The goal is not to target Luast alone: Luraph, MoonSec, MoonVeil, IronBrew, Prometheus, WeAreDevs, tag-table, modern VM, XOR/string-table and generic outputs all receive the same structural cleanup layer.
