// Obfuscator detection — recognises ~55 Lua/Luau obfuscators by banner
// comments, URLs, distinctive tokens, and structural heuristics.
//
// Each rule has a weight (0..1). The detector returns the best match.
// Forks of a parent obfuscator are detected via the parent's pattern too
// (e.g. "45ms promfork" matches both "prometheus" and "45ms").

import { ObfuscatorId, DetectionMatch } from "../types";
import {
  findDecoyStringRanges,
  firstMatchPreferOutsideDecoys,
} from "../utils/lua-utils";

interface Rule {
  id: ExtendedObfuscatorId;
  patterns: Array<{ re: RegExp; weight: number; desc: string }>;
}

// Full list of obfuscator IDs we can detect. The ObfuscatorId type is
// extended at runtime — anything matching is a valid id.
type ExtendedObfuscatorId =
  | ObfuscatorId
  // Luraph family
  | "luraph_all"
  // Moonsec family
  | "moonsec_all"
  // Ironbrew family (1 + 2 + forks)
  | "ironbrew1"
  | "ironboobs"
  | "ib2_fork"
  // WeAreDevs family
  | "wearedevs_new"
  // Prometheus family
  | "prometheus_v2"
  | "promfork_25ms"
  | "promfork_45ms"
  // VM-based
  | "lumora"
  | "lunar"
  | "boronide"
  | "unveilx"
  | "goofyscator"
  | "goyim"
  | "cslo"
  | "luager"
  | "ndraawz"
  | "esoteric"
  | "constbrew"
  | "buluark"
  | "xhider"
  | "gaudeamus"
  | "fuscator69"
  | "ironveil"
  | "carbonfuscator"
  | "xenor"
  | "superobf"
  | "hiddenvaults"
  | "namaiki"
  | "hercules"
  | "zenoobf"
  | "fireflyprotector"
  | "luarmor"
  | "luaq"
  | "wynfuscator"
  | "blueberry"
  | "6vfuscator"
  | "promia"
  | "leakd"
  | "thorve"
  | "vaq"
  | "veil"
  | "mato"
  | "2hbj"
  | "eunc"
  | "psu"
  | "synapsexen" // Synapse Xen (SynapseXen_ prefixed vars)
  | "ironbrew3" // IronBrew3 (:tm: banner)
  | "lps" // LPS obfuscator ("LPS$" payload / base85)
  | "luaobfuscator_com"
  | "hide_lat"
  | "clyde_protection"
  | "clyde"
  | "syscure"
  | "keyforge"
  // NEW from leaked source analysis
  | "fuscator77"           // 77fuscator (IronBrew2 fork)
  | "zzzobfuscator"        // sibling of Clyde
  | "lunr"                 // Lunr obfuscator
  | "mimic"                // Mimic V3 dumper/sandbox (output marker)
  | "penguenv"             // PenguEnv
  | "unveilr"              // Unveilr v1.0.6 / v3
  | "flamecoder"           // Flamecoder / FlameExecutor
  | "larry"                // Larry dumper
  | "67fuscator"           // 67fuscator (leak announcement)
  | "tagtable_vm";         // tagged string-table VM (IronBrew v2 / AztupBrew layout)

const ALL_IDS: string[] = [
  // existing
  "luraph", "moonsec", "ironbrew", "wearedevs", "prometheus", "moonveil",
  "luauvmp", "prometheusv2", "generic",
  // new
  "luraph_all", "moonsec_all", "ironbrew1", "ironboobs", "ib2_fork",
  "wearedevs_new", "prometheus_v2", "promfork_25ms", "promfork_45ms",
  "lumora", "lunar", "boronide", "unveilx", "goofyscator", "goyim", "cslo",
  "luager", "ndraawz", "esoteric", "constbrew", "buluark", "xhider",
  "gaudeamus", "fuscator69", "clyde", "ironveil", "carbonfuscator", "xenor",
  "superobf", "hiddenvaults", "namaiki", "hercules", "zenoobf",
  "fireflyprotector", "luarmor", "luaq", "wynfuscator", "blueberry",
  "6vfuscator", "promia", "leakd", "thorve", "vaq", "veil", "mato", "2hbj",
  "eunc", "psu", "synapsexen", "ironbrew3", "lps", "luaobfuscator_com", "hide_lat", "clyde_protection",
  "syscure", "keyforge", "qmarker_vm",
  // NEW from leaked source analysis
  "fuscator77", "zzzobfuscator", "lunr", "mimic", "penguenv", "unveilr",
  "flamecoder", "larry", "67fuscator", "tagtable_vm",
];

