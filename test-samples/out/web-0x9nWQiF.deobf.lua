local kavoUi = loadstring(game:HttpGet("https://pastebin.com/raw/vff1bQ9F"))()
local window = kavoUi.CreateLib("Games HUB Destroyer V2", "DarkTheme") ---Tabs
local Tab1 = window:NewTab("Games")
local Tab1Section = Tab1:NewSection("Popular Games")
local Tab2 = window:NewTab("Credits")
local Tab2Section = Tab2:NewSection("Made By Take Modzz")
local Tab2Section = Tab2:NewSection("Credits to Baki")
local Tab2Section = Tab2:NewSection("YouTube | Take Modzz")
local Tab2Section = Tab2:NewSection("Discord | TakeᴍᴏᴅᴢᴢYT#2788")
local Tab2Section = Tab2:NewSection("Discord Server | https://discord.gg/2GE7w8G5")
local Tab2 = window:NewTab("Updates")
local Tab2Section = Tab2:NewSection("V2")
local Tab3 = window:NewTab("Others")
local Tab3Section = Tab3:NewSection("Others GUI'S") ---Buttons
Tab1Section:NewButton("Adopt Me! (Key system)", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/BloxiYT/Diamond/main/AdoptMe"))()
  end) Tab1Section:NewButton("Brookhaven🏡RP", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/IceMael7/NewIceHub/main/Brookhaven"))()
  end) Tab1Section:NewButton("[🐯🍩UPDATE]Blox Friuts", "No description", function () loadstring(game:HttpGet('https://raw.githubusercontent.com/acsu123/HOHO_H/main/Loading_UI'))()
  end) Tab1Section:NewButton("Combat Warriors", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/SussyImposterRed/Scripts/main/NEW_NOVA"))()
  end) Tab1Section:NewButton("🎉Evade", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/GamingScripter/Darkrai-X/main/Games/Evade"))()
  end) Tab1Section:NewButton("Doors 👁 [🌐]", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/GamingScripter/Darkrai-X/main/Games/Doors"))()
  end) Tab1Section:NewButton("Rainbow Friends", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/JNHHGaming/Rainbow-Friends/main/Rainbow%20Friends"))()
  end) Tab1Section:NewButton("🔪¡Survive the Killer!", "No description", function ()
    local games = {["SurviveTheKiller"] = 4580204640}
    for i, v in pairs(games) do
      if game.PlaceId == v then
        print("Supported!");
        loadstring(game:HttpGet("https://raw.githubusercontent.com/MiloHaxx/ChairWare/main/Games/"..i..".lua"))()
      end
    end
    loadstring(game:HttpGet("https://raw.githubusercontent.com/MiloHaxx/ChairWare/main/dcJoin.lua"))()
  end)
local Tab1Section = Tab1:NewSection("Shooter Games") Tab1Section:NewButton("Arsenal", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/Maikderninja/Maikderninja/main/PWNERHUB.lua"))();
  end) Tab1Section:NewButton("BIG Paintball!", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/CriShoux/OwlHub/master/OwlHub.txt"))();
  end)
