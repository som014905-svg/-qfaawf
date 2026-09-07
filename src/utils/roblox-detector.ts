// Roblox runtime detection — scans deobfuscated output for Roblox-specific
// APIs (game, workspace, GetService, FindFirstChild, WaitForChild, etc.)
// and emits a summary so the user can see what the script actually does.
//
// This is purely a read-only static scan — it does NOT execute anything.

export interface RobloxApiUsage {
  /** Category of the API */
  category: "service" | "instance" | "input" | "ui" | "remote" | "datastore" | "player" | "other";
  /** The matched API call */
  call: string;
  /** How many times it appears */
  count: number;
  /** A short description */
  description: string;
}

const ROBLOX_PATTERNS: Array<{ re: RegExp; category: RobloxApiUsage["category"]; description: string }> = [
  // Services
  { re: /\bGetService\s*\(\s*["'](\w+)["']\s*\)/g, category: "service", description: "GetService('%s')" },
  { re: /\bgame\b/g, category: "service", description: "game (DataModel)" },
  { re: /\bworkspace\b/g, category: "service", description: "workspace (Workspace)" },
  { re: /\bPlayers\b/g, category: "service", description: "Players service" },
  { re: /\bRunService\b/g, category: "service", description: "RunService" },
  { re: /\bReplicatedStorage\b/g, category: "service", description: "ReplicatedStorage" },
  { re: /\bServerScriptService\b/g, category: "service", description: "ServerScriptService" },
  { re: /\bServerStorage\b/g, category: "service", description: "ServerStorage" },
  { re: /\bLighting\b/g, category: "service", description: "Lighting" },
  { re: /\bSoundService\b/g, category: "service", description: "SoundService" },
  { re: /\bUserInputService\b/g, category: "service", description: "UserInputService" },
  { re: /\bContextActionService\b/g, category: "service", description: "ContextActionService" },
  { re: /\bTweenService\b/g, category: "service", description: "TweenService" },
  { re: /\bHttpService\b/g, category: "service", description: "HttpService" },
  { re: /\bDataStoreService\b/g, category: "service", description: "DataStoreService" },
  // Instance methods
  { re: /\bFindFirstChild\b/g, category: "instance", description: "FindFirstChild" },
  { re: /\bWaitForChild\b/g, category: "instance", description: "WaitForChild" },
  { re: /\bFindFirstChildWhichIsA\b/g, category: "instance", description: "FindFirstChildWhichIsA" },
  { re: /\bFindFirstChildOfClass\b/g, category: "instance", description: "FindFirstChildOfClass" },
  { re: /\bGetChildren\b/g, category: "instance", description: "GetChildren" },
  { re: /\bGetDescendants\b/g, category: "instance", description: "GetDescendants" },
  { re: /\bIsA\b/g, category: "instance", description: "IsA" },
  { re: /\bClone\b/g, category: "instance", description: "Clone" },
  { re: /\bDestroy\b/g, category: "instance", description: "Destroy" },
  { re: /\bSetPrimaryPartCFrame\b/g, category: "instance", description: "SetPrimaryPartCFrame" },
  // Input
  { re: /\bSendKeyEvent\b/g, category: "input", description: "SendKeyEvent (WeAreDevs)" },
  { re: /\bmouse1click\b/g, category: "input", description: "mouse1click (WeAreDevs)" },
  { re: /\bmouse1press\b/g, category: "input", description: "mouse1press (WeAreDevs)" },
  { re: /\bmouse1release\b/g, category: "input", description: "mouse1release (WeAreDevs)" },
  { re: /\bkeypress\b/g, category: "input", description: "keypress (WeAreDevs)" },
  { re: /\bkeyrelease\b/g, category: "input", description: "keyrelease (WeAreDevs)" },
  { re: /\bkeytap\b/g, category: "input", description: "keytap (WeAreDevs)" },
  { re: /\bGetMouse\b/g, category: "input", description: "GetMouse" },
  // UI
  { re: /\bScreenGui\b/g, category: "ui", description: "ScreenGui" },
  { re: /\bFrame\b/g, category: "ui", description: "Frame" },
  { re: /\bTextButton\b/g, category: "ui", description: "TextButton" },
  { re: /\bTextLabel\b/g, category: "ui", description: "TextLabel" },
  { re: /\bTextBox\b/g, category: "ui", description: "TextBox" },
  { re: /\bScrollingFrame\b/g, category: "ui", description: "ScrollingFrame" },
  // Remotes (RemoteFunction / RemoteEvent)
  { re: /\bRemoteFunction\b/g, category: "remote", description: "RemoteFunction" },
  { re: /\bRemoteEvent\b/g, category: "remote", description: "RemoteEvent" },
  { re: /\bBindableFunction\b/g, category: "remote", description: "BindableFunction" },
  { re: /\bBindableEvent\b/g, category: "remote", description: "BindableEvent" },
  { re: /\bFireServer\b/g, category: "remote", description: "FireServer" },
  { re: /\bInvokeServer\b/g, category: "remote", description: "InvokeServer" },
  { re: /\bOnServerEvent\b/g, category: "remote", description: "OnServerEvent" },
  { re: /\bOnServerInvoke\b/g, category: "remote", description: "OnServerInvoke" },
  // DataStore
  { re: /\bGetDataStore\b/g, category: "datastore", description: "GetDataStore" },
  { re: /\bSetAsync\b/g, category: "datastore", description: "SetAsync" },
  { re: /\bGetAsync\b/g, category: "datastore", description: "GetAsync" },
  { re: /\bUpdateAsync\b/g, category: "datastore", description: "UpdateAsync" },
  { re: /\bIncrementAsync\b/g, category: "datastore", description: "IncrementAsync" },
  // Player
  { re: /\bLocalPlayer\b/g, category: "player", description: "LocalPlayer" },
  { re: /\bGetPlayerFromCharacter\b/g, category: "player", description: "GetPlayerFromCharacter" },
  { re: /\bGetPlayers\b/g, category: "player", description: "GetPlayers" },
  { re: /\bCharacter\b/g, category: "player", description: "Character" },
  { re: /\bHumanoid\b/g, category: "player", description: "Humanoid" },
  { re: /\bHumanoidRootPart\b/g, category: "player", description: "HumanoidRootPart" },
  { re: /\bWalkSpeed\b/g, category: "player", description: "WalkSpeed" },
  { re: /\bJumpPower\b/g, category: "player", description: "JumpPower" },
  // Common Roblox globals
  { re: /\btick\s*\(/g, category: "other", description: "tick()" },
  { re: /\bwait\s*\(/g, category: "other", description: "wait()" },
  { re: /\btask\.wait\s*\(/g, category: "other", description: "task.wait()" },
  { re: /\btask\.spawn\s*\(/g, category: "other", description: "task.spawn()" },
  { re: /\bloadstring\s*\(/g, category: "other", description: "loadstring()" },
  { re: /\bgetfenv\s*\(/g, category: "other", description: "getfenv()" },
  { re: /\bgetgenv\s*\(/g, category: "other", description: "getgenv() (exploit)" },
  { re: /\bsetclipboard\s*\(/g, category: "other", description: "setclipboard() (exploit)" },
  { re: /\bSynapse\s*\(/g, category: "other", description: "Synapse (exploit)" },
  { re: /\bDrawing\s*\./g, category: "other", description: "Drawing (exploit)" },
];

export interface RobloxScanResult {
  found: boolean;
  usages: RobloxApiUsage[];
  totalCalls: number;
  summary: string;
  /** True if the script appears to require Roblox runtime to run */
  requiresRoblox: boolean;
  /** List of services the script accesses */
  services: string[];
}

export function scanRobloxApiUsage(source: string): RobloxScanResult {
  const usages: RobloxApiUsage[] = [];
  const services = new Set<string>();
  let totalCalls = 0;

  for (const p of ROBLOX_PATTERNS) {
    p.re.lastIndex = 0;
    const matches = source.match(p.re);
    if (matches && matches.length > 0) {
      const count = matches.length;
      totalCalls += count;
      const call = p.description.replace("%s", "");
      usages.push({
        category: p.category,
        call,
        count,
        description: p.description,
      });
      // Track services
      if (p.category === "service" && p.description.startsWith("GetService")) {
        const svcRe = /GetService\s*\(\s*["'](\w+)["']\s*\)/g;
        let sm: RegExpExecArray | null;
        while ((sm = svcRe.exec(source)) !== null) {
          services.add(sm[1]);
        }
      }
    }
  }

  // Sort by count desc
  usages.sort((a, b) => b.count - a.count);

  const found = usages.length > 0;
  const requiresRoblox = totalCalls > 5 || services.size > 0;

  let summary: string;
  if (!found) {
    summary = "No Roblox API usage detected — this script does not require the Roblox runtime.";
  } else {
    const top = usages.slice(0, 5).map((u) => `${u.call}×${u.count}`).join(", ");
    summary = `Roblox runtime required. Top APIs: ${top}${services.size > 0 ? ` (services: ${[...services].join(", ")})` : ""}`;
  }

  return {
    found,
    usages,
    totalCalls,
    summary,
    requiresRoblox,
    services: [...services],
  };
}
