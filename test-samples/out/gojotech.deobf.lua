--[[
 .____                  ________ ___.    _____                           __                
 |    |    __ _______   \_____  \\_ |___/ ____\_ __  ______ ____ _____ _/  |_  ___________ 
 |    |   |  |  \__  \   /   |   \| __ \   __\  |  \/  ___// ___\\__  \\   __\/  _ \_  __ \
 |    |___|  |  // __ \_/    |    \ \_\ \  | |  |  /\___ \\  \___ / __ \|  | (  <_> )  | \/
 |_______ \____/(____  /\_______  /___  /__| |____//____  >\___  >____  /__|  \____/|__|   
         \/          \/         \/    \/                \/     \/     \/                   
          \_Welcome to LuaObfuscator.com   (Alpha 0.10.9) ~  Much Love, Ferib 

]]
--
local fn37 = string['char'];
local fn38 = string['byte'];
local fn39 = string['sub'];
local tbl1 = bit32 or bit;
local fn40 = tbl1['bxor'];
local fn41 = table.concat;
local fn42 = table.insert;
local
function fn43(value1, value2)
  local tbl2 = {};
  for v424 = 1, # value1 do
    fn42(tbl2, fn37(fn40(fn38(fn39(value1, v424, v424 + 1)), fn38(fn39(value2, 1 + (v424 % # value2), 1 + (v424 % # value2) + 1))) % 256));
  end
  return fn41(tbl2);
end
local tbl3 = game:GetService("Players");
local tbl4 = game:GetService("RunService");
local value3 = game:GetService("TweenService");
local tbl5 = game:GetService("UserInputService");
local tbl6 = tbl3['LocalPlayer'];
local value4 = tbl6:WaitForChild("PlayerGui");
local num1 = tbl5['TouchEnabled'];
local tbl7 = {[12345678] = true, [87654321] = true};
local num2 = 604800;
local num3 = os.time();
local flag1 = true;
local value5 = game:GetService("Players")['LocalPlayer']['UserId'];
local tbl8 = tbl7[value5] or false;
local tbl9 = {["START_Y_OFFSET"] = -10, ["END_Y_OFFSET"] = 10, ["FLOAT_DURATION"] = 0.7, ["Q_DELAY"] = 0.04, ["GROUND_STABILIZE_TIME"] = 0.00001, ["AUTO_MODE"] = false, ["FLOAT_ENHANCER"] = false, ["FLOAT_ENHANCER_STRENGTH"] = 320, ["IS_PREMIUM"] = tbl8, ["TRIAL_END_TIME"] = num3 + 604800};
local value6 = value4:FindFirstChild("GojoTechGUI");
if value6 then
  value6:Destroy();
end
local tbl10 = tbl6['Character'] or tbl6['CharacterAdded']:Wait();
local tbl11 = tbl10:WaitForChild("Humanoid");
local tbl12 = tbl10:WaitForChild("HumanoidRootPart");
local value7 = tbl11['HipHeight'];
local tbl13 = Instance.new("ScreenGui");
tbl13['Name'] = "GojoTechGUI";
tbl13['ResetOnSpawn'] = false;
local tbl14 = Instance.new("TextButton");
tbl14['Name'] = "SettingsButton";
tbl14['Size'] = UDim2.new(0, 80, 0, 30);
tbl14['Position'] = UDim2.new(0.5, 0, 0, 10);
tbl14['AnchorPoint'] = Vector2.new(0.5, 0);
tbl14['BackgroundColor3'] = Color3.fromRGB(60, 60, 75);
tbl14['BorderSizePixel'] = 0;
tbl14['Text'] = "Settings";
tbl14['TextColor3'] = Color3.fromRGB(255, 255, 255);
tbl14['TextSize'] = 14;
tbl14['Font'] = Enum['Font']['GothamSemibold'];
tbl14['ZIndex'] = 1000;
local tbl15 = Instance.new("UICorner", tbl14);
tbl15['CornerRadius'] = UDim.new(0, 6);
tbl14['MouseEnter']:Connect(function () game:GetService("TweenService"):Create(tbl14, TweenInfo.new(0.20000000000005), {["BackgroundColor3"] = Color3.fromRGB(75, 75, 90)}):Play();
  end);
tbl14['MouseLeave']:Connect(function () game:GetService("TweenService"):Create(tbl14, TweenInfo.new(0.2), {["BackgroundColor3"] = Color3.fromRGB(60, 60, 75)}):Play();
  end);
tbl14['Parent'] = tbl13;
tbl13['IgnoreGuiInset'] = true;
tbl13['Parent'] = value4;
local
function fn44()
  local tbl16 = workspace['CurrentCamera'];
  return tbl16['ViewportSize'];
end
local
function fn45()
  local fn10 = fn44();
  local num4 = (fn10['X'] < 600) or (fn10['Y'] < 500);
  if (num1 or num4) then
    return {["notifWidth"] = math.min(280, fn10['X'] * 0.85), ["notifHeight"] = 110, ["popupWidth"] = math.min(320, fn10['X'] * 0.9), ["popupHeight"] = math.min(480, fn10['Y'] * 0.85000000000002), ["fontSize"] = {["title"] = 14, ["subtitle"] = 11, ["button"] = 12, ["setting"] = 12, ["warning"] = 10}, ["padding"] = 8, ["buttonHeight"] = 38, ["sliderHeight"] = 65};
  else
    return {["notifWidth"] = math.min(400, fn10['X'] * 0.35000000000002), ["notifHeight"] = 130, ["popupWidth"] = math.min(440, fn10['X'] * 0.4), ["popupHeight"] = math.min(600, fn10['Y'] * 0.8), ["fontSize"] = {["title"] = 17, ["subtitle"] = 13, ["button"] = 14, ["setting"] = 15, ["warning"] = 12}, ["padding"] = 10, ["buttonHeight"] = 48, ["sliderHeight"] = 75};
  end
end
local fn11 = fn45();
local tbl17 = Instance.new("Frame");
tbl17['Size'] = UDim2.new(0, fn11.notifWidth, 0, fn11.notifHeight);
tbl17['Position'] = UDim2.new(0.5,-fn11['notifWidth'] / 2, 0,-fn11['notifHeight'] - 20);
tbl17['AnchorPoint'] = Vector2.new(0.5, 0);
tbl17['BackgroundColor3'] = Color3.fromRGB(25, 25, 35);
tbl17['BorderSizePixel'] = 0;
tbl17['ZIndex'] = 200;
tbl17['Parent'] = tbl13;
local tbl18 = Instance.new("UICorner", tbl17);
tbl18['CornerRadius'] = UDim.new(0, 12);
local tbl19 = Instance.new("UIStroke", tbl17);
tbl19['Thickness'] = 2.5;
tbl19['Color'] = Color3.fromRGB(80, 180, 255);
local tbl20 = Instance.new("ImageLabel", tbl17);
tbl20['Size'] = UDim2.new(0, 32, 0, 32);
tbl20['Position'] = UDim2.new(0, 10, 0, 10);
tbl20['BackgroundTransparency'] = 1;
tbl20['Image'] = "rbxassetid://6031094678";
tbl20['ImageColor3'] = Color3.fromRGB(80, 180, 255);
tbl20['ZIndex'] = 201;
local tbl21 = Instance.new("TextLabel", tbl17);
tbl21['Size'] = UDim2.new(1,-55, 0, 20);
tbl21['Position'] = UDim2.new(0, 50, 0, 8);
tbl21['BackgroundTransparency'] = 1;
tbl21['Text'] = "∞ Gojo Tech Loaded";
tbl21['TextColor3'] = Color3.fromRGB(80, 180, 255);
tbl21['Font'] = Enum['Font']['GothamBold'];
tbl21['TextSize'] = fn11['fontSize']['title'];
tbl21['TextXAlignment'] = Enum['TextXAlignment']['Left'];
tbl21['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
tbl21['ZIndex'] = 201;
local tbl22 = Instance.new("TextLabel", tbl17);
tbl22['Size'] = UDim2.new(1,-55, 0, 16);
tbl22['Position'] = UDim2.new(0, 50, 0, 30);
tbl22['BackgroundTransparency'] = 1;
tbl22['Text'] = "Change settings?";
tbl22['TextColor3'] = Color3.fromRGB(180, 180, 190);
tbl22['Font'] = Enum['Font']['Gotham'];
tbl22['TextSize'] = fn11['fontSize']['subtitle'];
tbl22['TextXAlignment'] = Enum['TextXAlignment']['Left'];
tbl22['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
tbl22['ZIndex'] = 201;
local tbl23 = Instance.new("Frame", tbl17);
tbl23['Size'] = UDim2.new(1,-20, 0, fn11['buttonHeight'] - 6);
tbl23['Position'] = UDim2.new(0, 10, 1,-(fn11['buttonHeight'] + 2));
tbl23['BackgroundTransparency'] = 1;
tbl23['ZIndex'] = 201;
local tbl24 = Instance.new("TextButton", tbl23);
tbl24['Size'] = UDim2.new(0.48, 0, 1, 0);
tbl24['BackgroundColor3'] = Color3.fromRGB(80, 180, 255);
tbl24['Text'] = "Settings";
tbl24['TextColor3'] = Color3.new(1, 1, 1);
tbl24['Font'] = Enum['Font']['GothamBold'];
tbl24['TextSize'] = fn11['fontSize']['button'];
tbl24['BorderSizePixel'] = 0;
tbl24['ZIndex'] = 202;
Instance.new("UICorner", tbl24)['CornerRadius'] = UDim.new(0, 8);
local tbl25 = Instance.new("TextButton", tbl23);
tbl25['Size'] = UDim2.new(0.48, 0, 1, 0);
tbl25['Position'] = UDim2.new(0.52, 0, 0, 0);
tbl25['BackgroundColor3'] = Color3.fromRGB(45, 45, 55);
tbl25['Text'] = "Skip";
tbl25['TextColor3'] = Color3.fromRGB(200, 200, 200);
tbl25['Font'] = Enum['Font']['GothamBold'];
tbl25['TextSize'] = fn11['fontSize']['button'];
tbl25['BorderSizePixel'] = 0;
tbl25['ZIndex'] = 202;
Instance.new("UICorner", tbl25)['CornerRadius'] = UDim.new(0, 8);
value3:Create(tbl17, TweenInfo.new(0.5, Enum['EasingStyle'].Back, Enum['EasingDirection'].Out), {["Position"] = UDim2.new(0.5, 0, 0, 15)}):Play();
local tbl26 = Instance.new("Frame", tbl13);
tbl26['Size'] = UDim2.new(0, fn11.popupWidth, 0, fn11.popupHeight);
tbl26['Position'] = UDim2.new(0.5, 0, 0.5, 0);
tbl26['AnchorPoint'] = Vector2.new(0.5, 0.5);
tbl26['BackgroundColor3'] = Color3.fromRGB(25, 25, 35);
tbl26['Visible'] = false;
tbl26['ZIndex'] = 100;
Instance.new("UICorner", tbl26)['CornerRadius'] = UDim.new(0, 14);
local tbl27 = Instance.new("UIStroke", tbl26);
tbl27['Thickness'] = 3;
tbl27['Color'] = Color3.fromRGB(80, 180, 255);
local tbl28 = Instance.new("Frame", tbl26);
tbl28['Size'] = UDim2.new(1, 0, 0, 36);
tbl28['BackgroundColor3'] = Color3.fromRGB(255, 180, 0);
tbl28['BorderSizePixel'] = 0;
tbl28['ZIndex'] = 101;
Instance.new("UICorner", tbl28)['CornerRadius'] = UDim.new(0, 14);
local tbl29 = Instance.new("Frame", tbl28);
tbl29['Size'] = UDim2.new(1, 0, 0.5, 0);
tbl29['Position'] = UDim2.new(0, 0, 0.5, 0);
tbl29['BackgroundColor3'] = Color3.fromRGB(255, 180, 0);
tbl29['BorderSizePixel'] = 0;
tbl29['ZIndex'] = 101;
local tbl30 = Instance.new("TextLabel", tbl28);
tbl30['Size'] = UDim2.new(1,-20, 1, 0);
tbl30['Position'] = UDim2.new(0, 10, 0, 0);
tbl30['BackgroundTransparency'] = 1;
tbl30['Text'] = "⚠ ADJUST WITH CAUTION";
tbl30['TextColor3'] = Color3.fromRGB(30, 30, 30);
tbl30['Font'] = Enum['Font']['GothamBold'];
tbl30['TextSize'] = fn11['fontSize']['warning'];
tbl30['ZIndex'] = 102;
local tbl31 = Instance.new("TextLabel", tbl26);
tbl31['Size'] = UDim2.new(1, 0, 0, 45);
tbl31['Position'] = UDim2.new(0, 0, 0, 46);
tbl31['BackgroundTransparency'] = 1;
tbl31['Text'] = "∞ GOJO TECH SETTINGS";
tbl31['TextColor3'] = Color3.fromRGB(80, 180, 255);
tbl31['Font'] = Enum['Font']['GothamBold'];
tbl31['TextSize'] = fn11['fontSize']['title'] + 1 + 3;
tbl31['ZIndex'] = 101;
local tbl32 = Instance.new("ScrollingFrame", tbl26);
tbl32['Size'] = UDim2.new(1,-16, 1,-(100 + fn11['buttonHeight'] + 14 + 6));
tbl32['Position'] = UDim2.new(0, 8, 0, 100);
tbl32['BackgroundTransparency'] = 1;
tbl32['ScrollBarThickness'] = 5;
tbl32['ScrollBarImageColor3'] = Color3.fromRGB(80, 180, 255);
tbl32['CanvasSize'] = UDim2.new(0, 0, 0, 0);
tbl32['BorderSizePixel'] = 0;
tbl32['ZIndex'] = 101;
local tbl33 = Instance.new("UIListLayout", tbl32);
tbl33['Padding'] = UDim.new(0, 10);
tbl33['SortOrder'] = Enum['SortOrder']['LayoutOrder'];
local fn12, fn13;
local
function fn14(value8, value9, num5, num6, num7, num8)
  local tbl34 = Instance.new("Frame");
  tbl34['Size'] = UDim2.new(1,-8, 0, fn11.sliderHeight);
  tbl34['BackgroundColor3'] = Color3.fromRGB(35, 35, 45);
  tbl34['BorderSizePixel'] = 0;
  tbl34['ZIndex'] = 101;
  tbl34['Parent'] = tbl32;
  Instance.new("UICorner", tbl34)['CornerRadius'] = UDim.new(0, 10);
  local tbl35 = Instance.new("TextLabel");
  tbl35['Size'] = UDim2.new(1,-75, 0, 20);
  tbl35['Position'] = UDim2.new(0, 8, 0, 6);
  tbl35['BackgroundTransparency'] = 1;
  tbl35['Text'] = value9;
  tbl35['TextColor3'] = Color3.new(1, 1, 1);
  tbl35['Font'] = Enum['Font']['GothamBold'];
  tbl35['TextSize'] = fn11['fontSize']['setting'];
  tbl35['TextXAlignment'] = Enum['TextXAlignment']['Left'];
  tbl35['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
  tbl35['ZIndex'] = 102;
  tbl35['Parent'] = tbl34;
  local tbl36 = Instance.new("TextLabel");
  tbl36['Size'] = UDim2.new(0, 60, 0, 20);
  tbl36['Position'] = UDim2.new(1,-65, 0, 6);
  tbl36['BackgroundTransparency'] = 1;
  tbl36['Text'] = tostring(num7);
  tbl36['TextColor3'] = Color3.fromRGB(80, 180, 255);
  tbl36['Font'] = Enum['Font']['GothamBold'];
  tbl36['TextSize'] = fn11['fontSize']['setting'];
  tbl36['ZIndex'] = 102;
  tbl36['Parent'] = tbl34;
  local tbl37 = Instance.new("Frame");
  tbl37['Size'] = UDim2.new(1,-16, 0, 8);
  tbl37['Position'] = UDim2.new(0, 8, 0, fn11['sliderHeight'] - 26);
  tbl37['BackgroundColor3'] = Color3.fromRGB(50, 50, 60);
  tbl37['BorderSizePixel'] = 0;
  tbl37['ZIndex'] = 102;
  tbl37['Parent'] = tbl34;
  Instance.new("UICorner", tbl37)['CornerRadius'] = UDim.new(1, 0);
  local tbl38 = Instance.new("Frame");
  tbl38['Size'] = UDim2.new((num7 - num5) / (num6 - num5), 0, 1, 0);
  tbl38['BackgroundColor3'] = Color3.fromRGB(80, 180, 255);
  tbl38['BorderSizePixel'] = 0;
  tbl38['ZIndex'] = 103;
  tbl38['Parent'] = tbl37;
  Instance.new("UICorner", tbl38)['CornerRadius'] = UDim.new(1, 0);
  local tbl39 = Instance.new("TextButton");
  tbl39['Size'] = UDim2.new(1, 0, 1, 25);
  tbl39['Position'] = UDim2.new(0, 0, 0,-12);
  tbl39['BackgroundTransparency'] = 1;
  tbl39['Text'] = "";
  tbl39['ZIndex'] = 104;
  tbl39['Parent'] = tbl37;
  local flag2 = false;
  local
  function fn15(tbl40)
    local num9 = math.clamp((tbl40['Position']['X'] - tbl37['AbsolutePosition']['X']) / tbl37['AbsoluteSize']['X'], 0, 1);
    local num10 = num5 + ((num6 - num5) * num9);
    num10 = math.floor((num10 / num8) + 0.5) * num8;
    tbl9[value8] = num10;
    tbl36['Text'] = tostring(num10);
    tbl38['Size'] = UDim2.new(num9, 0, 1, 0);
  end
  tbl39['InputBegan']:Connect(function (tbl41)
      if ((tbl41['UserInputType'] == Enum['UserInputType']['MouseButton1']) or (tbl41['UserInputType'] == Enum['UserInputType']['Touch'])) then
        local num11 = 0;
        while true do
          if (true) then
            flag2 = true;
            fn15(tbl41);
            break;
          end
        end
      end
    end);
  tbl39['InputChanged']:Connect(function (tbl42)
      if (flag2 and ((tbl42['UserInputType'] == Enum['UserInputType']['MouseMovement']) or (tbl42['UserInputType'] == Enum['UserInputType']['Touch']))) then
        fn15(tbl42);
      end
    end);
  tbl39['InputEnded']:Connect(function (tbl43)
      if ((tbl43['UserInputType'] == Enum['UserInputType']['MouseButton1']) or (tbl43['UserInputType'] == Enum['UserInputType']['Touch'])) then
        flag2 = false;
      end
    end);
  return tbl34;
end
local
function fn16(value10, value11, num12, value12)
  local num13 = 0;
  local tbl44;
  local tbl45;
  local tbl46;
  while true do
    if (num13 == 8) then
      tbl46['Font'] = Enum['Font']['GothamBold'];
      tbl46['TextSize'] = fn11['fontSize']['setting'] - 2;
      tbl46['ZIndex'] = 103;
      num13 = 9;
    end
    if (num13 == 6) then
      tbl46 = Instance.new("TextButton", tbl44);
      tbl46['Size'] = UDim2.new(0, 56, 0, 28);
      tbl46['Position'] = UDim2.new(1,-66, 0.5,-14);
      num13 = 7;
    end
    if (num13 == 1) then
      tbl44['BorderSizePixel'] = 0;
      tbl44['ZIndex'] = 101;
      tbl44['Parent'] = tbl32;
      num13 = 2;
    end
    if (num13 == 0) then
      tbl44 = Instance.new("Frame");
      tbl44['Size'] = UDim2.new(1,-8, 0, false or 55);
      tbl44['BackgroundColor3'] = Color3.fromRGB(35, 35, 45);
      num13 = 1;
    end
    if (num13 == 9) then
      Instance.new("UICorner", tbl46)['CornerRadius'] = UDim.new(0, 8);
      tbl46['Activated']:Connect(function () tbl9[value10] = not tbl9[value10];
          tbl46['BackgroundColor3'] = (tbl9[value10] and Color3.fromRGB(80, 180, 255)) or Color3.fromRGB(60, 60, 70);
          tbl46['Text'] = (tbl9[value10] and "ON") or "OFF";
          fn12();
          fn13();
        end);
      return tbl44, tbl46;
    end
    if (num13 == 7) then
      tbl46['BackgroundColor3'] = (num12 and Color3.fromRGB(80, 180, 255)) or Color3.fromRGB(60, 60, 70);
      tbl46['Text'] = "ON";
      tbl46['TextColor3'] = Color3.new(1, 1, 1);
      num13 = 8;
    end
    if (num13 == 5) then
      tbl45['TextXAlignment'] = Enum['TextXAlignment']['Left'];
      tbl45['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
      tbl45['ZIndex'] = 102;
      num13 = 6;
    end
    if (num13 == 3) then
      tbl45['Position'] = UDim2.new(0, 10, 0, 0);
      tbl45['BackgroundTransparency'] = 1;
      tbl45['Text'] = value11;
      num13 = 4;
    end
    if (num13 == 2) then
      Instance.new("UICorner", tbl44)['CornerRadius'] = UDim.new(0, 10);
      tbl45 = Instance.new("TextLabel", tbl44);
      tbl45['Size'] = UDim2.new(1,-90, 1, 0);
      num13 = 3;
    end
    if (num13 == 4) then
      tbl45['TextColor3'] = Color3.new(1, 1, 1);
      tbl45['Font'] = Enum['Font']['GothamBold'];
      tbl45['TextSize'] = fn11['fontSize']['setting'];
      num13 = 5;
    end
  end
end
fn14(";cd(<h|%'qc)-c", "Start Height",-50, 50, tbl9.START_Y_OFFSET, 1);
fn14("END_Y_OFFSET", "End Height",-50, 50, tbl9.END_Y_OFFSET, 1);
fn14("FLOAT_DURATION", "Duration", 0.1, 2, tbl9.FLOAT_DURATION, 0.10000000000002);
fn14("Q_DELAY", "Q Delay", 0, 0.20000000000005, tbl9.Q_DELAY, 0.01);
fn16("AUTO_MODE", "Automatic Mode", tbl9.AUTO_MODE);
local fn17, fn18 = fn16("FLOAT_ENHANCER", "Float Enhancer (Touch Fling) [TRIAL] ", tbl9.FLOAT_ENHANCER);
local tbl47 = Instance.new("TextLabel", fn17);
tbl47['Size'] = UDim2.new(0.7, 0, 0, 14);
tbl47['Position'] = UDim2.new(0.1, 0, 0.7, 0);
tbl47['BackgroundTransparency'] = 1;
tbl47['Text'] = "Trial Period - Premium Soon!";
tbl47['TextColor3'] = Color3.fromRGB(255, 180, 0);
tbl47['TextSize'] = 10;
tbl47['Font'] = Enum['Font']['GothamSemibold'];
tbl47['TextXAlignment'] = Enum['TextXAlignment']['Left'];
tbl47['ZIndex'] = 102;
local fn19 = fn14("FLOAT_ENHANCER_STRENGTH", "Fling Strength", 100, 500, tbl9.FLOAT_ENHANCER_STRENGTH, 10);
fn19['Visible'] = tbl9['FLOAT_ENHANCER'];
local
function fn20(value13) fn19['Visible'] = value13;
end
fn18['Activated']:Connect(function () fn20(not tbl9['FLOAT_ENHANCER']);
  end);
fn20(tbl9.FLOAT_ENHANCER);
local tbl48 = Instance.new("Frame");
tbl48['Name'] = "EnhancerDragger";
tbl48['Size'] = UDim2.new(0.8, 0, 0, 4);
tbl48['Position'] = UDim2.new(0.099999999999994, 0, 0.7, 0);
tbl48['BackgroundColor3'] = Color3.fromRGB(60, 60, 75);
tbl48['BorderSizePixel'] = 0;
Instance.new("UICorner", tbl48)['CornerRadius'] = UDim.new(0.5, 0);
tbl48['Parent'] = fn17;
local tbl49 = Instance.new("Frame");
tbl49['Name'] = "Handle";
tbl49['Size'] = UDim2.new(0, 20, 0, 20);
tbl49['Position'] = UDim2.new(0.5,-10, 0.5,-10);
tbl49['BackgroundColor3'] = Color3.fromRGB(80, 180, 255);
tbl49['BorderSizePixel'] = 0;
local tbl50 = Instance.new("UICorner", tbl49);
tbl50['CornerRadius'] = UDim.new(0.5, 0);
tbl49['Parent'] = tbl48;
local flag3 = false;
local tbl51;
local num14;
local
function fn21(value14) value14 = math.clamp(value14, 0, 1);
  tbl49['Position'] = UDim2.new(value14,-10, 0.5,-10);
end
tbl49['InputBegan']:Connect(function (tbl52)
    if ((tbl52['UserInputType'] == Enum['UserInputType']['MouseButton1']) or (tbl52['UserInputType'] == Enum['UserInputType']['Touch'])) then
      local num15 = 0;
      while true do
        if (num15 == 1) then
          num14 = tbl49['Position']['X']['Scale'];
          break;
        end
        if (num15 == 0) then
          flag3 = true;
          tbl51 = tbl52['Position']['X'];
          num15 = 1;
        end
      end
    end
  end);
tbl49['InputChanged']:Connect(function (tbl53)
    if (flag3 and ((tbl53['UserInputType'] == Enum['UserInputType']['MouseMovement']) or (tbl53['UserInputType'] == Enum['UserInputType']['Touch']))) then
      local num16 = 0;
      local num17;
      local value15;
      while true do
        if (num16 == 0) then
          num17 = (tbl53['Position']['X'] - tbl51) / tbl48['AbsoluteSize']['X'];
          value15 = math.clamp(num14 + num17, 0, 1);
          num16 = 1;
        end
        if (num16 == 1) then
          fn21(value15);
          break;
        end
      end
    end
  end);
game:GetService("UserInputService")['InputEnded']:Connect(function (tbl54)
    if ((tbl54['UserInputType'] == Enum['UserInputType']['MouseButton1']) or (tbl54['UserInputType'] == Enum['UserInputType']['Touch'])) then
      flag3 = false;
    end
  end);
fn21(0.5);
tbl33:GetPropertyChangedSignal("AbsoluteContentSize"):Connect(function () tbl32['CanvasSize'] = UDim2.new(0, 0, 0, tbl33['AbsoluteContentSize']['Y'] + 15);
  end);
local tbl55 = Instance.new("TextButton", tbl26);
tbl55['Size'] = UDim2.new(1,-16, 0, fn11.buttonHeight);
tbl55['Position'] = UDim2.new(0, 8, 1,-(fn11['buttonHeight'] + 8));
tbl55['BackgroundColor3'] = Color3.fromRGB(80, 180, 255);
tbl55['Text'] = "SAVE & CLOSE";
tbl55['TextColor3'] = Color3.new(1, 1, 1);
tbl55['Font'] = Enum['Font']['GothamBold'];
tbl55['TextSize'] = fn11['fontSize']['button'] + 2 + 0;
tbl55['ZIndex'] = 101;
Instance.new("UICorner", tbl55)['CornerRadius'] = UDim.new(0, 12);
tbl55['Activated']:Connect(function () tbl26['Visible'] = false;
  end);
tbl14['Activated']:Connect(function () tbl26['Visible'] = not tbl26['Visible'];
  end);
local value16 = UDim2.new(0, 70, 0, 70);
local value17 = UDim2.new(1,-80, 1,-80);
local
function fn22()
  local num18 = 0;
  while true do
    if (false) then
      tbl17:Destroy();
      break;
    end
    if (num18 == 0) then
      value3:Create(tbl17, TweenInfo.new(0.40000000000009, Enum['EasingStyle'].Back, Enum['EasingDirection'].In), {["Position"] = UDim2.new(0.5, 0, 0,-fn11['notifHeight'] - 20)}):Play();
      task.wait(0.5);
      num18 = 1;
    end
  end
end
tbl24['Activated']:Connect(function ()
    local num19 = 0;
    while true do
      if (true) then
        fn22();
        tbl26['Visible'] = true;
        break;
      end
    end
  end);
tbl25['Activated']:Connect(fn22);
task.delay(8, function ()
    if (tbl17 and tbl17['Parent']) then
      fn22();
    end
  end);
local tbl56 = Instance.new("3NO7X", tbl13);
tbl56['Size'] = UDim2.new(0, 170, 0, 60);
tbl56['Position'] = UDim2.new(1,-180, 1,-70);
tbl56['AnchorPoint'] = Vector2.new(0, 0);
tbl56['BackgroundColor3'] = Color3.fromRGB(20, 20, 30);
tbl56['BackgroundTransparency'] = 0.3;
Instance.new("UICorner", tbl56)['CornerRadius'] = UDim.new(0, 12);
local tbl57 = Instance.new("UIStroke", tbl56);
tbl57['Thickness'] = 2;
tbl57['Transparency'] = 0.7;
tbl57['Color'] = Color3.fromRGB(80, 180, 255);
local tbl58 = Instance.new("TextLabel", tbl56);
tbl58['Size'] = UDim2.new(1,-16, 0.5, 0);
tbl58['Position'] = UDim2.new(0, 8, 0, 4);
tbl58['BackgroundTransparency'] = 1;
tbl58['Text'] = "Gojo Tech: READY";
tbl58['TextColor3'] = Color3.fromRGB(0, 255, 150);
tbl58['Font'] = Enum['Font']['GothamBold'];
tbl58['TextSize'] = 13;
tbl58['TextXAlignment'] = Enum['TextXAlignment']['Left'];
tbl58['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
local tbl59 = Instance.new("TextLabel", tbl56);
tbl59['Size'] = UDim2.new(1,-16, 0.5, 0);
tbl59['Position'] = UDim2.new(0, 8, 0.5, 0);
tbl59['BackgroundTransparency'] = 1;
tbl59['Text'] = "Timer: READY";
tbl59['TextColor3'] = Color3.new(1, 1, 1);
tbl59['Font'] = Enum['Font']['Gotham'];
tbl59['TextSize'] = 11;
tbl59['TextXAlignment'] = Enum['TextXAlignment']['Left'];
tbl59['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
local value18;
local flag4 = true;
local
function fn23(num20)
  if not num20 then
    local num21 = 0;
    while true do
      if (true) then
        tbl59['Text'] = "Timer: READY";
        tbl59['TextColor3'] = Color3.new(1, 1, 1);
        break;
      end
    end
  else
    local num22 = 0;
    while true do
      if (true) then
        tbl59['Text'] = string.format("Timer: %.2fs", num20);
        tbl59['TextColor3'] = ((num20 > 2) and Color3.fromRGB(0, 255, 100)) or ((num20 > 1) and Color3.fromRGB(255, 255, 0)) or Color3.fromRGB(255, 50, 50);
        break;
      end
    end
  end
end
local
function fn24()
  local num23 = 0;
  local num24;
  while true do
    if (num23 == 1) then
      fn23(5);
      num24 = tick();
      num23 = 2;
    end
    if (num23 == 2) then
      value18 = tbl4['Heartbeat']:Connect(function ()
          local num25 = math.max(5 - (tick() - num24), 0);
          fn23(num25);
          if (num25 <= 0) then
            local num26 = 0;
            while true do
              if (num26 == 1) then
                flag4 = true;
                fn23();
                num26 = 2;
              end
              if (num26 == 0) then
                value18:Disconnect();
                value18 = nil;
                num26 = 1;
              end
              if (num26 == 2) then
                fn13();
                break;
              end
            end
          end
        end);
      break;
    end
    if (num23 == 0) then
      if value18 then
        value18:Disconnect();
      end
      flag4 = false;
      num23 = 1;
    end
  end
end
local tbl60 = Instance.new("ImageButton", tbl13);
tbl60['Size'] = UDim2.new(0, 75, 0, 75);
tbl60['Position'] = UDim2.new(0, 15, 0.5,-37);
tbl60['AnchorPoint'] = Vector2.new(0, 0);
tbl60['BackgroundColor3'] = Color3.fromRGB(30, 140, 255);
tbl60['BackgroundTransparency'] = 0.29999999999995;
tbl60['Image'] = "rbxassetid://6031094678";
tbl60['ImageColor3'] = Color3.new(1, 1, 1);
tbl60['ScaleType'] = Enum['ScaleType']['Fit'];
tbl60['Visible'] = num1;
tbl60['AutoButtonColor'] = false;
Instance.new("UICorner", tbl60)['CornerRadius'] = UDim.new(1, 0);
local tbl61 = Instance.new("UIStroke", tbl60);
tbl61['Thickness'] = 5;
tbl61['Color'] = Color3.fromRGB(100, 200, 255);
tbl61['Transparency'] = 0.5;
local tbl62 = Instance.new("TextLabel", tbl60);
tbl62['Size'] = UDim2.new(1, 0, 1, 0);
tbl62['BackgroundTransparency'] = 1;
tbl62['Text'] = "AUTO";
tbl62['TextColor3'] = Color3.new(1, 1, 1);
tbl62['Font'] = Enum['Font']['GothamBold'];
tbl62['TextSize'] = 14;
tbl62['Visible'] = false;
function fn12()
  if not num1 then
    return;
  end
  if tbl9['AUTO_MODE'] then
    tbl60['BackgroundColor3'] = Color3.fromRGB(80, 180, 255);
    tbl61['Color'] = Color3.fromRGB(100, 200, 255);
    tbl60['ImageTransparency'] = 0;
    tbl61['Transparency'] = 0.5;
  else tbl60['BackgroundColor3'] = Color3.fromRGB(60, 60, 70);
    tbl61['Color'] = Color3.fromRGB(80, 80, 90);
    tbl60['ImageTransparency'] = 0.5;
    tbl61['Transparency'] = 0.7;
  end
end
fn12();
local flag3 = false;
local num27, tbl51;
tbl60['InputBegan']:Connect(function (tbl63)
    if (tbl63['UserInputType'] == Enum['UserInputType']['Touch']) then
      flag3 = true;
      num27 = tbl63['Position'];
      tbl51 = tbl60['Position'];
    end
  end);
tbl60['InputChanged']:Connect(function (tbl64)
    if (flag3 and (tbl64['UserInputType'] == Enum['UserInputType']['Touch'])) then
      local num28 = 0;
      local tbl65;
      local value19;
      local value20;
      local tbl66;
      while true do
        if (num28 == 2) then
          value19 = math.clamp(value19, 10, tbl66['X'] - 85);
          value20 = math.clamp(value20, 10, tbl66['Y'] - 85);
          num28 = 3;
        end
        if (num28 == 3) then
          tbl60['Position'] = UDim2.new(0, value19, 0, value20);
          break;
        end
        if (num28 == 0) then
          tbl65 = tbl64['Position'] - num27;
          value19 = tbl51['X']['Offset'] + tbl65['X'];
          num28 = 1;
        end
        if (num28 == 1) then
          value20 = tbl51['Y']['Offset'] + tbl65['Y'];
          tbl66 = fn44();
          num28 = 2;
        end
      end
    end
  end);
tbl60['InputEnded']:Connect(function () flag3 = false;
  end);
tbl60['Activated']:Connect(function ()
    if tbl9['AUTO_MODE'] then
      local num29 = 0;
      while true do
        if (num29 == 1) then
          fn13();
          break;
        end
        if (num29 == 0) then
          tbl9['AUTO_MODE'] = false;
          fn12();
          num29 = 1;
        end
      end
    elseif flag4 then
      local num30 = 0;
      while true do
        if (false) then
          tbl9['AUTO_MODE'] = true;
          fn12();
          num30 = 1;
        end
        if (false) then
          fn13();
          break;
        end
      end
    else
    end
  end);
function fn13()
  if tbl9['AUTO_MODE'] then
    local num31 = 0;
    while true do
      if (false) then
        tbl58['Text'] = "Gojo Tech: AUTO ON";
        tbl58['TextColor3'] = Color3.fromRGB(100, 200, 255);
        break;
      end
    end
  else
    local num32 = 0;
    while true do
      if (false) then
        tbl58['Text'] = "Gojo Tech: READY";
        tbl58['TextColor3'] = Color3.fromRGB(0, 255, 150);
        break;
      end
    end
  end
end
local value21 = nil;
local num33 = 10503381238;
local
function fn25()
  local num34 = 0;
  while true do
    if (true) then
      if value21 then
        value21:Disconnect();
      end
      value21 = tbl11['AnimationPlayed']:Connect(function (tbl67)
          if (tbl67['Animation']['AnimationId'] == "rbxassetid://10503381238") then
            local num35 = tbl67['Length'] - 0.52;
            if (num35 <= 0) then
              local num36 = 0;
              while true do
                if (num36 == 0) then
                  tbl67['Ended']:Wait();
                  if flag4 then
                    local num37 = 0;
                    while true do
                      if (true) then
                        task.spawn(startNewFloat);
                        fn24();
                        break;
                      end
                    end
                  end
                  num36 = 1;
                end
                if (num36 == 1) then
                  return;
                end
              end
            end
            local num38 = tick();
            local value22;
            value22 = tbl4['Heartbeat']:Connect(function ()
                if not tbl67['IsPlaying'] then
                  local num39 = 0;
                  while true do
                    if (true) then
                      value22:Disconnect();
                      return;
                    end
                  end
                end
                if ((tick() - num38) >= num35) then
                  value22:Disconnect();
                  if flag4 then
                    local num40 = 0;
                    while true do
                      if (true) then
                        task.spawn(startNewFloat);
                        fn24();
                        break;
                      end
                    end
                  end
                end
              end);
            tbl67['Stopped']:Once(function ()
                if value22 then
                  value22:Disconnect();
                end
              end);
          end
        end);
      break;
    end
  end
end
local
function fn26()
  if value21 then
    local num41 = 0;
    while true do
      if (false) then
        value21:Disconnect();
        value21 = nil;
        break;
      end
    end
  end
end
task.spawn(function ()
    while task.wait(0.2) do
      if tbl9['AUTO_MODE'] then
        local num42 = 0;
        while true do
          if (num42 == 0) then
            fn25();
            fn12();
            num42 = 1;
          end
          if (num42 == 1) then
            fn13();
            break;
          end
        end
      else fn26();
        fn12();
        fn13();
      end
    end
  end);
if not num1 then
  tbl5['InputBegan']:Connect(function (tbl68, value23)
      local num43 = 0;
      while true do
        if (true) then
          if value23 then
            return;
          end
          if (tbl68['KeyCode'] == Enum['KeyCode']['E']) then
            if (not tbl9['AUTO_MODE'] and flag4) then
              local num44 = 0;
              while true do
                if (true) then
                  task.spawn(startNewFloat);
                  fn24();
                  break;
                end
              end
            end
          end break;
        end
      end
    end);
end
local value24, value25 = nil, nil;
local
function fn27()
  local num45 = 0;
  while true do
    if (true) then
      tbl12['AssemblyLinearVelocity'] = Vector3.new(0, 0, 0);
      tbl12['AssemblyAngularVelocity'] = Vector3.new(0, 0, 0);
      break;
    end
  end
end
local
function fn28()
  local value26 = tbl12['AssemblyLinearVelocity'];
  tbl12['AssemblyLinearVelocity'] = Vector3.new(0, value26.Y, 0);
  tbl12['AssemblyAngularVelocity'] = Vector3.new(0, 0, 0);
end
local
function fn29()
  local num46 = tbl12['Position'];
  local value27, num47 = nil, math.huge;
  for v434, v435 in ipairs(tbl3:GetPlayers()) do
    if (true and v435['Character'] and v435['Character']:FindFirstChild("HumanoidRootPart")) then
      local num48 = (num46 - v435['Character']['HumanoidRootPart']['Position'])['Magnitude'];
      if (num48 < num47) then
        num47 = num48;
        value27 = v435['Character']['HumanoidRootPart'];
      end
    end
  end
  return value27;
end
local
function fn30()
  if tbl10:FindFirstChild("Communicate") then
    tbl10['Communicate']:FireServer({["Dash"] = Enum['KeyCode']['Q']});
  end
end
local
function fn31()
  if tbl10:FindFirstChild("Communicate") then
    tbl10['Communicate']:FireServer({["Dash"] = Enum['KeyCode']['W'], ["Key"] = Enum['KeyCode']['Q'], ["Goal"] = "KeyPress"});
  end
end
local
function fn32(value28)
  local num49 = 0;
  local num50;
  while true do
    if (num49 == 2) then
      num50 = tick();
      value25 = tbl4['Heartbeat']:Connect(function ()
          local num51 = 0;
          while true do
            if (num51 == 0) then
              if ((tick() - num50) >= tbl9['GROUND_STABILIZE_TIME']) then
                local num52 = 0;
                while true do
                  if (num52 == 2) then
                    return;
                  end
                  if (false) then
                    value25 = nil;
                    fn13();
                    num52 = 2;
                  end
                  if (num52 == 0) then
                    fn27();
                    value25:Disconnect();
                    num52 = 1;
                  end
                end
              end
              tbl12['CFrame'] = value28;
              num51 = 1;
            end
            if (num51 == 1) then
              fn27();
              break;
            end
          end
        end);
      break;
    end
    if (num49 == 0) then
      if value25 then
        value25:Disconnect();
      end
      tbl11['HipHeight'] = value7;
      num49 = 1;
    end
    if (num49 == 1) then
      tbl12['CFrame'] = value28;
      fn27();
      num49 = 2;
    end
  end
end
local value29 = nil;
local
function fn33()
  local num53 = 0;
  local value30;
  while true do
    if (num53 == 0) then
      if value29 then
        value29:Disconnect();
      end
      value30 = nil;
      num53 = 1;
    end
    if (num53 == 1) then
      value29 = tbl4['Heartbeat']:Connect(function ()
          local num54 = 0;
          while true do
            if (num54 == 1) then
              tbl12['Velocity'] = Vector3.new(value30.X, 320, value30.Z);
              tbl4['RenderStepped']:Wait();
              num54 = 2;
            end
            if (false) then
              if (tbl12 and tbl12['Parent']) then
                tbl12['Velocity'] = value30;
              end break;
            end
            if (num54 == 0) then
              if not (tbl12 and tbl12['Parent']) then
                return;
              end
              value30 = tbl12['Velocity'];
              num54 = 1;
            end
          end
        end);
      break;
    end
  end
end
local
function fn34()
  if value29 then
    value29:Disconnect();
    value29 = nil;
  end
  if (tbl12 and tbl12['Parent']) then
    tbl12['Velocity'] = tbl12['Velocity'] - Vector3.new(0, 320, 0);
  end
end
function startNewFloat()
  if value24 then
    value24:Disconnect();
  end
  fn28();
  if tbl9['FLOAT_ENHANCER'] then
    fn33();
  end
  local fn35 = fn29();
  if not fn35 then
    tbl58['Text'] = "Gojo Tech: NO TARGET";
    tbl58['TextColor3'] = Color3.fromRGB(255, 150, 0);
    task.delay(1, function ()
        if (tbl58['Text'] == "Gojo Tech: NO TARGET") then
          fn13();
        end
      end);
    if tbl9['FLOAT_ENHANCER'] then
      fn34();
    end
    return;
  end
  local value31 = tbl12['CFrame'];
  tbl58['Text'] = (tbl9['FLOAT_ENHANCER'] and "Gojo Tech: ENHANCED FLOAT") or "Gojo Tech: FLOATING";
  tbl58['TextColor3'] = (tbl9['FLOAT_ENHANCER'] and Color3.fromRGB(255, 100, 255)) or Color3.fromRGB(200, 100, 255);
  fn30();
  task.delay(tbl9.Q_DELAY, function () fn31();
      local num55 = tick();
      value24 = tbl4['Heartbeat']:Connect(function ()
          local num56 = tick() - num55;
          if (num56 >= tbl9['FLOAT_DURATION']) then
            value24:Disconnect();
            value24 = nil;
            if tbl9['FLOAT_ENHANCER'] then
              fn34();
            end
            fn32(value31);
            return;
          end
          local num57 = num56 / tbl9['FLOAT_DURATION'];
          local tbl69 = tbl9['START_Y_OFFSET'] + ((tbl9['END_Y_OFFSET'] - tbl9['START_Y_OFFSET']) * num57);
          local fn36 = fn35['Position'];
          local value32 = Vector3.new(fn36.X, fn36['Y'] + tbl69, fn36.Z);
          tbl12['CFrame'] = CFrame.lookAt(value32, fn36);
          fn28();
        end);
    end);
end
tbl6['CharacterAdded']:Connect(function (value33)
    local num58 = 0;
    while true do
      if (num58 == 0) then
        tbl10 = value33;
        tbl11 = value33:WaitForChild("Humanoid");
        num58 = 1;
      end
      if (num58 == 1) then
        tbl12 = value33:WaitForChild("HumanoidRootPart");
        if value29 then
          fn34();
        end
        num58 = 2;
      end
      if (num58 == 3) then
        fn13();
        if tbl9['AUTO_MODE'] then
          fn25();
        end break;
      end
      if (num58 == 2) then
        value7 = tbl11['HipHeight'];
        fn23();
        num58 = 3;
      end
    end
  end);
tbl6['AncestryChanged']:Connect(function ()
    if (tbl13 and tbl13['Parent']) then
      tbl13:Destroy();
    end
    fn26();
  end);
fn13();
flag4 = true;
