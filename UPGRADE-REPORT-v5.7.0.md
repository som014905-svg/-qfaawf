# v5.7.0 upgrade report — corpus updater reliability

## Vấn đề

`corpus:update` dùng GitHub Git Trees API với `recursive=1`. Khi corpus public
phình to, endpoint này có thể trả HTTP 500 trước khi engine tải được sample
nào. Điều này làm quy trình cập nhật corpus và kiểm thử detector bị dừng ngay
từ bước chuẩn bị dữ liệu.

## Thay đổi

- Duyệt từng thư mục bằng GitHub Contents API.
- Giữ nguyên bộ lọc `.lua`/`.luau`, giới hạn kích thước, SHA-256 và upstream
  Git blob SHA.
- Ghi thêm danh sách `families` vào `corpus/upstream/manifest.json`.
- In số family đã phát hiện trong summary cuối lệnh.
- README ghi rõ trạng thái corpus hiện tại: chưa có sample XON, nên chưa claim
  hỗ trợ XON.
- Multi-pass cleanup giờ bảo toàn token ở cuối source khi candidate ngắn hơn;
  điều này ngăn Luraph v15 `LPH]` bị cắt giữa anonymous function sau bước
  generic cleanup.
- Readability pass được mở rộng cho local/parameter một ký tự phổ biến trong
  VM (`v`, `i`, `j`, `k`) nhưng vẫn bỏ qua global, property, table key và tên
  bị reassignment để tránh làm hỏng semantics.
- Guard property được chuyển từ cấp symbol sang cấp occurrence: một tên như
  `v` vẫn được đổi ở local/register, còn `obj.v` giữ nguyên. Sample v15 hiện
  đổi được 55 local/register thành `arg*` và `num*`.
- Tên `arg*` được tinh chỉnh theo usage site thành `tbl*`, `fn*`, `num*` hoặc
  `value*`, giúp đọc VM register dễ hơn mà không đụng tới semantics.

## Kiểm chứng

- `npx tsx test-samples/unit-smoke.ts`: PASS.
- `CORPUS_REPO=octocat/Hello-World CORPUS_REF=master CORPUS_DIR=/tmp/corpus-updater-smoke npx tsx scripts-update-corpus.ts`: PASS.
- Sample Luraph v15 `5ae248d6527b5c01.lua`: output giữ nguyên đuôi
  `end}, {}):cO()(...);` sau multi-pass; `npx tsx test-samples/unit-smoke.ts`:
  PASS.
- Dynamic VM decoder đã chạy được sandbox nhưng không thu được proto dump cho
  sample v15 này; output tốt nhất hiện là loader đã beautify + constants
  harvest, không phải source gốc hoàn chỉnh.
- 10 vòng `while true` và 4 function-table numeric entries vẫn được giữ lại:
  state của chúng phụ thuộc buffer/runtime nên chưa đủ bằng chứng để unroll
  hoặc inline tĩnh mà không đổi semantics.
- `npm run typecheck`: còn lỗi nền trong các module VM/lifter; không phát sinh
  lỗi mới từ updater.

## Giới hạn

Việc thêm deobfuscator XON cần một sample XON cụ thể. Không nên suy đoán format
hoặc đánh dấu detector là hỗ trợ khi chưa có fixture để kiểm chứng output và
syntax.