local Tab1Section = Tab1:NewSection("Featured games") Tab1Section:NewButton("Breaking Point", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/ColdStep2/Breaking-Point-Funny-Squid-Hax/main/Breaking%20Point%20Funny%20Squid%20Hax", true))();
  end) Tab1Section:NewButton("Breaking Point (Auto Hit)", "No description", function ()
    while wait() do
      for i, v in pairs(game.Players:GetPlayers()) do
        if v.Name ~= game.Players.LocalPlayer.Name then
          if game.Workspace:FindFirstChild(v.Name) then
            if game.Workspace[v.Name].Humanoid.Sit ~= true then
              if game.Workspace[v.Name]:FindFirstChild("Blade") then
                game:GetService("ReplicatedStorage").RemoteEvent:FireServer(37, CFrame.new(Vector3.new(0, 0, 0), Vector3.new(0, 0, 0)), Vector3.new(v.Character.HumanoidRootPart.CFrame.x, 4, v.Character.HumanoidRootPart.CFrame.z), Vector3.new(0, 0, 0)) wait(.1) game:GetService("ReplicatedStorage").RemoteEvent:FireServer(43, v.Character.HumanoidRootPart, v, "IIlIla", true)
              else
                if v.Backpack:FindFirstChild("Blade") then
                  game:GetService("ReplicatedStorage").RemoteEvent:FireServer(37, CFrame.new(Vector3.new(0, 0, 0), Vector3.new(0, 0, 0)), Vector3.new(v.Character.HumanoidRootPart.CFrame.x, 4, v.Character.HumanoidRootPart.CFrame.z), Vector3.new(0, 0, 0)) wait(.1) game:GetService("ReplicatedStorage").RemoteEvent:FireServer(43, v.Character.HumanoidRootPart, v, "IIlIla", true)
                end
              end
            end
          end
        end
      end
    end
  end) Tab1Section:NewButton("Breaking Point (H4R7N old)", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/H4R7NHacks/Obfuscated/master/Breaking%20Point%20H4R7N%20Hack.lua"))()
  end) Tab1Section:NewButton("Breaking Point (H4R7N new)", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/H4R7NHacks/Obfuscated/master/Breaking%20Point%20H4R7N%20Hack%20v1.2.lua"))()
  end) Tab1Section:NewButton("Knife Ability Test", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/CriShoux/OwlHub/master/OwlHub.txt"))();
  end) Tab1Section:NewButton("Knife Ability Test(Aimbot)", "No description", function ()
    local Camera = game:GetService("Workspace").CurrentCamera
    local Players = game:GetService("Players")
    local LocalPlayer = game:GetService("Players").LocalPlayer
    local
    function GetClosestPlayer()
      local ClosestPlayer = nil
      local FarthestDistance = math.huge
      for i, v in pairs(Players.GetPlayers(Players)) do
        if v ~= LocalPlayer and v.Character and v.Character.FindFirstChild(v.Character, "HumanoidRootPart") then
          local DistanceFromPlayer = (LocalPlayer.Character.HumanoidRootPart.Position - v.Character.HumanoidRootPart.Position).Magnitude
          if DistanceFromPlayer < FarthestDistance then
            FarthestDistance = DistanceFromPlayer ClosestPlayer = v
          end
        end
      end
      if ClosestPlayer then
        return ClosestPlayer
      end
    end
    local GameMetaTable = getrawmetatable(game)
    local OldGameMetaTableNamecall = GameMetaTable.__namecall setreadonly(GameMetaTable, false) GameMetaTable.__namecall = newcclosure(function (object,...)
        local NamecallMethod = getnamecallmethod()
        local Arguments = {...}
        if tostring(NamecallMethod) == "FindPartOnRayWithIgnoreList" then
          local ClosestPlayer = GetClosestPlayer()
          if ClosestPlayer and ClosestPlayer.Character then
            Arguments[1] = Ray.new(Camera.CFrame.Position, (ClosestPlayer.Character.Head.Position - Camera.CFrame.Position).Unit * (Camera.CFrame.Position - ClosestPlayer.Character.Head.Position).Magnitude)
          end
        end
        return OldGameMetaTableNamecall(object, unpack(Arguments))
      end) setreadonly(GameMetaTable, true)
  end) Tab1Section:NewButton("Murder Mystery 2", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/MarsQQ/ScriptHubScripts/master/MM2%20Admin%20Panel", true))()
  end) Tab1Section:NewButton("Da Hood 🎃", "No description", function () loadstring(game:HttpGet('https://raw.githubusercontent.com/lerkermer/lua-projects/master/SwagModeV002'))()
  end) Tab1Section:NewButton("💪Muscle Legends", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/harisiskandar178/Roblox-Script/main/Muscle%20Legend"))()
  end) Tab1Section:NewButton("Build A Boat For Treasure", "No description", function () loadstring(game:HttpGet('https://raw.githubusercontent.com/XRoLLu/UWU/main/BUILD%20A%20BOAT%20FOR%20TREASURE.lua'))()
  end) Tab1Section:NewButton("Tower of Hell", "No description", function () loadstring(game:HttpGet('https://raw.githubusercontent.com/VectorXinside/tower/main/towerofhell.lua'))()
  end) Tab1Section:NewButton("Natural Disaster Survival", "No description", function () loadstring(game:HttpGet('https://raw.githubusercontent.com/9NLK7/93qjoadnlaknwldk/main/main'))()
  end) Tab1Section:NewButton("Break In", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/TrixAde/Proxima-Hub/main/Main.lua"))()
  end) Tab1Section:NewButton("Zombie Attack", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/GamingScripter/Darkrai-X/main/Games/Zombie%20Attack"))()
  end) Tab1Section:NewButton("Legends Of Speed ⚡️", "No description", function () loadstring(game:HttpGet("https://pastebin.com/raw/1iMHrZ50", true))()
  end) Tab1Section:NewButton("🔧FACTORY!🔧 Car Delearship Tycoon", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/IExpIoit/Script/main/UltimateHub"))()
  end) Tab2Section:NewButton("--- Added more games", "No description", function ()
  end) Tab2Section:NewButton("--- Theme changed", "No description", function ()
  end) Tab2Section:NewButton("--- Added the Others window", "No description", function ()
  end) Tab3Section:NewButton("Keyboard GUI", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/advxzivhsjjdhxhsidifvsh/mobkeyboard/main/main.txt", true))()
  end) Tab3Section:NewButton("Fly (Mobile)", "No description", function () loadstring("loadstring(game:HttpGet(('https://gist.githubusercontent.com/meozoneYT/bf037dff9f0a70017304ddd67fdcd370/raw/e14e74f425b060df523343cf30b787074eb3c5d2/arceus%2520x%2520fly%25202%2520obflucator'),true))()\n\n")()
  end) Tab3Section:NewButton("Infinity yield FE", "No description", function () loadstring(game:HttpGet('https://raw.githubusercontent.com/EdgeIY/infiniteyield/master/source'))()
  end) Tab3Section:NewButton("RTX Gui", "No description", function () loadstring(game:HttpGet('https://pastebin.com/raw/Bkf0BJb3'))()
  end) Tab3Section:NewButton("Admin GUI", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/fatesc/fates-admin/main/main.lua"))();
  end) Tab3Section:NewButton("Yeet Gui", "No description", function ()
    local num1 = game:FindService("Players").LocalPlayer
    local
    function gplr(String)
      local Found = {}
      local strl = String:lower()
      if strl == "all" then
        for i, v in pairs(game:FindService("Players"):GetPlayers()) do
          table.insert(Found, v)
        end
      elseif strl == "others" then
        for i, v in pairs(game:FindService("Players"):GetPlayers()) do
          if v.Name ~= num1.Name then
            table.insert(Found, v)
          end
        end
      elseif strl == "me" then
        for i, v in pairs(game:FindService("Players"):GetPlayers()) do
          if v.Name == num1.Name then
            table.insert(Found, v)
          end
        end
      else
        for i, v in pairs(game:FindService("Players"):GetPlayers()) do
          if v.Name:lower():sub(1, # String) == String:lower() then
            table.insert(Found, v)
          end
        end
      end
      return Found
    end
    local
    function notif(str, num2) game:FindService("StarterGui"):SetCore("SendNotification", {Title = "yeet gui", Text = str, Icon = "rbxassetid://2005276185", Duration = num2 or 3})
    end --// sds
    local value1 = Instance.new("ScreenGui")
    local Main = Instance.new("ImageLabel")
    local num3 = Instance.new("Frame")
    local Title = Instance.new("TextLabel")
    local TextBox = Instance.new("TextBox")
    local TextButton = Instance.new("TextButton") value1.Name = "h" value1.Parent = game:GetService("CoreGui") value1.ResetOnSpawn = false Main.Name = "Main" Main.Parent = value1 Main.Active = true Main.Draggable = true Main.BackgroundColor3 = Color3.fromRGB(255, 255, 255) Main.BorderSizePixel = 0 Main.Position = UDim2.new(0.174545452, 0, 0.459574461, 0) Main.Size = UDim2.new(0, 454, 0, 218) Main.Image = "rbxassetid://2005276185" num3.Name = "Top" num3.Parent = Main num3.BackgroundColor3 = Color3.fromRGB(57, 57, 57) num3.BorderSizePixel = 0 num3.Size = UDim2.new(0, 454, 0, 44) Title.Name = "Title" Title.Parent = num3 Title.BackgroundColor3 = Color3.fromRGB(49, 49, 49) Title.BorderSizePixel = 0 Title.Position = UDim2.new(0, 0, 0.295454562, 0) Title.Size = UDim2.new(0, 454, 0, 30) Title.Font = Enum.Font.SourceSans Title.Text = "FE Yeet Gui (trollface edition)" Title.TextColor3 = Color3.fromRGB(255, 255, 255) Title.TextScaled = true Title.TextSize = 14.000 Title.TextWrapped = true TextBox.Parent = Main TextBox.BackgroundColor3 = Color3.fromRGB(49, 49, 49) TextBox.BorderSizePixel = 0 TextBox.Position = UDim2.new(0.0704845786, 0, 0.270642221, 0) TextBox.Size = UDim2.new(0, 388, 0, 62) TextBox.Font = Enum.Font.SourceSans TextBox.PlaceholderText = "Who do i destroy(can be shortened)" TextBox.Text = "" TextBox.TextColor3 = Color3.fromRGB(255, 255, 255) TextBox.TextScaled = true TextBox.TextSize = 14.000 TextBox.TextWrapped = true TextButton.Parent = Main TextButton.BackgroundColor3 = Color3.fromRGB(49, 49, 49) TextButton.BorderSizePixel = 0 TextButton.Position = UDim2.new(0.10352423, 0, 0.596330225, 0) TextButton.Size = UDim2.new(0, 359, 0, 50) TextButton.Font = Enum.Font.SourceSans TextButton.Text = "Cheese em'" TextButton.TextColor3 = Color3.fromRGB(255, 255, 255) TextButton.TextScaled = true TextButton.TextSize = 14.000 TextButton.TextWrapped = true TextButton.MouseButton1Click:Connect(function ()
        local Target = gplr(TextBox.Text)
        if Target[1] then
          Target = Target[1]
          local Thrust = Instance.new('BodyThrust', num1.Character.HumanoidRootPart) Thrust.Force = Vector3.new(9999, 9999, 9999) Thrust.Name = "YeetForce"
          repeat
            num1.Character.HumanoidRootPart.CFrame = Target.Character.HumanoidRootPart.CFrame Thrust.Location = Target.Character.HumanoidRootPart.Position game:FindService("RunService").Heartbeat:wait()
          until not Target.Character:FindFirstChild("Head")
        else notif("Invalid player")
        end
      end) --//fsddfsdf
    notif("Loaded successfully! Created by scuba#0001", 5)
  end) Tab3Section:NewButton("Admin Hub", "No description", function () loadstring(game:HttpGet("https://raw.githubusercontent.com/HeyGyt/simplityv2/main/main"))()
  end) Tab3Section:NewButton("FE R15 Emotes", "No description", function () loadstring(game:HttpGet("https://gitlab.com/Tsuniox/lua-stuff/-/raw/master/R15GUI.lua"))()
  end)
