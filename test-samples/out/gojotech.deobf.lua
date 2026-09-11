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
local value1 = string.char;
local value2 = string.byte;
local value3 = string.sub;
local value4 = bit32 or bit;
local value5 = bit32.bxor;
local value6 = table.concat;
local value7 = table.insert;
local
function fn31(value8, value9)
  local tbl1 = {};
  for v424 = 1, # value8 do
    table.insert(tbl1, string.char(bit32.bxor(string.byte(string.sub(value8, v424, v424 + 1)), string.byte(string.sub(value9, 1 + (v424 % # value9), 1 + (v424 % # value9) + 1))) % 256));
  end
  return table.concat(tbl1);
end
local tbl2 = game:GetService("Players");
local tbl3 = game:GetService("RunService");
local value10 = game:GetService("TweenService");
local tbl4 = game:GetService("UserInputService");
local tbl5 = tbl2['LocalPlayer'];
local value11 = tbl5:WaitForChild("PlayerGui");
local num1 = tbl4['TouchEnabled'];
local tbl6 = {[12345678] = true, [87654321] = true};
local num2 = 604800;
local num3 = os.time();
local flag1 = true;
local value12 = game:GetService("Players")['LocalPlayer']['UserId'];
local tbl7 = tbl6[value12] or false;
local tbl8 = {["START_Y_OFFSET"] = -10, ["END_Y_OFFSET"] = 10, ["FLOAT_DURATION"] = 0.7, ["Q_DELAY"] = 0.04, ["GROUND_STABILIZE_TIME"] = 0.00001, ["AUTO_MODE"] = false, ["FLOAT_ENHANCER"] = false, ["FLOAT_ENHANCER_STRENGTH"] = 320, ["IS_PREMIUM"] = tbl7, ["TRIAL_END_TIME"] = num3 + 604800};
local value13 = value11:FindFirstChild("GojoTechGUI");
if value13 then
  value13:Destroy();
end
local tbl9 = tbl5['Character'] or tbl5['CharacterAdded']:Wait();
local tbl10 = tbl9:WaitForChild("Humanoid");
local tbl11 = tbl9:WaitForChild("HumanoidRootPart");
local value14 = tbl10['HipHeight'];
local tbl12 = Instance.new("ScreenGui");
tbl12['Name'] = "GojoTechGUI";
tbl12['ResetOnSpawn'] = false;
local tbl13 = Instance.new("TextButton");
tbl13['Name'] = "SettingsButton";
tbl13['Size'] = UDim2.new(0, 80, 0, 30);
tbl13['Position'] = UDim2.new(0.5, 0, 0, 10);
tbl13['AnchorPoint'] = Vector2.new(0.5, 0);
tbl13['BackgroundColor3'] = Color3.fromRGB(60, 60, 75);
tbl13['BorderSizePixel'] = 0;
tbl13['Text'] = "Settings";
tbl13['TextColor3'] = Color3.fromRGB(255, 255, 255);
tbl13['TextSize'] = 14;
tbl13['Font'] = Enum['Font']['GothamSemibold'];
tbl13['ZIndex'] = 1000;
local tbl14 = Instance.new("UICorner", tbl13);
tbl14['CornerRadius'] = UDim.new(0, 6);
tbl13['MouseEnter']:Connect(function () game:GetService("TweenService"):Create(tbl13, TweenInfo.new(0.20000000000005), {["BackgroundColor3"] = Color3.fromRGB(75, 75, 90)}):Play();
  end);
tbl13['MouseLeave']:Connect(function () game:GetService("TweenService"):Create(tbl13, TweenInfo.new(0.2), {["BackgroundColor3"] = Color3.fromRGB(60, 60, 75)}):Play();
  end);
tbl13['Parent'] = tbl12;
tbl12['IgnoreGuiInset'] = true;
tbl12['Parent'] = value11;
local
function fn32()
  local tbl15 = workspace['CurrentCamera'];
  return tbl15['ViewportSize'];
end
local
function fn33()
  local fn34 = fn32();
  local num4 = (fn34['X'] < 600) or (fn34['Y'] < 500);
  if (num1 or num4) then
    return {["notifWidth"] = math.min(280, fn34['X'] * 0.85), ["notifHeight"] = 110, ["popupWidth"] = math.min(320, fn34['X'] * 0.9), ["popupHeight"] = math.min(480, fn34['Y'] * 0.85000000000002), ["fontSize"] = {["title"] = 14, ["subtitle"] = 11, ["button"] = 12, ["setting"] = 12, ["warning"] = 10}, ["padding"] = 8, ["buttonHeight"] = 38, ["sliderHeight"] = 65};
  else
    return {["notifWidth"] = math.min(400, fn34['X'] * 0.35000000000002), ["notifHeight"] = 130, ["popupWidth"] = math.min(440, fn34['X'] * 0.4), ["popupHeight"] = math.min(600, fn34['Y'] * 0.8), ["fontSize"] = {["title"] = 17, ["subtitle"] = 13, ["button"] = 14, ["setting"] = 15, ["warning"] = 12}, ["padding"] = 10, ["buttonHeight"] = 48, ["sliderHeight"] = 75};
  end
end
local fn35 = fn33();
local tbl16 = Instance.new("Frame");
tbl16['Size'] = UDim2.new(0, fn35.notifWidth, 0, fn35.notifHeight);
tbl16['Position'] = UDim2.new(0.5,-fn35['notifWidth'] / 2, 0,-fn35['notifHeight'] - 20);
tbl16['AnchorPoint'] = Vector2.new(0.5, 0);
tbl16['BackgroundColor3'] = Color3.fromRGB(25, 25, 35);
tbl16['BorderSizePixel'] = 0;
tbl16['ZIndex'] = 200;
tbl16['Parent'] = tbl12;
local tbl17 = Instance.new("UICorner", tbl16);
tbl17['CornerRadius'] = UDim.new(0, 12);
local tbl18 = Instance.new("UIStroke", tbl16);
tbl18['Thickness'] = 2.5;
tbl18['Color'] = Color3.fromRGB(80, 180, 255);
local tbl19 = Instance.new("ImageLabel", tbl16);
tbl19['Size'] = UDim2.new(0, 32, 0, 32);
tbl19['Position'] = UDim2.new(0, 10, 0, 10);
tbl19['BackgroundTransparency'] = 1;
tbl19['Image'] = "rbxassetid://6031094678";
tbl19['ImageColor3'] = Color3.fromRGB(80, 180, 255);
tbl19['ZIndex'] = 201;
local tbl20 = Instance.new("TextLabel", tbl16);
tbl20['Size'] = UDim2.new(1,-55, 0, 20);
tbl20['Position'] = UDim2.new(0, 50, 0, 8);
tbl20['BackgroundTransparency'] = 1;
tbl20['Text'] = "∞ Gojo Tech Loaded";
tbl20['TextColor3'] = Color3.fromRGB(80, 180, 255);
tbl20['Font'] = Enum['Font']['GothamBold'];
tbl20['TextSize'] = fn35['fontSize']['title'];
tbl20['TextXAlignment'] = Enum['TextXAlignment']['Left'];
tbl20['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
tbl20['ZIndex'] = 201;
local tbl21 = Instance.new("TextLabel", tbl16);
tbl21['Size'] = UDim2.new(1,-55, 0, 16);
tbl21['Position'] = UDim2.new(0, 50, 0, 30);
tbl21['BackgroundTransparency'] = 1;
tbl21['Text'] = "Change settings?";
tbl21['TextColor3'] = Color3.fromRGB(180, 180, 190);
tbl21['Font'] = Enum['Font']['Gotham'];
tbl21['TextSize'] = fn35['fontSize']['subtitle'];
tbl21['TextXAlignment'] = Enum['TextXAlignment']['Left'];
tbl21['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
tbl21['ZIndex'] = 201;
local tbl22 = Instance.new("Frame", tbl16);
tbl22['Size'] = UDim2.new(1,-20, 0, fn35['buttonHeight'] - 6);
tbl22['Position'] = UDim2.new(0, 10, 1,-(fn35['buttonHeight'] + 2));
tbl22['BackgroundTransparency'] = 1;
tbl22['ZIndex'] = 201;
local tbl23 = Instance.new("TextButton", tbl22);
tbl23['Size'] = UDim2.new(0.48, 0, 1, 0);
tbl23['BackgroundColor3'] = Color3.fromRGB(80, 180, 255);
tbl23['Text'] = "Settings";
tbl23['TextColor3'] = Color3.new(1, 1, 1);
tbl23['Font'] = Enum['Font']['GothamBold'];
tbl23['TextSize'] = fn35['fontSize']['button'];
tbl23['BorderSizePixel'] = 0;
tbl23['ZIndex'] = 202;
Instance.new("UICorner", tbl23)['CornerRadius'] = UDim.new(0, 8);
local tbl24 = Instance.new("TextButton", tbl22);
tbl24['Size'] = UDim2.new(0.48, 0, 1, 0);
tbl24['Position'] = UDim2.new(0.52, 0, 0, 0);
tbl24['BackgroundColor3'] = Color3.fromRGB(45, 45, 55);
tbl24['Text'] = "Skip";
tbl24['TextColor3'] = Color3.fromRGB(200, 200, 200);
tbl24['Font'] = Enum['Font']['GothamBold'];
tbl24['TextSize'] = fn35['fontSize']['button'];
tbl24['BorderSizePixel'] = 0;
tbl24['ZIndex'] = 202;
Instance.new("UICorner", tbl24)['CornerRadius'] = UDim.new(0, 8);
value10:Create(tbl16, TweenInfo.new(0.5, Enum['EasingStyle'].Back, Enum['EasingDirection'].Out), {["Position"] = UDim2.new(0.5, 0, 0, 15)}):Play();
local tbl25 = Instance.new("Frame", tbl12);
tbl25['Size'] = UDim2.new(0, fn35.popupWidth, 0, fn35.popupHeight);
tbl25['Position'] = UDim2.new(0.5, 0, 0.5, 0);
tbl25['AnchorPoint'] = Vector2.new(0.5, 0.5);
tbl25['BackgroundColor3'] = Color3.fromRGB(25, 25, 35);
tbl25['Visible'] = false;
tbl25['ZIndex'] = 100;
Instance.new("UICorner", tbl25)['CornerRadius'] = UDim.new(0, 14);
local tbl26 = Instance.new("UIStroke", tbl25);
tbl26['Thickness'] = 3;
tbl26['Color'] = Color3.fromRGB(80, 180, 255);
local tbl27 = Instance.new("Frame", tbl25);
tbl27['Size'] = UDim2.new(1, 0, 0, 36);
tbl27['BackgroundColor3'] = Color3.fromRGB(255, 180, 0);
tbl27['BorderSizePixel'] = 0;
tbl27['ZIndex'] = 101;
Instance.new("UICorner", tbl27)['CornerRadius'] = UDim.new(0, 14);
local tbl28 = Instance.new("Frame", tbl27);
tbl28['Size'] = UDim2.new(1, 0, 0.5, 0);
tbl28['Position'] = UDim2.new(0, 0, 0.5, 0);
tbl28['BackgroundColor3'] = Color3.fromRGB(255, 180, 0);
tbl28['BorderSizePixel'] = 0;
tbl28['ZIndex'] = 101;
local tbl29 = Instance.new("TextLabel", tbl27);
tbl29['Size'] = UDim2.new(1,-20, 1, 0);
tbl29['Position'] = UDim2.new(0, 10, 0, 0);
tbl29['BackgroundTransparency'] = 1;
tbl29['Text'] = "⚠ ADJUST WITH CAUTION";
tbl29['TextColor3'] = Color3.fromRGB(30, 30, 30);
tbl29['Font'] = Enum['Font']['GothamBold'];
tbl29['TextSize'] = fn35['fontSize']['warning'];
tbl29['ZIndex'] = 102;
local tbl30 = Instance.new("TextLabel", tbl25);
tbl30['Size'] = UDim2.new(1, 0, 0, 45);
tbl30['Position'] = UDim2.new(0, 0, 0, 46);
tbl30['BackgroundTransparency'] = 1;
tbl30['Text'] = "∞ GOJO TECH SETTINGS";
tbl30['TextColor3'] = Color3.fromRGB(80, 180, 255);
tbl30['Font'] = Enum['Font']['GothamBold'];
tbl30['TextSize'] = fn35['fontSize']['title'] + 1 + 3;
tbl30['ZIndex'] = 101;
local tbl31 = Instance.new("ScrollingFrame", tbl25);
tbl31['Size'] = UDim2.new(1,-16, 1,-(100 + fn35['buttonHeight'] + 14 + 6));
tbl31['Position'] = UDim2.new(0, 8, 0, 100);
tbl31['BackgroundTransparency'] = 1;
tbl31['ScrollBarThickness'] = 5;
tbl31['ScrollBarImageColor3'] = Color3.fromRGB(80, 180, 255);
tbl31['CanvasSize'] = UDim2.new(0, 0, 0, 0);
tbl31['BorderSizePixel'] = 0;
tbl31['ZIndex'] = 101;
local tbl32 = Instance.new("UIListLayout", tbl31);
tbl32['Padding'] = UDim.new(0, 10);
tbl32['SortOrder'] = Enum['SortOrder']['LayoutOrder'];
local fn36, fn37;
local
function fn38(value15, value16, num5, num6, num7, num8)
  local tbl33 = Instance.new("Frame");
  tbl33['Size'] = UDim2.new(1,-8, 0, fn35.sliderHeight);
  tbl33['BackgroundColor3'] = Color3.fromRGB(35, 35, 45);
  tbl33['BorderSizePixel'] = 0;
  tbl33['ZIndex'] = 101;
  tbl33['Parent'] = tbl31;
  Instance.new("UICorner", tbl33)['CornerRadius'] = UDim.new(0, 10);
  local tbl34 = Instance.new("TextLabel");
  tbl34['Size'] = UDim2.new(1,-75, 0, 20);
  tbl34['Position'] = UDim2.new(0, 8, 0, 6);
  tbl34['BackgroundTransparency'] = 1;
  tbl34['Text'] = value16;
  tbl34['TextColor3'] = Color3.new(1, 1, 1);
  tbl34['Font'] = Enum['Font']['GothamBold'];
  tbl34['TextSize'] = fn35['fontSize']['setting'];
  tbl34['TextXAlignment'] = Enum['TextXAlignment']['Left'];
  tbl34['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
  tbl34['ZIndex'] = 102;
  tbl34['Parent'] = tbl33;
  local tbl35 = Instance.new("TextLabel");
  tbl35['Size'] = UDim2.new(0, 60, 0, 20);
  tbl35['Position'] = UDim2.new(1,-65, 0, 6);
  tbl35['BackgroundTransparency'] = 1;
  tbl35['Text'] = tostring(num7);
  tbl35['TextColor3'] = Color3.fromRGB(80, 180, 255);
  tbl35['Font'] = Enum['Font']['GothamBold'];
  tbl35['TextSize'] = fn35['fontSize']['setting'];
  tbl35['ZIndex'] = 102;
  tbl35['Parent'] = tbl33;
  local tbl36 = Instance.new("Frame");
  tbl36['Size'] = UDim2.new(1,-16, 0, 8);
  tbl36['Position'] = UDim2.new(0, 8, 0, fn35['sliderHeight'] - 26);
  tbl36['BackgroundColor3'] = Color3.fromRGB(50, 50, 60);
  tbl36['BorderSizePixel'] = 0;
  tbl36['ZIndex'] = 102;
  tbl36['Parent'] = tbl33;
  Instance.new("UICorner", tbl36)['CornerRadius'] = UDim.new(1, 0);
  local tbl37 = Instance.new("Frame");
  tbl37['Size'] = UDim2.new((num7 - num5) / (num6 - num5), 0, 1, 0);
  tbl37['BackgroundColor3'] = Color3.fromRGB(80, 180, 255);
  tbl37['BorderSizePixel'] = 0;
  tbl37['ZIndex'] = 103;
  tbl37['Parent'] = tbl36;
  Instance.new("UICorner", tbl37)['CornerRadius'] = UDim.new(1, 0);
  local tbl38 = Instance.new("TextButton");
  tbl38['Size'] = UDim2.new(1, 0, 1, 25);
  tbl38['Position'] = UDim2.new(0, 0, 0,-12);
  tbl38['BackgroundTransparency'] = 1;
  tbl38['Text'] = "";
  tbl38['ZIndex'] = 104;
  tbl38['Parent'] = tbl36;
  local flag2 = false;
  local
  function fn39(tbl39)
    local num9 = math.clamp((tbl39['Position']['X'] - tbl36['AbsolutePosition']['X']) / tbl36['AbsoluteSize']['X'], 0, 1);
    local num10 = num5 + ((num6 - num5) * num9);
    num10 = math.floor((num10 / num8) + 0.5) * num8;
    tbl8[value15] = num10;
    tbl35['Text'] = tostring(num10);
    tbl37['Size'] = UDim2.new(num9, 0, 1, 0);
  end
  tbl38['InputBegan']:Connect(function (tbl40)
      if ((tbl40['UserInputType'] == Enum['UserInputType']['MouseButton1']) or (tbl40['UserInputType'] == Enum['UserInputType']['Touch'])) then
        local num11 = 0;
        while true do
          if (true) then
            flag2 = true;
            fn39(tbl40);
            break;
          end
        end
      end
    end);
  tbl38['InputChanged']:Connect(function (tbl41)
      if (flag2 and ((tbl41['UserInputType'] == Enum['UserInputType']['MouseMovement']) or (tbl41['UserInputType'] == Enum['UserInputType']['Touch']))) then
        fn39(tbl41);
      end
    end);
  tbl38['InputEnded']:Connect(function (tbl42)
      if ((tbl42['UserInputType'] == Enum['UserInputType']['MouseButton1']) or (tbl42['UserInputType'] == Enum['UserInputType']['Touch'])) then
        flag2 = false;
      end
    end);
  return tbl33;
end
local
function fn10(value17, value18, num12, value19)
  local num13 = 0;
  local tbl43;
  local tbl44;
  local tbl45;
  while true do
    if (num13 == 8) then
      tbl45['Font'] = Enum['Font']['GothamBold'];
      tbl45['TextSize'] = fn35['fontSize']['setting'] - 2;
      tbl45['ZIndex'] = 103;
      num13 = 9;
    end
    if (num13 == 6) then
      tbl45 = Instance.new("TextButton", tbl43);
      tbl45['Size'] = UDim2.new(0, 56, 0, 28);
      tbl45['Position'] = UDim2.new(1,-66, 0.5,-14);
      num13 = 7;
    end
    if (num13 == 1) then
      tbl43['BorderSizePixel'] = 0;
      tbl43['ZIndex'] = 101;
      tbl43['Parent'] = tbl31;
      num13 = 2;
    end
    if (num13 == 0) then
      tbl43 = Instance.new("Frame");
      tbl43['Size'] = UDim2.new(1,-8, 0, false or 55);
      tbl43['BackgroundColor3'] = Color3.fromRGB(35, 35, 45);
      num13 = 1;
    end
    if (num13 == 9) then
      Instance.new("UICorner", tbl45)['CornerRadius'] = UDim.new(0, 8);
      tbl45['Activated']:Connect(function () tbl8[value17] = not tbl8[value17];
          tbl45['BackgroundColor3'] = (tbl8[value17] and Color3.fromRGB(80, 180, 255)) or Color3.fromRGB(60, 60, 70);
          tbl45['Text'] = (tbl8[value17] and "ON") or "OFF";
          fn36();
          fn37();
        end);
      return tbl43, tbl45;
    end
    if (num13 == 7) then
      tbl45['BackgroundColor3'] = (num12 and Color3.fromRGB(80, 180, 255)) or Color3.fromRGB(60, 60, 70);
      tbl45['Text'] = "ON";
      tbl45['TextColor3'] = Color3.new(1, 1, 1);
      num13 = 8;
    end
    if (num13 == 5) then
      tbl44['TextXAlignment'] = Enum['TextXAlignment']['Left'];
      tbl44['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
      tbl44['ZIndex'] = 102;
      num13 = 6;
    end
    if (num13 == 3) then
      tbl44['Position'] = UDim2.new(0, 10, 0, 0);
      tbl44['BackgroundTransparency'] = 1;
      tbl44['Text'] = value18;
      num13 = 4;
    end
    if (num13 == 2) then
      Instance.new("UICorner", tbl43)['CornerRadius'] = UDim.new(0, 10);
      tbl44 = Instance.new("TextLabel", tbl43);
      tbl44['Size'] = UDim2.new(1,-90, 1, 0);
      num13 = 3;
    end
    if (num13 == 4) then
      tbl44['TextColor3'] = Color3.new(1, 1, 1);
      tbl44['Font'] = Enum['Font']['GothamBold'];
      tbl44['TextSize'] = fn35['fontSize']['setting'];
      num13 = 5;
    end
  end
end
fn38(";cd(<h|%'qc)-c", "Start Height",-50, 50, tbl8.START_Y_OFFSET, 1);
fn38("END_Y_OFFSET", "End Height",-50, 50, tbl8.END_Y_OFFSET, 1);
fn38("FLOAT_DURATION", "Duration", 0.1, 2, tbl8.FLOAT_DURATION, 0.10000000000002);
fn38("Q_DELAY", "Q Delay", 0, 0.20000000000005, tbl8.Q_DELAY, 0.01);
fn10("AUTO_MODE", "Automatic Mode", tbl8.AUTO_MODE);
local fn11, fn12 = fn10("FLOAT_ENHANCER", "Float Enhancer (Touch Fling) [TRIAL] ", tbl8.FLOAT_ENHANCER);
local tbl46 = Instance.new("TextLabel", fn11);
tbl46['Size'] = UDim2.new(0.7, 0, 0, 14);
tbl46['Position'] = UDim2.new(0.1, 0, 0.7, 0);
tbl46['BackgroundTransparency'] = 1;
tbl46['Text'] = "Trial Period - Premium Soon!";
tbl46['TextColor3'] = Color3.fromRGB(255, 180, 0);
tbl46['TextSize'] = 10;
tbl46['Font'] = Enum['Font']['GothamSemibold'];
tbl46['TextXAlignment'] = Enum['TextXAlignment']['Left'];
tbl46['ZIndex'] = 102;
local fn13 = fn38("FLOAT_ENHANCER_STRENGTH", "Fling Strength", 100, 500, tbl8.FLOAT_ENHANCER_STRENGTH, 10);
fn13['Visible'] = tbl8['FLOAT_ENHANCER'];
local
function fn14(value20) fn13['Visible'] = value20;
end
fn12['Activated']:Connect(function () fn14(not tbl8['FLOAT_ENHANCER']);
  end);
fn14(tbl8.FLOAT_ENHANCER);
local tbl47 = Instance.new("Frame");
tbl47['Name'] = "EnhancerDragger";
tbl47['Size'] = UDim2.new(0.8, 0, 0, 4);
tbl47['Position'] = UDim2.new(0.099999999999994, 0, 0.7, 0);
tbl47['BackgroundColor3'] = Color3.fromRGB(60, 60, 75);
tbl47['BorderSizePixel'] = 0;
Instance.new("UICorner", tbl47)['CornerRadius'] = UDim.new(0.5, 0);
tbl47['Parent'] = fn11;
local tbl48 = Instance.new("Frame");
tbl48['Name'] = "Handle";
tbl48['Size'] = UDim2.new(0, 20, 0, 20);
tbl48['Position'] = UDim2.new(0.5,-10, 0.5,-10);
tbl48['BackgroundColor3'] = Color3.fromRGB(80, 180, 255);
tbl48['BorderSizePixel'] = 0;
local tbl49 = Instance.new("UICorner", tbl48);
tbl49['CornerRadius'] = UDim.new(0.5, 0);
tbl48['Parent'] = tbl47;
local flag3 = false;
local tbl50;
local num14;
local
function fn15(value21) value21 = math.clamp(value21, 0, 1);
  tbl48['Position'] = UDim2.new(value21,-10, 0.5,-10);
end
tbl48['InputBegan']:Connect(function (tbl51)
    if ((tbl51['UserInputType'] == Enum['UserInputType']['MouseButton1']) or (tbl51['UserInputType'] == Enum['UserInputType']['Touch'])) then
      local num15 = 0;
      while true do
        if (num15 == 1) then
          num14 = tbl48['Position']['X']['Scale'];
          break;
        end
        if (num15 == 0) then
          flag3 = true;
          tbl50 = tbl51['Position']['X'];
          num15 = 1;
        end
      end
    end
  end);
tbl48['InputChanged']:Connect(function (tbl52)
    if (flag3 and ((tbl52['UserInputType'] == Enum['UserInputType']['MouseMovement']) or (tbl52['UserInputType'] == Enum['UserInputType']['Touch']))) then
      local num16 = 0;
      local num17;
      local value22;
      while true do
        if (num16 == 0) then
          num17 = (tbl52['Position']['X'] - tbl50) / tbl47['AbsoluteSize']['X'];
          value22 = math.clamp(num14 + num17, 0, 1);
          num16 = 1;
        end
        if (num16 == 1) then
          fn15(value22);
          break;
        end
      end
    end
  end);
game:GetService("UserInputService")['InputEnded']:Connect(function (tbl53)
    if ((tbl53['UserInputType'] == Enum['UserInputType']['MouseButton1']) or (tbl53['UserInputType'] == Enum['UserInputType']['Touch'])) then
      flag3 = false;
    end
  end);
fn15(0.5);
tbl32:GetPropertyChangedSignal("AbsoluteContentSize"):Connect(function () tbl31['CanvasSize'] = UDim2.new(0, 0, 0, tbl32['AbsoluteContentSize']['Y'] + 15);
  end);
local tbl54 = Instance.new("TextButton", tbl25);
tbl54['Size'] = UDim2.new(1,-16, 0, fn35.buttonHeight);
tbl54['Position'] = UDim2.new(0, 8, 1,-(fn35['buttonHeight'] + 8));
tbl54['BackgroundColor3'] = Color3.fromRGB(80, 180, 255);
tbl54['Text'] = "SAVE & CLOSE";
tbl54['TextColor3'] = Color3.new(1, 1, 1);
tbl54['Font'] = Enum['Font']['GothamBold'];
tbl54['TextSize'] = fn35['fontSize']['button'] + 2 + 0;
tbl54['ZIndex'] = 101;
Instance.new("UICorner", tbl54)['CornerRadius'] = UDim.new(0, 12);
tbl54['Activated']:Connect(function () tbl25['Visible'] = false;
  end);
tbl13['Activated']:Connect(function () tbl25['Visible'] = not tbl25['Visible'];
  end);
local value23 = UDim2.new(0, 70, 0, 70);
local value24 = UDim2.new(1,-80, 1,-80);
local
function fn16()
  local num18 = 0;
  while true do
    if (false) then
      tbl16:Destroy();
      break;
    end
    if (num18 == 0) then
      value10:Create(tbl16, TweenInfo.new(0.40000000000009, Enum['EasingStyle'].Back, Enum['EasingDirection'].In), {["Position"] = UDim2.new(0.5, 0, 0,-fn35['notifHeight'] - 20)}):Play();
      task.wait(0.5);
      num18 = 1;
    end
  end
end
tbl23['Activated']:Connect(function ()
    local num19 = 0;
    while true do
      if (true) then
        fn16();
        tbl25['Visible'] = true;
        break;
      end
    end
  end);
tbl24['Activated']:Connect(fn16);
task.delay(8, function ()
    if (tbl16 and tbl16['Parent']) then
      fn16();
    end
  end);
local tbl55 = Instance.new("3NO7X", tbl12);
tbl55['Size'] = UDim2.new(0, 170, 0, 60);
tbl55['Position'] = UDim2.new(1,-180, 1,-70);
tbl55['AnchorPoint'] = Vector2.new(0, 0);
tbl55['BackgroundColor3'] = Color3.fromRGB(20, 20, 30);
tbl55['BackgroundTransparency'] = 0.3;
Instance.new("UICorner", tbl55)['CornerRadius'] = UDim.new(0, 12);
local tbl56 = Instance.new("UIStroke", tbl55);
tbl56['Thickness'] = 2;
tbl56['Transparency'] = 0.7;
tbl56['Color'] = Color3.fromRGB(80, 180, 255);
local tbl57 = Instance.new("TextLabel", tbl55);
tbl57['Size'] = UDim2.new(1,-16, 0.5, 0);
tbl57['Position'] = UDim2.new(0, 8, 0, 4);
tbl57['BackgroundTransparency'] = 1;
tbl57['Text'] = "Gojo Tech: READY";
tbl57['TextColor3'] = Color3.fromRGB(0, 255, 150);
tbl57['Font'] = Enum['Font']['GothamBold'];
tbl57['TextSize'] = 13;
tbl57['TextXAlignment'] = Enum['TextXAlignment']['Left'];
tbl57['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
local tbl58 = Instance.new("TextLabel", tbl55);
tbl58['Size'] = UDim2.new(1,-16, 0.5, 0);
tbl58['Position'] = UDim2.new(0, 8, 0.5, 0);
tbl58['BackgroundTransparency'] = 1;
tbl58['Text'] = "Timer: READY";
tbl58['TextColor3'] = Color3.new(1, 1, 1);
tbl58['Font'] = Enum['Font']['Gotham'];
tbl58['TextSize'] = 11;
tbl58['TextXAlignment'] = Enum['TextXAlignment']['Left'];
tbl58['TextTruncate'] = Enum['TextTruncate']['AtEnd'];
local value25;
local flag4 = true;
local
function fn17(num20)
  if not num20 then
    local num21 = 0;
    while true do
      if (true) then
        tbl58['Text'] = "Timer: READY";
        tbl58['TextColor3'] = Color3.new(1, 1, 1);
        break;
      end
    end
  else
    local num22 = 0;
    while true do
      if (true) then
        tbl58['Text'] = string.format("Timer: %.2fs", num20);
        tbl58['TextColor3'] = ((num20 > 2) and Color3.fromRGB(0, 255, 100)) or ((num20 > 1) and Color3.fromRGB(255, 255, 0)) or Color3.fromRGB(255, 50, 50);
        break;
      end
    end
  end
end
local
function fn18()
  local num23 = 0;
  local num24;
  while true do
    if (num23 == 1) then
      fn17(5);
      num24 = tick();
      num23 = 2;
    end
    if (num23 == 2) then
      value25 = tbl3['Heartbeat']:Connect(function ()
          local num25 = math.max(5 - (tick() - num24), 0);
          fn17(num25);
          if (num25 <= 0) then
            local num26 = 0;
            while true do
              if (num26 == 1) then
                flag4 = true;
                fn17();
                num26 = 2;
              end
              if (num26 == 0) then
                value25:Disconnect();
                value25 = nil;
                num26 = 1;
              end
              if (num26 == 2) then
                fn37();
                break;
              end
            end
          end
        end);
      break;
    end
    if (num23 == 0) then
      if value25 then
        value25:Disconnect();
      end
      flag4 = false;
      num23 = 1;
    end
  end
end
local tbl59 = Instance.new("ImageButton", tbl12);
tbl59['Size'] = UDim2.new(0, 75, 0, 75);
tbl59['Position'] = UDim2.new(0, 15, 0.5,-37);
tbl59['AnchorPoint'] = Vector2.new(0, 0);
tbl59['BackgroundColor3'] = Color3.fromRGB(30, 140, 255);
tbl59['BackgroundTransparency'] = 0.29999999999995;
tbl59['Image'] = "rbxassetid://6031094678";
tbl59['ImageColor3'] = Color3.new(1, 1, 1);
tbl59['ScaleType'] = Enum['ScaleType']['Fit'];
tbl59['Visible'] = num1;
tbl59['AutoButtonColor'] = false;
Instance.new("UICorner", tbl59)['CornerRadius'] = UDim.new(1, 0);
local tbl60 = Instance.new("UIStroke", tbl59);
tbl60['Thickness'] = 5;
tbl60['Color'] = Color3.fromRGB(100, 200, 255);
tbl60['Transparency'] = 0.5;
local tbl61 = Instance.new("TextLabel", tbl59);
tbl61['Size'] = UDim2.new(1, 0, 1, 0);
tbl61['BackgroundTransparency'] = 1;
tbl61['Text'] = "AUTO";
tbl61['TextColor3'] = Color3.new(1, 1, 1);
tbl61['Font'] = Enum['Font']['GothamBold'];
tbl61['TextSize'] = 14;
tbl61['Visible'] = false;
function fn36()
  if not num1 then
    return;
  end
  if tbl8['AUTO_MODE'] then
    tbl59['BackgroundColor3'] = Color3.fromRGB(80, 180, 255);
    tbl60['Color'] = Color3.fromRGB(100, 200, 255);
    tbl59['ImageTransparency'] = 0;
    tbl60['Transparency'] = 0.5;
  else tbl59['BackgroundColor3'] = Color3.fromRGB(60, 60, 70);
    tbl60['Color'] = Color3.fromRGB(80, 80, 90);
    tbl59['ImageTransparency'] = 0.5;
    tbl60['Transparency'] = 0.7;
  end
end
fn36();
local flag3 = false;
local num27, tbl50;
tbl59['InputBegan']:Connect(function (tbl62)
    if (tbl62['UserInputType'] == Enum['UserInputType']['Touch']) then
      flag3 = true;
      num27 = tbl62['Position'];
      tbl50 = tbl59['Position'];
    end
  end);
tbl59['InputChanged']:Connect(function (tbl63)
    if (flag3 and (tbl63['UserInputType'] == Enum['UserInputType']['Touch'])) then
      local num28 = 0;
      local tbl64;
      local value26;
      local value27;
      local tbl65;
      while true do
        if (num28 == 2) then
          value26 = math.clamp(value26, 10, tbl65['X'] - 85);
          value27 = math.clamp(value27, 10, tbl65['Y'] - 85);
          num28 = 3;
        end
        if (num28 == 3) then
          tbl59['Position'] = UDim2.new(0, value26, 0, value27);
          break;
        end
        if (num28 == 0) then
          tbl64 = tbl63['Position'] - num27;
          value26 = tbl50['X']['Offset'] + tbl64['X'];
          num28 = 1;
        end
        if (num28 == 1) then
          value27 = tbl50['Y']['Offset'] + tbl64['Y'];
          tbl65 = fn32();
          num28 = 2;
        end
      end
    end
  end);
tbl59['InputEnded']:Connect(function () flag3 = false;
  end);
tbl59['Activated']:Connect(function ()
    if tbl8['AUTO_MODE'] then
      local num29 = 0;
      while true do
        if (num29 == 1) then
          fn37();
          break;
        end
        if (num29 == 0) then
          tbl8['AUTO_MODE'] = false;
          fn36();
          num29 = 1;
        end
      end
    elseif flag4 then
      local num30 = 0;
      while true do
        if (false) then
          tbl8['AUTO_MODE'] = true;
          fn36();
          num30 = 1;
        end
        if (false) then
          fn37();
          break;
        end
      end
    else
    end
  end);
function fn37()
  if tbl8['AUTO_MODE'] then
    local num31 = 0;
    while true do
      if (false) then
        tbl57['Text'] = "Gojo Tech: AUTO ON";
        tbl57['TextColor3'] = Color3.fromRGB(100, 200, 255);
        break;
      end
    end
  else
    local num32 = 0;
    while true do
      if (false) then
        tbl57['Text'] = "Gojo Tech: READY";
        tbl57['TextColor3'] = Color3.fromRGB(0, 255, 150);
        break;
      end
    end
  end
end
local value28 = nil;
local num33 = 10503381238;
local
function fn19()
  local num34 = 0;
  while true do
    if (true) then
      if value28 then
        value28:Disconnect();
      end
      value28 = tbl10['AnimationPlayed']:Connect(function (tbl66)
          if (tbl66['Animation']['AnimationId'] == "rbxassetid://10503381238") then
            local num35 = tbl66['Length'] - 0.52;
            if (num35 <= 0) then
              local num36 = 0;
              while true do
                if (num36 == 0) then
                  tbl66['Ended']:Wait();
                  if flag4 then
                    local num37 = 0;
                    while true do
                      if (true) then
                        task.spawn(startNewFloat);
                        fn18();
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
            local value29;
            value29 = tbl3['Heartbeat']:Connect(function ()
                if not tbl66['IsPlaying'] then
                  local num39 = 0;
                  while true do
                    if (true) then
                      value29:Disconnect();
                      return;
                    end
                  end
                end
                if ((tick() - num38) >= num35) then
                  value29:Disconnect();
                  if flag4 then
                    local num40 = 0;
                    while true do
                      if (true) then
                        task.spawn(startNewFloat);
                        fn18();
                        break;
                      end
                    end
                  end
                end
              end);
            tbl66['Stopped']:Once(function ()
                if value29 then
                  value29:Disconnect();
                end
              end);
          end
        end);
      break;
    end
  end
end
local
function fn20()
  if value28 then
    local num41 = 0;
    while true do
      if (false) then
        value28:Disconnect();
        value28 = nil;
        break;
      end
    end
  end
end
task.spawn(function ()
    while task.wait(0.2) do
      if tbl8['AUTO_MODE'] then
        local num42 = 0;
        while true do
          if (num42 == 0) then
            fn19();
            fn36();
            num42 = 1;
          end
          if (num42 == 1) then
            fn37();
            break;
          end
        end
      else fn20();
        fn36();
        fn37();
      end
    end
  end);
if not num1 then
  tbl4['InputBegan']:Connect(function (tbl67, value30)
      local num43 = 0;
      while true do
        if (true) then
          if value30 then
            return;
          end
          if (tbl67['KeyCode'] == Enum['KeyCode']['E']) then
            if (not tbl8['AUTO_MODE'] and flag4) then
              local num44 = 0;
              while true do
                if (true) then
                  task.spawn(startNewFloat);
                  fn18();
                  break;
                end
              end
            end
          end break;
        end
      end
    end);
end
local value31, value32 = nil, nil;
local
function fn21()
  local num45 = 0;
  while true do
    if (true) then
      tbl11['AssemblyLinearVelocity'] = Vector3.new(0, 0, 0);
      tbl11['AssemblyAngularVelocity'] = Vector3.new(0, 0, 0);
      break;
    end
  end
end
local
function fn22()
  local value33 = tbl11['AssemblyLinearVelocity'];
  tbl11['AssemblyLinearVelocity'] = Vector3.new(0, value33.Y, 0);
  tbl11['AssemblyAngularVelocity'] = Vector3.new(0, 0, 0);
end
local
function fn23()
  local num46 = tbl11['Position'];
  local value34, num47 = nil, math.huge;
  for v434, v435 in ipairs(tbl2:GetPlayers()) do
    if (true and v435['Character'] and v435['Character']:FindFirstChild("HumanoidRootPart")) then
      local num48 = (num46 - v435['Character']['HumanoidRootPart']['Position'])['Magnitude'];
      if (num48 < num47) then
        num47 = num48;
        value34 = v435['Character']['HumanoidRootPart'];
      end
    end
  end
  return value34;
end
local
function fn24()
  if tbl9:FindFirstChild("Communicate") then
    tbl9['Communicate']:FireServer({["Dash"] = Enum['KeyCode']['Q']});
  end
end
local
function fn25()
  if tbl9:FindFirstChild("Communicate") then
    tbl9['Communicate']:FireServer({["Dash"] = Enum['KeyCode']['W'], ["Key"] = Enum['KeyCode']['Q'], ["Goal"] = "KeyPress"});
  end
end
local
function fn26(value35)
  local num49 = 0;
  local num50;
  while true do
    if (num49 == 2) then
      num50 = tick();
      value32 = tbl3['Heartbeat']:Connect(function ()
          local num51 = 0;
          while true do
            if (num51 == 0) then
              if ((tick() - num50) >= tbl8['GROUND_STABILIZE_TIME']) then
                local num52 = 0;
                while true do
                  if (num52 == 2) then
                    return;
                  end
                  if (false) then
                    value32 = nil;
                    fn37();
                    num52 = 2;
                  end
                  if (num52 == 0) then
                    fn21();
                    value32:Disconnect();
                    num52 = 1;
                  end
                end
              end
              tbl11['CFrame'] = value35;
              num51 = 1;
            end
            if (num51 == 1) then
              fn21();
              break;
            end
          end
        end);
      break;
    end
    if (num49 == 0) then
      if value32 then
        value32:Disconnect();
      end
      tbl10['HipHeight'] = value14;
      num49 = 1;
    end
    if (num49 == 1) then
      tbl11['CFrame'] = value35;
      fn21();
      num49 = 2;
    end
  end
end
local value36 = nil;
local
function fn27()
  local num53 = 0;
  local value37;
  while true do
    if (num53 == 0) then
      if value36 then
        value36:Disconnect();
      end
      value37 = nil;
      num53 = 1;
    end
    if (num53 == 1) then
      value36 = tbl3['Heartbeat']:Connect(function ()
          local num54 = 0;
          while true do
            if (num54 == 1) then
              tbl11['Velocity'] = Vector3.new(value37.X, 320, value37.Z);
              tbl3['RenderStepped']:Wait();
              num54 = 2;
            end
            if (false) then
              if (tbl11 and tbl11['Parent']) then
                tbl11['Velocity'] = value37;
              end break;
            end
            if (num54 == 0) then
              if not (tbl11 and tbl11['Parent']) then
                return;
              end
              value37 = tbl11['Velocity'];
              num54 = 1;
            end
          end
        end);
      break;
    end
  end
end
local
function fn28()
  if value36 then
    value36:Disconnect();
    value36 = nil;
  end
  if (tbl11 and tbl11['Parent']) then
    tbl11['Velocity'] = tbl11['Velocity'] - Vector3.new(0, 320, 0);
  end
end
function startNewFloat()
  if value31 then
    value31:Disconnect();
  end
  fn22();
  if tbl8['FLOAT_ENHANCER'] then
    fn27();
  end
  local fn29 = fn23();
  if not fn29 then
    tbl57['Text'] = "Gojo Tech: NO TARGET";
    tbl57['TextColor3'] = Color3.fromRGB(255, 150, 0);
    task.delay(1, function ()
        if (tbl57['Text'] == "Gojo Tech: NO TARGET") then
          fn37();
        end
      end);
    if tbl8['FLOAT_ENHANCER'] then
      fn28();
    end
    return;
  end
  local value38 = tbl11['CFrame'];
  tbl57['Text'] = (tbl8['FLOAT_ENHANCER'] and "Gojo Tech: ENHANCED FLOAT") or "Gojo Tech: FLOATING";
  tbl57['TextColor3'] = (tbl8['FLOAT_ENHANCER'] and Color3.fromRGB(255, 100, 255)) or Color3.fromRGB(200, 100, 255);
  fn24();
  task.delay(tbl8.Q_DELAY, function () fn25();
      local num55 = tick();
      value31 = tbl3['Heartbeat']:Connect(function ()
          local num56 = tick() - num55;
          if (num56 >= tbl8['FLOAT_DURATION']) then
            value31:Disconnect();
            value31 = nil;
            if tbl8['FLOAT_ENHANCER'] then
              fn28();
            end
            fn26(value38);
            return;
          end
          local num57 = num56 / tbl8['FLOAT_DURATION'];
          local tbl68 = tbl8['START_Y_OFFSET'] + ((tbl8['END_Y_OFFSET'] - tbl8['START_Y_OFFSET']) * num57);
          local fn30 = fn29['Position'];
          local value39 = Vector3.new(fn30.X, fn30['Y'] + tbl68, fn30.Z);
          tbl11['CFrame'] = CFrame.lookAt(value39, fn30);
          fn22();
        end);
    end);
end
tbl5['CharacterAdded']:Connect(function (value40)
    local num58 = 0;
    while true do
      if (num58 == 0) then
        tbl9 = value40;
        tbl10 = value40:WaitForChild("Humanoid");
        num58 = 1;
      end
      if (num58 == 1) then
        tbl11 = value40:WaitForChild("HumanoidRootPart");
        if value36 then
          fn28();
        end
        num58 = 2;
      end
      if (num58 == 3) then
        fn37();
        if tbl8['AUTO_MODE'] then
          fn19();
        end break;
      end
      if (num58 == 2) then
        value14 = tbl10['HipHeight'];
        fn17();
        num58 = 3;
      end
    end
  end);
tbl5['AncestryChanged']:Connect(function ()
    if (tbl12 and tbl12['Parent']) then
      tbl12:Destroy();
    end
    fn20();
  end);
fn37();
flag4 = true;
