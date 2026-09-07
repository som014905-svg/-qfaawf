# Luau Deobfuscation Engine

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