# v5.6.0 upgrade report

## Loader chain: static URL concatenation

### Vấn đề

Một số loader không đặt URL hoàn chỉnh trong một literal mà nối các phần tĩnh:

```lua
loadstring(game:HttpGet("https://host/" .. "scripts/" .. "main.lua"))()
```

Chain resolver trước đây chỉ xét từng literal riêng lẻ, nên URL bị coi là
`dynamic` hoặc không được follow.

### Thay đổi

- `extractScriptUrls()` gấp các literal liền kề qua toán tử `..` trước khi phân loại.
- Việc gấp dựa trên vị trí token, không đánh giá mã Lua và không thực thi input.
- Biến, biểu thức runtime và placeholder `%s` vẫn giữ nguyên cơ chế `dynamic`.
- Bổ sung regression test trong `test-samples/unit-smoke.ts`.

### Kiểm chứng

- `npx tsx test-samples/unit-smoke.ts`: **PASS**
- `npm run typecheck`: còn lỗi nền đã tồn tại ở các module VM/lifter; không phát sinh
  lỗi trong thay đổi chain resolver.