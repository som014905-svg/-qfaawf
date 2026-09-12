-- noobhub — Luraph v14.8 · deobfuscated
-- Reconstruction từ VM execution trace (15 events, 6 kịch bản happy/failure)

-- (bảng nội bộ { 1, 2, 3, 4 } — state giải mã của loader, không ảnh hưởng logic chính)
-- guard executor: getgenv phải tồn tại
local genv = getgenv()
if genv == nil then
    while true do task.wait() end -- anti-analysis: treo executor vĩnh viễn
end
-- anti-hook: snapshot stdlib (nếu bị thay thế giữa chừng, các bước sau sẽ fail)
local stdlib = { error = error, tostring = tostring, type = type, pcall = pcall, pairs = pairs, print = print }
-- anti-tamper: debug.getinfo phải chạy được và trả table
local ok, info = pcall(debug.getinfo, 1)
if not ok or type(info) ~= "table" then
    while true do task.wait() end -- anti-analysis: treo executor vĩnh viễn
end
-- (bảng nội bộ { A, C, B } — state giải mã của loader, không ảnh hưởng logic chính)
-- kiểm tra API tải có sẵn rồi mới chạy
if game.HttpGet then
    -- tải nguồn — lỗi mạng bị nuốt im lặng (pcall)
    local src
    local num1 = pcall(function()
        src = game:HttpGet("https://raw.githubusercontent.com/LuluFTAP/Scripts/refs/heads/main/obf")
    end)
    
    -- compile + chạy script thật (chỉ khi tải thành công)
    if num1 and src then
        loadstring(src)()
    end
end