// Build the RULES table. We co-locate all patterns for the same obfuscator.
// Many of these are best-effort guesses based on the obfuscator name and
// common Lua obfuscation conventions — if the actual banner differs, the
// generic fallback will still run.
const RULES: Rule[] = [
  // === Luraph family ===
  {
    id: "luraph",
    patterns: [
      { re: /Luraph\s*Obfuscator\s*v?\d+(?:\.\d+)?/i, weight: 0.95, desc: "Luraph version banner" },
      { re: /This\s*file\s*was\s*(?:protected|generated)\s*using\s*Luraph/i, weight: 0.95, desc: "Luraph generated banner" },
      { re: /\[\[Luraph\b/i, weight: 0.9, desc: "Luraph banner string" },
      { re: /\bLPH[\s_]*[0-9A-Za-z]{20,}/, weight: 0.9, desc: "LPH loader signature" },
      { re: /lura\.ph/i, weight: 0.85, desc: "lura.ph URL" },
      { re: /LPH>!!/, weight: 0.9, desc: "LPH> payload prefix (v14.x)" },
      { re: /LPH\+/, weight: 0.9, desc: "LPH+ payload prefix (v15.x)" },
      { re: /Luraph\s*decompression\s*error/i, weight: 0.85, desc: "Luraph decompression error message" },
    ],
  },
  {
    id: "luraph_all",
    patterns: [
      { re: /Luraph\b.*all\s*latest/i, weight: 0.7, desc: "Luraph 'all latest' variant" },
    ],
  },
  // === Moonsec family ===
  {
    id: "moonsec",
    patterns: [
      { re: /Protected_by_MoonSecV?\d?/i, weight: 0.95, desc: "MoonSec V2 protection global" },
      { re: /MoonSec(?:V\d)?\b/i, weight: 0.9, desc: "MoonSec banner" },
      { re: /--\s*MoonSec/i, weight: 0.85, desc: "MoonSec comment" },
      { re: /\[\[MoonSec\b/i, weight: 0.85, desc: "MoonSec banner string" },
      { re: /_msec\s*=\s*\(/, weight: 0.85, desc: "MoonSec V2 _msec loader" },
    ],
  },
  {
    id: "moonsec_all",
    patterns: [
      { re: /MoonSec\b.*all\s*versions/i, weight: 0.7, desc: "MoonSec 'all versions' variant" },
    ],
  },
  // === Moonveil family ===
  {
    id: "moonveil",
    patterns: [
      { re: /MoonVeil\s*v?\d+(?:\.\d+)?/i, weight: 0.95, desc: "MoonVeil version banner" },
      { re: /\[\[MoonVeil\b/i, weight: 0.9, desc: "MoonVeil banner string" },
      { re: /--\s*MoonVeil/i, weight: 0.85, desc: "MoonVeil comment" },
      { re: /\bMoonVeil\b/i, weight: 0.7, desc: "MoonVeil token" },
    ],
  },
  // === Ironbrew family ===
  {
    id: "ironbrew",
    patterns: [
      { re: /IronBrew2?\b/i, weight: 0.9, desc: "IronBrew banner" },
      { re: /--\s*Obfuscated\s*by\s*IronBrew/i, weight: 0.9, desc: "IronBrew obfuscation comment" },
      { re: /\[\[IronBrew\b/i, weight: 0.85, desc: "IronBrew banner string" },
      { re: /vm_\w*\s*=\s*\{/, weight: 0.4, desc: "IronBrew-style vm_ table" },
      // IronBrew2 VM header without banner: the gsub byte-table builder
      //   local function M(i)local e,n,t="","",{}local a=256;
      { re: /local function \w+\(\w+\)local \w+,\w+,\w+="","",\{\}local \w+=256/, weight: 0.9, desc: "IronBrew2 byte-table VM header" },
    ],
  },
  // === IronBrew3 (:tm:) ===
  {
    id: "ironbrew3",
    patterns: [
      { re: /--\s*ironbrew3(?::tm:)?/i, weight: 0.95, desc: "IronBrew3 banner comment" },
      { re: /ironbrew3(?::tm:)?[, ]\s*v?\d+(?:\.\d+)?/i, weight: 0.95, desc: "IronBrew3 version banner" },
    ],
  },
  {
    id: "ironbrew1",
    patterns: [
      { re: /Ironbrew\s*v?1\b/i, weight: 0.85, desc: "Ironbrew v1 banner" },
      { re: /--\s*Ironbrew\s*v?1/i, weight: 0.8, desc: "Ironbrew v1 comment" },
    ],
  },
  {
    id: "ironboobs",
    patterns: [
      { re: /ironboobs\b/i, weight: 0.85, desc: "ironboobs banner" },
      { re: /--\s*ironboobs/i, weight: 0.8, desc: "ironboobs comment" },
    ],
  },
  {
    id: "ib2_fork",
    patterns: [
      { re: /ib2\b.*fork/i, weight: 0.7, desc: "ib2 fork banner" },
      { re: /Ironbrew\s*2?\s*fork/i, weight: 0.7, desc: "Ironbrew fork banner" },
    ],
  },
  {
    id: "ironveil",
    patterns: [
      // Exact banner from leaked sample: --[[\nObfuscated using ironveil v1 - https://discord.gg/qKyZKDWZRQ\n]]
      { re: /Obfuscated\s+using\s+ironveil\s+v\d+\s*-\s*https:\/\/discord\.gg\/\w+/i, weight: 0.95, desc: "IronVeil banner (exact)" },
      { re: /\[\[\s*Obfuscated\s+using\s+ironveil/i, weight: 0.9, desc: "IronVeil long-bracket banner" },
      { re: /Ironveil\s+v\d+/i, weight: 0.85, desc: "IronVeil version banner" },
      { re: /Ironveil\b/i, weight: 0.8, desc: "IronVeil token" },
      { re: /--\s*Ironveil/i, weight: 0.8, desc: "IronVeil comment" },
    ],
  },
  // === WeAreDevs family ===
  {
    id: "wearedevs",
    patterns: [
      { re: /wearedevs\.net\/obfuscator/i, weight: 0.95, desc: "WeAreDevs obfuscator URL" },
      { re: /WeAreDevs\b/i, weight: 0.85, desc: "WeAreDevs banner" },
      { re: /--\s*WeAreDevs/i, weight: 0.85, desc: "WeAreDevs comment" },
      { re: /\[\[WeAreDevs\b/i, weight: 0.85, desc: "WeAreDevs banner string" },
    ],
  },
  {
    id: "wearedevs_new",
    patterns: [
      { re: /WeAreDevs\b.*(?:new\s*anti[-\s]?tamper|anti[-\s]?tamper)/i, weight: 0.85, desc: "WeAreDevs new anti-tamper banner" },
    ],
  },
  // === Prometheus family ===
  {
    id: "prometheus",
    patterns: [
      { re: /Prometheus\s*-?\s*Deobfuscator\b/i, weight: 0.85, desc: "Prometheus banner" },
      { re: /\[\[Prometheus\b/i, weight: 0.8, desc: "Prometheus banner string" },
      { re: /--\s*Prometheus\b/i, weight: 0.8, desc: "Prometheus comment" },
      // Banner-less Prometheus output: `return(function(...)local g={"\ddd…"}}`
      // — decimal-escaped string table immediately after the wrapper prologue.
      { re: /return\s*\(function\s*\(\.\.\.\)\s*local\s+\w+\s*=\s*\{["']\\\d{3}/, weight: 0.8, desc: "Prometheus decimal-escaped string table layout" },
    ],
  },
  {
    id: "prometheusv2",
    patterns: [
      { re: /Prometheus\s*-?\s*V?2\b/i, weight: 0.85, desc: "Prometheus V2 banner" },
      { re: /--\s*Prometheus\s*-?\s*V?2/i, weight: 0.8, desc: "Prometheus V2 comment" },
    ],
  },
  {
    id: "promfork_25ms",
    patterns: [
      // From leaked 25ms source: "obfuscated @ discord.gg/25ms"
      { re: /obfuscated\s*@\s*discord\.gg\/25ms/i, weight: 0.95, desc: "25ms obfuscator banner (exact)" },
      // 25ms watermark: "CrackGuard by 25ms", "Hi25ms", "By25ms"
      { re: /CrackGuard\s+by\s+25ms/i, weight: 0.9, desc: "25ms CrackGuard watermark" },
      { re: /\bHi25ms\b/i, weight: 0.85, desc: "25ms Hi25ms watermark" },
      { re: /\bBy25ms\b/i, weight: 0.85, desc: "25ms By25ms watermark" },
      { re: /this\s+crack\s+was\s+made\s+by\s+25ms/i, weight: 0.9, desc: "25ms crack watermark" },
      // 25ms getgenv watermark pattern
      { re: /getgenv\(\)\s*\[\s*"[^"]+"\s*\]\s*=\s*function\s*\(/, weight: 0.85, desc: "25ms getgenv watermark pattern" },
      { re: /25ms\b.*promfork/i, weight: 0.85, desc: "25ms promfork banner" },
      { re: /discord\.gg\/25ms/i, weight: 0.8, desc: "25ms discord invite" },
      { re: /45-ms\.netlify\.app/i, weight: 0.8, desc: "25ms netlify URL" },
    ],
  },
  {
    id: "promfork_45ms",
    patterns: [
      { re: /45ms\b.*promfork/i, weight: 0.85, desc: "45ms promfork banner" },
      { re: /45ms\b.*forked\s*obfuscator/i, weight: 0.85, desc: "45ms forked obfuscator banner" },
      { re: /45ms\s+fork/i, weight: 0.7, desc: "45ms fork banner" },
    ],
  },
  // === LuaObfuscator.com ===
  {
    id: "luaobfuscator_com",
    patterns: [
      { re: /luaobfuscator\.com/i, weight: 0.9, desc: "luaobfuscator.com URL" },
      { re: /--\s*Obfuscated\s*by\s*LuaObfuscator/i, weight: 0.9, desc: "LuaObfuscator.com comment" },
      // Banner-less variants (ChaoticGood/ChaoticEvil/VM): vN-prefixed prelude
      //   local v0=string.char;local v1=string.byte;local v2=string.sub;
      { re: /^local v\d+\s*=\s*(?:string\.char|tonumber);\s*local v\d+\s*=\s*string\.byte/m, weight: 0.85, desc: "LuaObfuscator.com vN prelude layout" },
      { re: /^local v\d+=string\.char;local v\d+=string\.byte;local v\d+=string\.sub;local v\d+=bit32 or bit\s*;/m, weight: 0.9, desc: "LuaObfuscator.com XOR prelude layout" },
    ],
  },
  // === hide.lat ===
  {
    id: "hide_lat",
    patterns: [
      { re: /hide\.lat/i, weight: 0.9, desc: "hide.lat URL" },
      { re: /--\s*hide\.lat/i, weight: 0.85, desc: "hide.lat comment" },
    ],
  },
  // === Lumora ===
  {
    id: "lumora",
    patterns: [
      { re: /Lumora\b/i, weight: 0.85, desc: "Lumora banner" },
      { re: /--\s*Lumora/i, weight: 0.8, desc: "Lumora comment" },
      { re: /\[\[Lumora\b/i, weight: 0.8, desc: "Lumora banner string" },
    ],
  },
  // === Lunar ===
  {
    id: "lunar",
    patterns: [
      { re: /Lunar\s*Obfuscator\b/i, weight: 0.85, desc: "Lunar obfuscator banner" },
      { re: /--\s*Lunar\s*Obfuscator/i, weight: 0.8, desc: "Lunar obfuscator comment" },
      { re: /\[\[Lunar\b/i, weight: 0.8, desc: "Lunar banner string" },
    ],
  },
  // === Boronide ===
  {
    id: "boronide",
    patterns: [
      // Real banner from samples: `--[[\n\thertt's obfuscator, v0.2.4\n--]]`
      { re: /herrtt'?s?\s*obfuscator/i, weight: 0.95, desc: "herrtt's obfuscator banner (Boronide)" },
      { re: /discord\.gg\/BZEjFbeUvk/i, weight: 0.9, desc: "Boronide discord invite" },
      { re: /Boronide[^\n]{0,30}V?\d+(?:\.\d+)?/i, weight: 0.9, desc: "Boronide version banner" },
      { re: /Boroide[^\n]{0,30}V?\d+(?:\.\d+)?/i, weight: 0.9, desc: "Boroide (typo) version banner" },
      { re: /--\s*Boronide/i, weight: 0.8, desc: "Boronide comment" },
      { re: /\bBoronide\b/i, weight: 0.7, desc: "Boronide token" },
    ],
  },
  // === unveilX ===
  {
    id: "unveilx",
    patterns: [
      { re: /unveilX\b/i, weight: 0.85, desc: "unveilX banner" },
      { re: /--\s*unveilX/i, weight: 0.8, desc: "unveilX comment" },
      { re: /\[\[unveilX\b/i, weight: 0.8, desc: "unveilX banner string" },
    ],
  },
  // === goofyscator ===
  {
    id: "goofyscator",
    patterns: [
      { re: /goofyscator\s*V?\d+(?:\.\d+)?/i, weight: 0.9, desc: "goofyscator version banner" },
      { re: /--\s*goofyscator/i, weight: 0.8, desc: "goofyscator comment" },
      { re: /\bgoofyscator\b/i, weight: 0.7, desc: "goofyscator token" },
    ],
  },
  // === goyim ===
  {
    id: "goyim",
    patterns: [
      { re: /goyim\s*obfuscator\b/i, weight: 0.85, desc: "goyim obfuscator banner" },
      { re: /--\s*goyim/i, weight: 0.8, desc: "goyim comment" },
      { re: /\bgoyim\b/i, weight: 0.6, desc: "goyim token" },
    ],
  },
  // === CSLO ===
  {
    id: "cslo",
    patterns: [
      { re: /\bCSLO\b/i, weight: 0.85, desc: "CSLO banner" },
      { re: /--\s*CSLO/i, weight: 0.8, desc: "CSLO comment" },
    ],
  },
  // === Luager ===
  {
    id: "luager",
    patterns: [
      { re: /Luager\b/i, weight: 0.85, desc: "Luager banner" },
      { re: /--\s*Luager/i, weight: 0.8, desc: "Luager comment" },
    ],
  },
  // === Ndraawz Protect ===
  {
    id: "ndraawz",
    patterns: [
      { re: /Ndraawz\s*Protect\b/i, weight: 0.85, desc: "Ndraawz Protect banner" },
      { re: /--\s*Ndraawz/i, weight: 0.8, desc: "Ndraawz comment" },
      { re: /\bNdraawz\b/i, weight: 0.7, desc: "Ndraawz token" },
    ],
  },
  // === esoteric.win ===
  {
    id: "esoteric",
    patterns: [
      { re: /esoteric\.win/i, weight: 0.9, desc: "esoteric.win URL" },
      { re: /--\s*esoteric/i, weight: 0.8, desc: "esoteric comment" },
      { re: /\besoteric\b/i, weight: 0.7, desc: "esoteric token" },
    ],
  },
  // === ConstBrew ===
  {
    id: "constbrew",
    patterns: [
      { re: /ConstBrew\b/i, weight: 0.85, desc: "ConstBrew banner" },
      { re: /--\s*ConstBrew/i, weight: 0.8, desc: "ConstBrew comment" },
      { re: /\[\[ConstBrew\b/i, weight: 0.8, desc: "ConstBrew banner string" },
    ],
  },
  // === Buluark V3 ===
  {
    id: "buluark",
    patterns: [
      { re: /Buluark\s*V?3\b/i, weight: 0.9, desc: "Buluark V3 banner" },
      { re: /--\s*Buluark/i, weight: 0.8, desc: "Buluark comment" },
      { re: /\bBuluark\b/i, weight: 0.7, desc: "Buluark token" },
    ],
  },
  // === XHider ===
  {
    id: "xhider",
    patterns: [
      { re: /XHider\b/i, weight: 0.85, desc: "XHider banner" },
      { re: /--\s*XHider/i, weight: 0.8, desc: "XHider comment" },
    ],
  },
  // === Gaudeamus ===
  {
    id: "gaudeamus",
    patterns: [
      { re: /Gaudeamus\s*v?1\.0/i, weight: 0.9, desc: "Gaudeamus v1.0 banner" },
      { re: /--\s*Gaudeamus/i, weight: 0.8, desc: "Gaudeamus comment" },
      { re: /\bGaudeamus\b/i, weight: 0.7, desc: "Gaudeamus token" },
    ],
  },
  // === 69Fuscator ===
  {
    id: "fuscator69",
    patterns: [
      { re: /69Fuscator\b/i, weight: 0.85, desc: "69Fuscator banner" },
      { re: /--\s*69Fuscator/i, weight: 0.8, desc: "69Fuscator comment" },
    ],
  },
  // === Clyde ===
  // From leaked deobfuscator source: ClydeProtection / Clyde Protection v2
  // Banner: "Clyde Protection v2", URL: clydeprotectionde.cloud
  // Tagline: "Just like VMProtect, but for Lua."
  {
    id: "clyde",
    patterns: [
      { re: /Clyde\s+Protection\s+v2\b/i, weight: 0.95, desc: "Clyde Protection v2 banner (exact)" },
      { re: /https?:\/\/[^\s]*clydeprotection[a-z]*\.[a-z]+/i, weight: 0.9, desc: "Clyde Protection URL" },
      { re: /Just\s+like\s+VMProtect,?\s+but\s+for\s+Lua/i, weight: 0.95, desc: "Clyde tagline (exact)" },
      { re: /\bvmBlob\b.*\bbase85\b/i, weight: 0.85, desc: "Clyde VM vmBlob+base85 markers" },
      { re: /\bregister\s+VM\b.*\bstack\s+VM\b/i, weight: 0.8, desc: "Clyde VM markers" },
      { re: /Clyde\s*OBFUSCATOR\b/i, weight: 0.9, desc: "Clyde OBFUSCATOR banner" },
      { re: /--\s*Clyde\s*OBFUSCATOR/i, weight: 0.85, desc: "Clyde comment" },
      { re: /\bClyde\b.*obfuscat/i, weight: 0.7, desc: "Clyde obfuscator token" },
      // sfr-development/Lua-Obfuscator-Clyde-Protection register-VM output markers
      // The register-VM emits a `local __regs` register file + `local __pc` counter.
      {
        re: /local\s+\w+\s*=\s*\{\}\s*(?:--[^\n]*)?\s*local\s+\w+\s*=\s*0[\s\S]{0,300}while\s+true\s+do/,
        weight: 0.78,
        desc: "Clyde register-VM: regfile+pc+dispatch pattern",
      },
      // Stack-VM: push/pop + opcode loop
      {
        re: /local\s+\w+\s*=\s*\{\}\s*(?:--[^\n]*)?\s*local\s+\w+\s*=\s*0[\s\S]{0,500}?if\s+\w+\s*==\s*\d+\s*then[\s\S]{0,100}elseif\s+\w+\s*==\s*\d+/,
        weight: 0.76,
        desc: "Clyde stack-VM: stack+opcode-chain pattern",
      },
      // LZMA maximum-mode: lzma ref + a very long encoded blob
      {
        re: /\blzma\b[\s\S]{0,2000}?\[\[[\s\S]{3000,}/i,
        weight: 0.82,
        desc: "Clyde maximum-mode LZMA compressed payload",
      },
    ],
  },
  {
    id: "clyde_protection",
    patterns: [
      { re: /Clyde\s*Protection\b/i, weight: 0.85, desc: "Clyde Protection banner" },
      { re: /clyde-protection/i, weight: 0.85, desc: "clyde-protection repo name" },
      { re: /ClydeProtection\b/i, weight: 0.85, desc: "ClydeProtection banner" },
    ],
  },
  // === CarbonFuscator ===
  {
    id: "carbonfuscator",
    patterns: [
      { re: /CarbonFuscator\b/i, weight: 0.85, desc: "CarbonFuscator banner" },
      { re: /--\s*CarbonFuscator/i, weight: 0.8, desc: "CarbonFuscator comment" },
    ],
  },
  // === Xenor ===
  {
    id: "xenor",
    patterns: [
      { re: /Xenor\s*Obfuscator\b/i, weight: 0.85, desc: "Xenor obfuscator banner" },
      { re: /--\s*Xenor/i, weight: 0.8, desc: "Xenor comment" },
      { re: /\bXenor\b/i, weight: 0.7, desc: "Xenor token" },
    ],
  },
  // === SuperObf V2 ===
  {
    id: "superobf",
    patterns: [
      { re: /SuperObf\s*V?2\b/i, weight: 0.9, desc: "SuperObf V2 banner" },
      { re: /--\s*SuperObf/i, weight: 0.8, desc: "SuperObf comment" },
      { re: /\bSuperObf\b/i, weight: 0.7, desc: "SuperObf token" },
    ],
  },
  // === hiddenvaults.org ===
  {
    id: "hiddenvaults",
    patterns: [
      { re: /hiddenvaults\.org/i, weight: 0.9, desc: "hiddenvaults.org URL" },
      { re: /--\s*hiddenvaults/i, weight: 0.8, desc: "hiddenvaults comment" },
    ],
  },
  // === Namaiki ===
  {
    id: "namaiki",
    patterns: [
      { re: /Namaiki\b/i, weight: 0.85, desc: "Namaiki banner" },
      { re: /--\s*Namaiki/i, weight: 0.8, desc: "Namaiki comment" },
    ],
  },
  // === hercules ===
  {
    id: "hercules",
    patterns: [
      // Real banners: `--[Obfuscated by Hercules v1.6.2 | hercules-obfuscator.xyz/...]`
      // and the v2.0 variant which uses a different comment wrapper.
      { re: /--\s*\[\s*Obfuscated\s+by\s+Hercules/i, weight: 0.95, desc: "Hercules obfuscation banner (bracket comment)" },
      { re: /hercules-obfuscator\.xyz/i, weight: 0.9, desc: "hercules-obfuscator.xyz URL" },
      { re: /hercules\s*obfuscator\b/i, weight: 0.9, desc: "hercules obfuscator banner" },
      { re: /--\s*Obfuscated\s+by\s+Hercules\b/i, weight: 0.92, desc: "Hercules v2 comment banner" },
      // Structural: Hercules always emits global stdlib aliases + dead-code blocks.
      // `if false then local IDENT = NUM end` appearing 3+ times is a strong signal.
      // We check for the combination of stdlib alias + dead block rather than either alone.
      {
        re: /(?:if\s+false\s+then\s+local\s+\w+\s*=\s*\d+\s*end[\s\S]{0,200}){3}/,
        weight: 0.82,
        desc: "Hercules dead-code block cluster (3+ if-false stmts)",
      },
      {
        re: /while\s+false\s+do\s+local\s+\w+\s*=\s*\d+\s+break\s+end/,
        weight: 0.75,
        desc: "Hercules while-false dead-code block",
      },
      // Glob stdlib alias pair (string.char + table.concat at global scope)
      {
        re: /^[A-Za-z_]\w*\s*=\s*string\s*\.\s*char\s*$/m,
        weight: 0.70,
        desc: "Hercules glob string.char alias",
      },
      // Caesar IIFE: string.byte + arithmetic + %256 immediately called
      {
        re: /\(\s*function\s*\([^)]{1,30}\)[\s\S]{0,1000}?string\s*\.\s*byte[\s\S]{0,500}?%\s*256[\s\S]{0,500}?end\s*\)\s*\(/,
        weight: 0.78,
        desc: "Hercules Caesar cipher IIFE decoder",
      },
      { re: /--\s*hercules/i, weight: 0.75, desc: "hercules comment" },
      { re: /\bhercules\b/i, weight: 0.62, desc: "hercules token" },
    ],
  },
  // === ZenoObf ===
  {
    id: "zenoobf",
    patterns: [
      { re: /ZenoObf\b/i, weight: 0.85, desc: "ZenoObf banner" },
      { re: /--\s*ZenoObf/i, weight: 0.8, desc: "ZenoObf comment" },
    ],
  },
  // === fireflyprotector.xyz ===
  {
    id: "fireflyprotector",
    patterns: [
      { re: /fireflyprotector\.xyz/i, weight: 0.9, desc: "fireflyprotector.xyz URL" },
      { re: /firefly\s*protector/i, weight: 0.8, desc: "firefly protector banner" },
      { re: /--\s*firefly/i, weight: 0.7, desc: "firefly comment" },
    ],
  },
  // === Luarmor ===
  // From leaked 25ms dumper: URL pattern https://api.luarmor.net/files/v3/loaders/...
  // and https://api.luarmor.net/files/v3/l/...
  {
    id: "luarmor",
    patterns: [
      { re: /https?:\/\/api\.luarmor\.net\/files\/v3\/(?:loaders|l)\/[A-Za-z0-9_-]+/i, weight: 0.95, desc: "Luarmor API URL (exact)" },
      { re: /Luarmor\s*V?[123]\b/i, weight: 0.9, desc: "Luarmor version banner" },
      { re: /\bscript_key\s*=\s*["'][a-f0-9]+["']/i, weight: 0.85, desc: "Luarmor script_key global" },
      { re: /--\s*Luarmor/i, weight: 0.8, desc: "Luarmor comment" },
      { re: /\bLuarmor\b/i, weight: 0.7, desc: "Luarmor token" },
    ],
  },
  // === Luaq ===
  {
    id: "luaq",
    patterns: [
      { re: /Luaq\s*Obfuscator\b/i, weight: 0.85, desc: "Luaq obfuscator banner" },
      { re: /--\s*Luaq/i, weight: 0.8, desc: "Luaq comment" },
      { re: /\bLuaq\b/i, weight: 0.7, desc: "Luaq token" },
    ],
  },
  // === wynfuscator ===
  {
    id: "wynfuscator",
    patterns: [
      // Real banner: `-- Protected by wYnFuscate: https://wynfuscate.com | ...`
      { re: /wynfuscate\.com/i, weight: 0.95, desc: "wynfuscate.com URL" },
      { re: /wYnFuscate/i, weight: 0.9, desc: "wYnFuscate banner" },
      { re: /Protected\s+by\s+wYnFuscate/i, weight: 0.95, desc: "wYnFuscate protection banner" },
      { re: /discord\.gg\/Z5xQ47Mbnd/i, weight: 0.85, desc: "wYnFuscate discord invite" },
      { re: /wynfuscator\b/i, weight: 0.85, desc: "wynfuscator banner" },
      { re: /--\s*wynfuscator/i, weight: 0.8, desc: "wynfuscator comment" },
      { re: /\[\[wynfuscator\b/i, weight: 0.8, desc: "wynfuscator banner string" },
    ],
  },
  // === Blueberry ===
  {
    id: "blueberry",
    patterns: [
      { re: /Blueberry\s*Obfuscator\b/i, weight: 0.85, desc: "Blueberry obfuscator banner" },
      { re: /--\s*Blueberry/i, weight: 0.8, desc: "Blueberry comment" },
      { re: /\bBlueberry\b/i, weight: 0.6, desc: "Blueberry token" },
    ],
  },
  // === 6Vfuscator ===
  {
    id: "6vfuscator",
    patterns: [
      { re: /6Vfuscator\b/i, weight: 0.85, desc: "6Vfuscator banner" },
      { re: /--\s*6Vfuscator/i, weight: 0.8, desc: "6Vfuscator comment" },
    ],
  },
  // === Promia ===
  {
    id: "promia",
    patterns: [
      { re: /Promia\b/i, weight: 0.85, desc: "Promia banner" },
      { re: /--\s*Promia/i, weight: 0.8, desc: "Promia comment" },
    ],
  },
  // === LeakD ===
  {
    id: "leakd",
    patterns: [
      { re: /LeakD\b/i, weight: 0.85, desc: "LeakD banner" },
      { re: /--\s*LeakD/i, weight: 0.8, desc: "LeakD comment" },
    ],
  },
  // === Thorve ===
  {
    id: "thorve",
    patterns: [
      { re: /Thorve\b/i, weight: 0.85, desc: "Thorve banner" },
      { re: /--\s*Thorve/i, weight: 0.8, desc: "Thorve comment" },
    ],
  },
  // === VAQ ===
  {
    id: "vaq",
    patterns: [
      { re: /\bVAQ\s*obfuscator\b/i, weight: 0.85, desc: "VAQ obfuscator banner" },
      { re: /--\s*VAQ/i, weight: 0.8, desc: "VAQ comment" },
      // NOTE: bare `\bVAQ\b` token removed — it false-positives on random
      // base85-ish junk inside wYnFuscate/LPS string payloads (v4.1).
    ],
  },
  // === Veil ===
  {
    id: "veil",
    patterns: [
      { re: /Veil\s*obfuscator\b/i, weight: 0.85, desc: "Veil obfuscator banner" },
      { re: /--\s*Veil/i, weight: 0.8, desc: "Veil comment" },
    ],
  },
  // === Mato ===
  {
    id: "mato",
    patterns: [
      { re: /Mato\s*obfuscator\b/i, weight: 0.85, desc: "Mato obfuscator banner" },
      { re: /--\s*Mato/i, weight: 0.8, desc: "Mato comment" },
    ],
  },
  // === 2hbj ===
  {
    id: "2hbj",
    patterns: [
      { re: /2hbj\s*obfuscator\b/i, weight: 0.85, desc: "2hbj obfuscator banner" },
      { re: /--\s*2hbj/i, weight: 0.8, desc: "2hbj comment" },
      { re: /\b2hbj\b/i, weight: 0.7, desc: "2hbj token" },
    ],
  },
  // === e-unc / aspect-unc / gunc ===
  {
    id: "eunc",
    patterns: [
      { re: /\be-unc\b/i, weight: 0.85, desc: "e-unc banner" },
      { re: /\baspect-unc\b/i, weight: 0.85, desc: "aspect-unc banner" },
      { re: /\bgunc\b/i, weight: 0.8, desc: "gunc banner" },
      { re: /--\s*e-unc/i, weight: 0.8, desc: "e-unc comment" },
    ],
  },
  // === psu (psu.dev) ===
  {
    id: "psu",
    patterns: [
      { re: /PSU\s*Obfuscator\s*v?\d/i, weight: 0.95, desc: "PSU Obfuscator version banner" },
      { re: /Obfuscated\s+(?:using|by)\s+PSU/i, weight: 0.95, desc: "PSU obfuscation banner" },
      { re: /https?:\/\/(?:www\.)?psu\.dev/i, weight: 0.9, desc: "psu.dev URL" },
      { re: /discord\.gg\/psu\b/i, weight: 0.85, desc: "PSU discord invite" },
    ],
  },
  // === Synapse Xen ===
  {
    id: "synapsexen",
    patterns: [
      { re: /\bSynapseXen_[A-Za-zIl1]{4,}/, weight: 0.95, desc: "SynapseXen_ prefixed identifiers" },
      { re: /Synapse\s*Xen\s*v?\d/i, weight: 0.9, desc: "Synapse Xen version banner" },
      { re: /--[[^\n]{0,30}Synapse\s*Xen/i, weight: 0.9, desc: "Synapse Xen comment" },
    ],
  },
  // === LPS (Lua Protection System) ===
  {
    id: "lps",
    patterns: [
      { re: /"LPS\$/, weight: 0.95, desc: "LPS payload magic string" },
      { re: /\[\^!-uz\]/, weight: 0.8, desc: "LPS v2 base85 charset complement" },
      { re: /while\s*\(\s*[a-zA-Z]\s*\)\s*do\s+if\s*\(/, weight: 0.6, desc: "LPS v1 state dispatcher (while(y)do if(...))" },
    ],
  },
  // === 77fuscator (IronBrew2 fork, leaked) ===
  // From https://github.com/Bytecoded1337/77fuscatorDeobfuscator
  // Banner: [[77fuscator 0.6.1 EARLY BUILD]] or "77fuscator 0.4.9 - discord.gg/CEHsVcBcuf"
  // Magic: 77FUS|<hex> blob prefix
  {
    id: "fuscator77",
    patterns: [
      { re: /\[\[77fuscator\s+\d+\.\d+\.\d+[^\]]*\]\]/i, weight: 0.95, desc: "77fuscator version banner (long-bracket)" },
      { re: /77fuscator\s+\d+\.\d+\.\d+/i, weight: 0.9, desc: "77fuscator version banner" },
      { re: /77FUS\|[0-9A-F]+/, weight: 0.95, desc: "77FUS| hex blob magic prefix" },
      { re: /discord\.gg\/CEHsVcBcuf/i, weight: 0.85, desc: "77fuscator discord invite" },
    ],
  },
  // === 67fuscator (leak announcement, banner unknown) ===
  {
    id: "67fuscator",
    patterns: [
      { re: /67fuscator/i, weight: 0.85, desc: "67fuscator banner" },
      { re: /--\s*67fuscator/i, weight: 0.8, desc: "67fuscator comment" },
    ],
  },
  // === ZZZobfuscator (sibling of Clyde, R/S/T register VM) ===
  {
    id: "zzzobfuscator",
    patterns: [
      { re: /ZZZobfuscator\b/i, weight: 0.85, desc: "ZZZobfuscator banner" },
      { re: /--\s*ZZZobfuscator/i, weight: 0.8, desc: "ZZZobfuscator comment" },
    ],
  },
  // === Lunr obfuscator ===
  // From leaked sample: "-- this file is generated using lunr discord.gg/9yAtRgpsua"
  {
    id: "lunr",
    patterns: [
      { re: /generated\s+using\s+lunr\s+discord\.gg\/9yAtRgpsua/i, weight: 0.95, desc: "Lunr banner with discord" },
      { re: /\blunr\s+obfuscator\b/i, weight: 0.85, desc: "Lunr obfuscator banner" },
      { re: /--\s*lunr\b/i, weight: 0.8, desc: "Lunr comment" },
    ],
  },
  // === Mimic V3 (dumper/sandbox output marker) ===
  {
    id: "mimic",
    patterns: [
      { re: /--\s*Generated\s+by\s+Mimic\s+V3/i, weight: 0.9, desc: "Mimic V3 output banner" },
      { re: /\bMimicDumper\b/i, weight: 0.8, desc: "MimicDumper identifyexecutor" },
    ],
  },
  // === PenguEnv ===
  // From leaked sample: "-- Generated using PenguEnv ( Me Pro) https://discord.gg/uWCzJDPmgK"
  {
    id: "penguenv",
    patterns: [
      { re: /Generated\s+using\s+PenguEnv/i, weight: 0.9, desc: "PenguEnv banner" },
      { re: /PenguEnv\s+V\d+\.\d+/i, weight: 0.9, desc: "PenguEnv version banner" },
      { re: /discord\.gg\/uWCzJDPmgK/i, weight: 0.85, desc: "PenguEnv discord invite" },
      { re: /dsc\.gg\/pngenv/i, weight: 0.85, desc: "PenguEnv shortlink" },
    ],
  },
  // === Unveilr (v1.0.6 / v3) ===
  // Banner: "This file was generated with UnveilR v{version}."
  {
    id: "unveilr",
    patterns: [
      { re: /This\s+file\s+was\s+generated\s+with\s+UnveilR\s+v\d+(?:\.\d+)+/i, weight: 0.95, desc: "UnveilR version banner" },
      { re: /\bUnveilR\s+v\d/i, weight: 0.85, desc: "UnveilR version token" },
      { re: /discord\.gg\/threaded/i, weight: 0.8, desc: "UnveilR discord invite" },
    ],
  },
  // === Flamecoder / FlameExecutor ===
  {
    id: "flamecoder",
    patterns: [
      { re: /FlameExecutorDumperV2\b/i, weight: 0.9, desc: "FlameExecutorDumperV2 banner" },
      { re: /__FLAMEDUMPER\b/i, weight: 0.9, desc: "__FLAMEDUMPER marker" },
      { re: /FlameExecutor\s*\(v3\)/i, weight: 0.9, desc: "FlameExecutor v3 banner" },
      { re: /Decompiled\s+with\s+FlameExecutor/i, weight: 0.85, desc: "FlameExecutor decompiled banner" },
      { re: /discord\.gg\/ypVcca6cvp/i, weight: 0.85, desc: "Flamecoder discord invite" },
    ],
  },
  // === Larry dumper ===
  // Globals: __LARRY_PREMIUM, __LARRY_ALLOW_HOST_HTTP_FETCH
  {
    id: "larry",
    patterns: [
      { re: /__LARRY_PREMIUM\b/, weight: 0.9, desc: "Larry __LARRY_PREMIUM global" },
      { re: /__LARRY_ALLOW_HOST_HTTP_FETCH\b/, weight: 0.9, desc: "Larry __LARRY_ALLOW_HOST_HTTP_FETCH global" },
      { re: /__LARRY_EMIT_LOADSTRING_FETCH_COMMENTS\b/, weight: 0.9, desc: "Larry emit loadstring global" },
      { re: /\bLuraphContinue\b/, weight: 0.7, desc: "Larry LuraphContinue shim" },
    ],
  },
  // === AstroProtect ===
  // Banner: "--[[ AstroProtect 2.1.0 ]]" + DMCA watermark comment.
  {
    id: "astrotect",
    patterns: [
      { re: /AstroProtect\s*v?\d+(?:\.\d+)*/i, weight: 0.95, desc: "AstroProtect version banner" },
      { re: /--\[\[\s*AstroProtect\s*\]\]/i, weight: 0.9, desc: "AstroProtect banner comment" },
    ],
  },
  // === Bacon Guard / FORGE Protection ===
  // Banner: "Bacon Guard v0.29.0 | FORGE Protection | Build <hex>".
  // Errors use the "BG:" prefix. VM-based (vmFamily/opcodeAdd/dispatchFormat).
  {
    id: "baconguard",
    patterns: [
      { re: /Bacon\s*Guard\s*v\d+(?:\.\d+)*/i, weight: 0.95, desc: "Bacon Guard version banner" },
      { re: /FORGE\s*Protection/i, weight: 0.9, desc: "FORGE Protection banner" },
      { re: /error\("BG:\d+"/i, weight: 0.8, desc: "BG: runtime error prefix" },
      { re: /_I\.vmFamily|_I\.dispatchFormat|_I\.opcodeInverse/i, weight: 0.75, desc: "BaconGuard VM config table" },
    ],
  },
  // === mcr4 development ===
  {
    id: "mcr4",
    patterns: [
      { re: /Obfuscated\s+by\s+mcr4\s+development/i, weight: 0.95, desc: "mcr4 development banner" },
      { re: /\bmcr4\s+development\b/i, weight: 0.85, desc: "mcr4 development token" },
    ],
  },
  // === luau-vmp ===
  {
    id: "luauvmp",
    patterns: [
      { re: /luau-?vmp/i, weight: 0.85, desc: "luau-vmp signature" },
      { re: /--\s*vmp-deobf/i, weight: 0.7, desc: "vmp-deobf comment" },
    ],
  },
  // === Q-Marker VM (custom obfuscator with Q-prefixed string table) ===
  // Detects obfuscators that use a string table where every entry starts
  // with a single marker character (commonly 'Q') and a 3-layer decoder
  // chain: DV(idx, key1) → QV(str, key2) → pV[decoded].
  // This pattern is used by several private Roblox obfuscators.
  {
    id: "qmarker_vm",
    patterns: [
      { re: /local\s+\w+\s*=\s*\{"Q[^"]*",\s*"Q[^"]*"/, weight: 0.8, desc: "Q-marker string table (entries start with Q)" },
      { re: /pV\s*\[\s*\w+V\s*\(\s*\w+V\s*\(/, weight: 0.85, desc: "3-layer decoder chain pV[XV(YV(...))]" },
      { re: /\bDV\s*\(\s*-?\d+\s*,\s*\d{10,}\s*\)/, weight: 0.85, desc: "DV(idx, bigKey) decoder pattern" },
    ],
  },
  // === Syscure (loader) ===
  {
    id: "syscure",
    patterns: [
      { re: /Syscure\b/i, weight: 0.8, desc: "Syscure loader banner" },
    ],
  },
  // === Keyforge.win (loader) ===
  {
    id: "keyforge",
    patterns: [
      { re: /Keyforge\.win/i, weight: 0.8, desc: "Keyforge.win loader URL" },
    ],
  },
];

// ---------------------------------------------------------------------------
// v4 detailed detection — weighted evidence, structural features, layers
// ---------------------------------------------------------------------------

export interface StructuralFeatures {
  /** VM dispatcher loop (`while true do if/elseif` chain on a state var) */
  vmDispatcher: boolean;
  /** large string table feeding a decoder (string-table VM) */
  stringTableVm: boolean;
  /** control-flow flattening markers */
  controlFlowFlattening: boolean;
  /** hex/dec escape-encoded constants dominating the file */
  encodedConstants: boolean;
  /** custom decoder function defined in-file (xor/base64/custom alphabet) */
  customDecoder: boolean;
  /** encrypted string pool (large single blob, low printable ratio) */
  encryptedStringPool: boolean;
  /** loader wrapper: loadstring(game:HttpGet(...)) */
  loaderWrapper: boolean;
  /** environment / anti-analysis checks */
  envChecks: boolean;
  /** nested obfuscation: an inner layer visible inside a decoded payload */
  nestedLayers: number;
}

export interface DetailedDetection {
  /** best matching obfuscator id (same as detectObfuscator().obfuscator) */
  obfuscator: ObfuscatorId;
  confidence: number;
  /** every matched rule with its weight + evidence text */
  evidence: Array<{ id: string; weight: number; desc: string; matched: string }>;
  /** structural features detected in the file */
  features: StructuralFeatures;
  /** ranked list of possible secondary obfuscator families (outer layers) */
  secondary: Array<{ id: string; confidence: number }>;
  /** total number of rule hits (detection breadth signal) */
  totalHits: number;
}

/** Structural feature scan — bounded sampling for large inputs. */
export function scanStructuralFeatures(input: string): StructuralFeatures {
  const sample = input.length > 2_000_000 ? input.slice(0, 2_000_000) : input;
  const feats: StructuralFeatures = {
    vmDispatcher: false,
    stringTableVm: false,
    controlFlowFlattening: false,
    encodedConstants: false,
    customDecoder: false,
    encryptedStringPool: false,
    loaderWrapper: false,
    envChecks: false,
    nestedLayers: 0,
  };

  // VM dispatcher: `while true do` / `while 1 == 1 do` followed (within a
  // window) by an if/elseif chain — the classic IronBrew/Luraph/MoonSec shape.
  const dispatchRe = /while\s+(?:true|1\s*==\s*1|not\s+false)\s+do[\s\S]{0,400}?\bif\b[\s\S]{0,2000}?\belseif\b/;
  feats.vmDispatcher = dispatchRe.test(sample);

  // String-table VM: a big string literal (≥1KB) + heavy t[N] indexing
  const bigStr = /"[^"\n]{1000,}"|\[=*\[[\s\S]{1000,}?\]=*\]/.test(sample);
  const heavyIndex = (sample.match(/\b\w\s*\[\s*\d+\s*\]/g) || []).length;
  feats.stringTableVm = bigStr && heavyIndex > 40;

  // Control-flow flattening: repeated `state`/`vN == CONST` dispatch tests
  const dispatchTests = (sample.match(/\b\w+\s*==\s*\d+\s*then/g) || []).length;
  feats.controlFlowFlattening = dispatchTests >= 8;

  // Encoded constants: \xNN / \dNN escapes dominate
  const escCount = (sample.match(/\\x[0-9a-fA-F]{2}|\\\d{1,3}/g) || []).length;
  feats.encodedConstants = escCount > 200;

  // Custom decoder: bxor+byte+sub inside one function body region
  feats.customDecoder = /bxor[\s\S]{0,600}?string\.byte|["']bxor["'][\s\S]{0,400}?["']byte["']/.test(sample);

  // Encrypted string pool: a very long literal whose decoded form is unlikely
  // printable (high-byte junk) — approximate by non-ASCII ratio of the blob.
  const pool = sample.match(/"([\s\S]{4000,}?)"/);
  if (pool) {
    let high = 0;
    const v = pool[1];
    for (let i = 0; i < v.length; i += 7) {
      const c = v.charCodeAt(i);
      if (c > 126 || (c < 32 && c !== 10)) high++;
    }
    feats.encryptedStringPool = high / Math.max(1, Math.ceil(v.length / 7)) > 0.25;
  }

  // Loader wrapper
  feats.loaderWrapper = /loadstring\s*\(?[^)\n]{0,80}(HttpGet|GetAsync|request|http)/.test(sample);

  // Environment / anti-analysis checks
  feats.envChecks =
    /identifyexecutor|is_synapse|isexecutor|getgenv\s*\(\s*\)/.test(sample) ||
    /checkcaller|hookfunction|getcallingscript/.test(sample) ||
    (sample.match(/debug\.getinfo/g) || []).length >= 3;

  // Nested layers: obfuscator banners stacked inside the same file
  feats.nestedLayers = 0;
  for (const name of ["Luraph", "IronBrew", "MoonSec", "MoonVeil", "Prometheus", "WeAreDevs"]) {
    const n = (sample.match(new RegExp(name, "gi")) || []).length;
    if (n >= 1) feats.nestedLayers++;
  }
  if (feats.nestedLayers <= 1) feats.nestedLayers = 0; // single banner is not nesting

  return feats;
}

/**
 * v4 weighted-evidence detection. Combines:
 *   - banner/pattern rules (the RULES table — same as v3.6)
 *   - structural features (VM dispatcher, CFF, encoded constants, ...)
 *   - generic obfuscation signals (escapes, obf identifiers, long strings)
 * into a ranked result. The primary match is *never* lowered below the pure
 * banner confidence (structural evidence only boosts generic), so a precise
 * banner can't be beaten by heuristics — but unknown VM packers now get a
 * much better family guess than "generic 0.1".
 */
export function detectObfuscatorsDetailed(input: string): DetailedDetection {
  // -- rule matching with full evidence list (decoy-aware, v4.1) --
  // Banner matches inside decoy strings (`#'...'` length-op operands that
  // obfuscators stuff with fake banners of OTHER obfuscators) count at 45%.
  const decoys = findDecoyStringRanges(input);
  const evidence: DetailedDetection["evidence"] = [];
  const scores = new Map<string, { score: number; evidence: string; decoyOnly?: boolean }>();

  for (const rule of RULES) {
    let best = 0;
    let bestEvidence = "";
    let bestDecoy = false;
    for (const p of rule.patterns) {
      let m: RegExpExecArray | null;
      let inDecoy = false;
      try {
        const r = firstMatchPreferOutsideDecoys(p.re, input, decoys);
        m = r.m;
        inDecoy = r.inDecoy;
      } catch {
        continue;
      }
      if (m) {
        const w = p.weight * (inDecoy ? 0.45 : 1);
        if (w > best) {
          best = w;
          bestEvidence = `${p.desc}${inDecoy ? " [decoy-string, downweighted]" : ""} (matched: ${m[0].slice(0, 60)})`;
          bestDecoy = inDecoy;
        }
        evidence.push({ id: rule.id, weight: w, desc: `${p.desc}${inDecoy ? " (decoy)" : ""}`, matched: m[0].slice(0, 60) });
      }
    }
    if (best > 0) {
      const prev = scores.get(rule.id);
      if (!prev || best > prev.score) scores.set(rule.id, { score: best, evidence: bestEvidence, decoyOnly: bestDecoy });
    }
  }
  const features = scanStructuralFeatures(input);

  // -- generic signals --
  const genericSignals: string[] = [];
  let genericScore = 0;
  const escapeCount = (input.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
  if (escapeCount > 50) {
    genericScore = Math.max(genericScore, 0.4);
    genericSignals.push(`${escapeCount} hex-escape sequences`);
  }
  const longStr = (input.match(/"[^"]{500,}"|\[\[[^\]]{500,}\]\]/) || [])[0];
  if (longStr) {
    genericScore = Math.max(genericScore, 0.45);
    genericSignals.push("very long string literal (likely encoded payload)");
  }
  const obfIds = (input.match(/\b[Il1O0_]{4,}\b/g) || []).length;
  if (obfIds > 20) {
    genericScore = Math.max(genericScore, 0.35);
    genericSignals.push(`${obfIds} obfuscated identifiers (Il1/O0)`);
  }
  // structural boost for the generic score
  if (features.vmDispatcher) {
    genericScore = Math.max(genericScore, 0.55);
    genericSignals.push("VM dispatcher loop (while true + if/elseif chain)");
  }
  if (features.stringTableVm) {
    genericScore = Math.max(genericScore, 0.5);
    genericSignals.push("string-table VM (big literal + heavy t[N] indexing)");
  }
  if (features.controlFlowFlattening) {
    genericScore = Math.max(genericScore, 0.5);
    genericSignals.push("control-flow flattening (state == const dispatch)");
  }
  if (features.encodedConstants) genericSignals.push("escape-encoded constants dominate");
  if (features.customDecoder) genericSignals.push("custom decoder function (xor/byte/sub)");
  if (features.loaderWrapper) genericSignals.push("loadstring(loader) wrapper");
  if (features.envChecks) genericSignals.push("environment / anti-analysis checks");
  if (genericScore > 0) {
    const prev = scores.get("generic");
    if (!prev || genericScore > prev.score) {
      scores.set("generic", {
        score: genericScore,
        evidence: genericSignals.join(", "),
      });
    }
  }

  // -- pick primary --
  // v4.1: decoy-only rule hits below 0.5 are not eligible as the primary
  // family — a fake banner inside `#'...'` must not claim the file.
  const eligiblePrimary = (s: { score: number; decoyOnly?: boolean }) =>
    !(s.decoyOnly && s.score < 0.5);
  let bestId: string = "generic";
  let bestScore = 0.1;
  let bestEvidence = "no specific obfuscator matched — falling back to generic";
  for (const [id, s] of scores) {
    if (!eligiblePrimary(s)) continue;
    if (s.score > bestScore) {
      bestId = id;
      bestScore = s.score;
      bestEvidence = s.evidence;
    }
  }
  // de-prioritise generic when a real family matched
  if (bestId === "generic") {
    for (const [id, s] of scores) {
      if (id !== "generic" && eligiblePrimary(s) && s.score >= 0.4) {
        bestId = id;
        bestScore = s.score;
        bestEvidence = s.evidence;
        break;
      }
    }
  }

  // -- secondary families (everything else with a decent hit) --
  const secondary: Array<{ id: string; confidence: number }> = [];
  for (const [id, { score }] of scores) {
    if (id === bestId || id === "generic") continue;
    if (score >= 0.5) secondary.push({ id, confidence: score });
  }
  secondary.sort((a, b) => b.confidence - a.confidence);

  return {
    obfuscator: bestId as ObfuscatorId,
    confidence: bestScore,
    evidence: evidence.sort((a, b) => b.weight - a.weight).slice(0, 30),
    features,
    secondary: secondary.slice(0, 5),
    totalHits: evidence.length,
  };
}

/** Backwards-compatible single-match API (v3.6 behaviour + v4 evidence). */
export function detectObfuscator(input: string): DetectionMatch {
  const decoys = findDecoyStringRanges(input);
  const scores = new Map<string, { score: number; evidence: string; decoyOnly?: boolean }>();

  for (const rule of RULES) {
    let best = 0;
    let bestEvidence = "";
    let bestDecoy = false;
    for (const p of rule.patterns) {
      let m: RegExpExecArray | null;
      let inDecoy = false;
      try {
        const r = firstMatchPreferOutsideDecoys(p.re, input, decoys);
        m = r.m;
        inDecoy = r.inDecoy;
      } catch {
        continue;
      }
      if (m) {
        const w = p.weight * (inDecoy ? 0.45 : 1);
        if (w > best) {
          best = w;
          bestEvidence = `${p.desc}${inDecoy ? " [decoy-string, downweighted]" : ""} (matched: ${m[0].slice(0, 60)})`;
          bestDecoy = inDecoy;
        }
      }
    }
    if (best > 0) {
      scores.set(rule.id, { score: best, evidence: bestEvidence, decoyOnly: bestDecoy });
    }
  }

  // generic structural fallback (v4: also considers VM dispatcher / CFF)
  const genericSignals: string[] = [];
  let genericScore = 0;
  const escapeCount = (input.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
  if (escapeCount > 50) {
    genericScore = Math.max(genericScore, 0.4);
    genericSignals.push(`${escapeCount} hex-escape sequences`);
  }
  const longStr = (input.match(/"[^"]{500,}"|\[\[[^\]]{500,}\]\]/) || [])[0];
  if (longStr) {
    genericScore = Math.max(genericScore, 0.45);
    genericSignals.push("very long string literal (likely encoded payload)");
  }
  const obfIds = (input.match(/\b[Il1O0_]{4,}\b/g) || []).length;
  if (obfIds > 20) {
    genericScore = Math.max(genericScore, 0.35);
    genericSignals.push(`${obfIds} obfuscated identifiers (Il1/O0)`);
  }
  if (input.length < 2_000_000) {
    if (/while\s+(?:true|1\s*==\s*1)\s+do[\s\S]{0,400}?\bif\b[\s\S]{0,2000}?\belseif\b/.test(input)) {
      genericScore = Math.max(genericScore, 0.55);
      genericSignals.push("VM dispatcher loop");
    }
  }
  if (genericScore > 0) {
    const prev = scores.get("generic");
    if (!prev || genericScore > prev.score) {
      scores.set("generic", { score: genericScore, evidence: genericSignals.join(", ") });
    }
  }

  let best: DetectionMatch | null = null;
  for (const [id, s] of scores) {
    // v4.1: decoy-only hits below 0.5 never claim the primary family.
    if (s.decoyOnly && s.score < 0.5) continue;
    if (!best || s.score > best.confidence) {
      best = { obfuscator: id as ObfuscatorId, confidence: s.score, evidence: s.evidence };
    }
  }
  if (best) return best;
  return {
    obfuscator: "generic",
    confidence: 0.1,
    evidence: "no specific obfuscator matched — falling back to generic",
  };
}

/**
 * Map any detected obfuscator id to a "family" for the orchestrator.
 * This lets us reuse deobfuscators across forks of the same parent.
 */
export type ObfuscatorFamily =
  | "luraph"
  | "moonveil"
  | "moonsec"
  | "ironbrew"
  | "wearedevs"
  | "prometheus"
  | "qmarker_vm"
  | "astrotect"
  | "luaxor"
  | "tagtable_vm"
  | "modern_vm"
  | "hercules"
  | "ironveil"
  | "luaobfuscator_com"
  | "generic";

export function familyOf(id: string): ObfuscatorFamily {
  switch (id) {
    case "luraph":
    case "luraph_all":
      return "luraph";
    case "moonveil":
      return "moonveil";
    case "moonsec":
    case "moonsec_all":
      return "moonsec";
    case "ironbrew":
    case "ironbrew1":
    case "ironboobs":
    case "ib2_fork":
    case "fuscator77": // 77fuscator is an IronBrew2 fork
    case "67fuscator":
      return "ironbrew";
    // Ironveil V1 is its own from-scratch salted/permuted bytecode VM, NOT
    // the IronBrew2 layout — the IB2 engine cannot parse it. It has a
    // dedicated static deobfuscator (see deobfuscators/ironveil.ts).
    case "ironveil":
      return "ironveil";
    // IronBrew3 is a from-scratch VM, NOT the IronBrew2 layout — the IB2
    // engine cannot parse it, so it falls through to the generic pipeline.
    case "ironbrew3":
    case "synapsexen": // XOR-at-runtime strings; handled by generic + multipass
    case "lps": // base85/state-machine VM; handled by generic + multipass
    case "psu": // string-table + arithmetic; handled by generic + multipass
    case "boronide":
    case "wynfuscator":
      return "generic";
    case "hercules":
      return "hercules" as ObfuscatorFamily;
    case "wearedevs":
    case "wearedevs_new":
      return "wearedevs";
    case "prometheus":
    case "prometheusv2":
    case "promfork_25ms":
    case "promfork_45ms":
    case "promia":
      return "prometheus";
    case "clyde":
    case "clyde_protection":
    case "zzzobfuscator":
      return "modern_vm" as ObfuscatorFamily;
    case "qmarker_vm":
      return "qmarker_vm";
    case "astrotect":
      return "astrotect";
    case "luaobfuscator_com":
      return "luaobfuscator_com";
    case "tagtable_vm":
      return "tagtable_vm";
    default:
      // For everything else, the generic deobfuscator handles it.
      return "generic";
  }
}

export const ALL_OBFUSCATOR_IDS = ALL_IDS;
