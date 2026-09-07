// Luraph v14.8 VM Analyzer v2 — Trace-Based Source Reconstruction
// ─────────────────────────────────────────────────────────────────────────────
// Luraph v14.8 "VM mode": toàn bộ script là 1 table các hàm `return({...}):M(...)`.
// Payload bytecode nằm trong 1 string literal khổng lồ (custom-encoded), được
// giải mã qua chuỗi k → n → z rồi chạy bởi dispatcher tự build.
//
// Engine v2 chạy script trong sandbox Lua (wasmoon — Lua 5.4 WASM) với môi trường
// PROXY ghi lại mọi thao tác (trace), trên 6 kịch bản:
//   happy / genvnil / getinfofail / getinfonontable / httpfail / httpgetnil
// rồi SYNTHESIZE code Lua sạch từ trace + diff kịch bản:
//   - output = code deobfuscated (KHÔNG banner / listing metadata)
//   - artifacts = proto dump + string constants + traces (nếu cần tra cứu)
//
// Safety: script gốc KHÔNG bao giờ chạy thật — mọi global (game, loadstring,
// getgenv, debug, task…) đều là proxy; task.wait bị bound (chống loop vô hạn);
// CPU bound qua debug.sethook count (nếu có).

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult, DetectionMatch } from "../types";

/** Signature của Luraph v14.8 VM loader. */
const VM_TABLE_RE = /return\s*\(\s*\{\s*[\s\S]*\}\s*\)\s*:\s*M\s*\(/;

const SHIMS = `
  bit32 = {
    bxor = function(a, b) return a ~ b end,
    band = function(a, b) return a & b end,
    bor  = function(a, b) return a | b end,
    bnot = function(a) return ~a end,
    rshift = function(a, b) return a >> b end,
    lshift = function(a, b) return a << b end,
    arshift = function(a, b) return a >> b end,
    btest = function(a, b) return (a & b) ~= 0 end,
  }
  function getfenv(f) return _G end
  function setfenv(f, t) return f end
  unpack = table.unpack
  table.create = function(n, v)
    local t = {}
    if v ~= nil then for i = 1, n do t[i] = v end end
    return t
  end
`;

type ScenarioId = "happy" | "genvnil" | "getinfofail" | "getinfonontable" | "httpfail" | "httpgetnil";

interface TraceEvent {
  kind: "CALL" | "RET" | "GET" | "SET";
  text: string;
}

export class LuraphVMDeobfuscator implements Deobfuscator {
  id = "luraph" as const;
  name = "Luraph v14.8 VM Analyzer";
  description = "Chạy Luraph v14.8 VM trong sandbox proxy, trace execution → tái tạo code gốc sạch";

  detect(input: string): DetectionMatch | null {
    if (!VM_TABLE_RE.test(input)) return null;
    const isLuraph = /Luraph\s+Obfuscator\s+v?14\.8/i.test(input) || /lura\.ph/.test(input);
    if (!isLuraph) return null;
    return {
      obfuscator: "luraph",
      confidence: 0.9,
      evidence: "Luraph v14.8 VM table structure return({...}):M(...) detected",
    };
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const notes: string[] = [];
    const artifacts: string[] = [];

    // 0) wasmoon optional
    let factory: unknown = null;
    try {
      const mod = (await import("wasmoon")) as { LuaFactory: new () => any };
      factory = new mod.LuaFactory();
    } catch {
      return {
        success: false,
        deobfuscator: this.name,
        output: ctx.input,
        confidence: 0,
        obfuscator: "luraph",
        notes: ["wasmoon không khả dụng — cài `bun add wasmoon` để bật VM analyzer."],
      };
    }

    const { tableSrc, blob } = extractVMParts(ctx.input);
    if (!tableSrc || !blob) {
      return {
        success: false,
        deobfuscator: this.name,
        output: ctx.input,
        confidence: 0,
        obfuscator: "luraph",
        notes: ["Không trích được VM table / payload blob."],
      };
    }
    notes.push(`Trích xuất payload ${blob.length} chars + VM table ${tableSrc.length} chars.`);

    try {
      // ═══ Phase 1: proto dump (engine #1) — cho artifacts ═══
      const dump = await dumpProto(factory, tableSrc, blob);
      if (!dump) {
        return {
          success: false,
          deobfuscator: this.name,
          output: ctx.input,
          confidence: 0.1,
          obfuscator: "luraph",
          notes: ["Dump proto rỗng — cấu trúc VM khác dự kiến."],
        };
      }
      const strings = [...dump.matchAll(/str = "((?:\\.|[^"\\])*)"/g)].map((m) =>
        m[1].replace(/\\x([0-9a-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      );
      const urls = strings.filter((s) => /^https?:\/\//.test(s));
      notes.push(
        `Proto: ~${(dump.match(/TABLE\(#\d+\)/g) || []).length} node · ${strings.length} string constants decrypted.`
      );
      if (urls.length > 0) notes.push(`⚠️ LOADER URL phát hiện: ${urls.join(", ")}`);

      // ═══ Phase 2: traced execution — 6 kịch bản ═══
      const traces: Record<string, TraceEvent[]> = {};
      for (const sc of ["happy", "genvnil", "getinfofail", "getinfonontable", "httpfail", "httpgetnil"] as ScenarioId[]) {
        try {
          traces[sc] = await runTracedScenario(factory, tableSrc, blob, sc);
        } catch {
          traces[sc] = [];
        }
      }
      const happy = traces.happy ?? [];
      notes.push(
        `Trace ${Object.keys(traces).length} kịch bản · happy path ${happy.length} events${happy.length ? "" : " (degenerate)"}.`
      );

      // ═══ Phase 3: synthesize code sạch ═══
      const synth = synthesizeLoader(happy, {
        genvnil: traces.genvnil ?? [],
        getinfofail: traces.getinfofail ?? [],
        getinfonontable: traces.getinfonontable ?? [],
        httpfail: traces.httpfail ?? [],
        httpgetnil: traces.httpgetnil ?? [],
      });

      let output: string;
      if (synth.lines.length >= 3) {
        const header = [
          `-- ${ctx.baseName} — Luraph v14.8 · deobfuscated`,
          `-- Reconstruction từ VM execution trace (${happy.length} events, 6 kịch bản happy/failure)`,
        ].join("\n");
        output = `${header}\n\n${synth.lines.join("\n")}\n`;
        for (const n of synth.notes) notes.push(n);
      } else {
        // Fallback: không reconstruct được → output tối giản (dump vào artifacts)
        output = `-- ${ctx.baseName} — Luraph v14.8 VM\n-- Không reconstruct được code từ trace; xem artifacts để tra cứu proto/constants.\n\n--[[ PROTO DUMP ]]--\n--[[\n${dump.slice(0, 40000)}\n]]\n`;
      }

      artifacts.push(
        `-- PROTO DUMP (Luraph v14.8 VM — ${ctx.baseName})\n${dump}\n\n-- URLS: ${urls.join(", ")}\n-- STRINGS (${new Set(strings).size}): ${[...new Set(strings)].map((s) => JSON.stringify(s.slice(0, 80))).join(", ")}`
      );
      for (const [sc, evs] of Object.entries(traces)) {
        if (evs.length === 0) continue;
        artifacts.push(
          `-- TRACE ${sc} (${evs.length} events)\n${evs
            .map((e) => `-- ${e.kind} ${e.text}`)
            .join("\n")}`
        );
      }

      return {
        success: true,
        deobfuscator: this.name,
        output,
        confidence: urls.length > 0 ? 0.93 : 0.8,
        obfuscator: "luraph",
        notes,
        artifacts,
      };
    } catch (e: unknown) {
      return {
        success: false,
        deobfuscator: this.name,
        output: ctx.input,
        confidence: 0,
        obfuscator: "luraph",
        notes: [`VM sandbox lỗi: ${e instanceof Error ? e.message : String(e)}`],
      };
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 1: proto dump
// ═════════════════════════════════════════════════════════════════════════════

async function dumpProto(factory: unknown, tableSrc: string, blob: string): Promise<string> {
  const lua = await (factory as any).createEngine();
  await lua.doString(SHIMS);
  await lua.global.set("_TABLE_SRC", tableSrc);
  await lua.global.set("_BLOB", blob);
  await lua.doString(`_VM = (function()\nlocal T = ${tableSrc}\nreturn T\nend)()`);
  await lua.doString(`local T = _VM\nT.k = T:k(); T.n = T:n(); T.z = T:z(); T.g = T:g()`);
  await lua.doString(`
    _FN = _VM.z(_VM.n(_VM.k(_BLOB)))
    local out = {}
    local seen = {}
    local BS = string.char(92)
    local function esc(s)
      local r = {}
      for i = 1, #s do
        local b = string.byte(s, i)
        if b == 92 then r[i] = BS .. "x5c"
        elseif b < 32 or b > 126 then r[i] = BS .. string.format("x%02x", b)
        else r[i] = s:sub(i, i) end
      end
      return table.concat(r)
    end
    local function dump(v, name, depth)
      if depth > 8 then return end
      if seen[v] and type(v) == "table" then
        table.insert(out, string.rep(" ", depth) .. name .. " = <cycle>")
        return
      end
      local t = type(v)
      if t == "table" then
        seen[v] = true
        local n = 0
        for _ in pairs(v) do n = n + 1 end
        table.insert(out, string.rep(" ", depth) .. name .. " TABLE(#" .. n .. ")")
        local cnt = 0
        for k, vv in pairs(v) do
          cnt = cnt + 1
          if cnt <= 100 then dump(vv, name .. "[" .. tostring(k) .. "]", depth + 1) end
        end
      elseif t == "string" then
        local disp = #v > 200 and (esc(v:sub(1, 200)) .. "...+" .. #v) or esc(v)
        table.insert(out, string.rep(" ", depth) .. name .. ' str = "' .. disp .. '"')
      elseif t == "function" then
        local i = 1
        while true do
          local ok, uname, uval = pcall(debug.getupvalue, v, i)
          if not ok or uname == nil then break end
          dump(uval, name .. "<up:" .. uname .. ">", depth + 1)
          i = i + 1
          if i > 10 then break end
        end
      else
        table.insert(out, string.rep(" ", depth) .. name .. " " .. t .. " = " .. tostring(v))
      end
    end
    local okj, jname, j = pcall(debug.getupvalue, _FN, 1)
    if okj and type(j) == "table" and type(j[4]) == "table" and type(j[4][3]) == "function" then
      local oke, ename, E = pcall(debug.getupvalue, j[4][3], 2)
      if oke and type(E) == "table" and type(E[10]) == "table" and type(E[10][3]) == "table" then
        dump(E[10][3], "PROTO", 0)
      else
        table.insert(out, "(dispatcher E table không có proto ở E[10][3])")
      end
    else
      table.insert(out, "(cấu trúc j[4][3] dispatcher không match)")
    end
    _PROTO_DUMP = table.concat(out, "\\n")
  `);
  return String(lua.global.get("_PROTO_DUMP") ?? "");
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 2: traced execution — chạy script dưới proxy env, ghi event trace
// ═════════════════════════════════════════════════════════════════════════════

async function runTracedScenario(
  factory: unknown,
  tableSrc: string,
  blob: string,
  scenario: ScenarioId
): Promise<TraceEvent[]> {
  const lua = await (factory as any).createEngine();
  await lua.doString(SHIMS);
  await lua.doString(`_SCENARIO = "${scenario}"`);
  await lua.global.set("_TABLE_SRC", tableSrc);
  await lua.global.set("_BLOB", blob);
  await lua.doString(`_VM = (function()\nlocal T = ${tableSrc}\nreturn T\nend)()`);
  await lua.doString(`local T = _VM\nT.k = T:k(); T.n = T:n(); T.z = T:z(); T.g = T:g()`);
  await lua.doString(`local blob = _BLOB\n_FN = _VM.z(_VM.n(_VM.k(blob)))`);

  await lua.doString(`
    _TRACE = {}
    local function tr(kind, detail)
      if #_TRACE < 300 then table.insert(_TRACE, kind .. "\\t" .. detail) end
    end
    local _type = type
    local _tostring = tostring
    local _pairs = pairs
    _RAWPCALL = pcall
    _REALDEBUG = debug
    local function fa(a)
      local t = _type(a)
      if t == "string" then
        return string.format("%q", a:sub(1, 100)) .. (#a > 100 and ("--[[+" .. (#a - 100) .. " bytes]]") or "")
      end
      if t == "table" or t == "function" then return "<" .. t .. ">"
      elseif t == "nil" then return "nil" end
      return _tostring(a)
    end
    local function tk(t)
      if _type(t) ~= "table" then return _tostring(t) end
      local keys, n = {}, 0
      for k in _pairs(t) do
        n = n + 1
        if #keys < 30 then keys[#keys + 1] = _tostring(k) end
      end
      return "keys=[" .. table.concat(keys, ", ") .. "]"
    end

    pairs = function(t)
      tr("CALL", "pairs(" .. tk(t) .. ")")
      return _pairs(t)
    end

    local _pcall = pcall
    pcall = function(f, ...)
      local args = {}
      for i = 1, select("#", ...) do args[#args + 1] = fa(select(i, ...)) end
      tr("CALL", "pcall(" .. table.concat(args, ", ") .. ")")
      local res = table.pack(_pcall(f, ...))
      tr("RET", "pcall ok=" .. _tostring(res[1]) .. (res[2] ~= nil and (" err=" .. fa(res[2])) or ""))
      return table.unpack(res, 1, res.n)
    end

    local waits = 0
    game = setmetatable({}, {
      __index = function(t, k)
        tr("GET", "game." .. _tostring(k))
        if k == "HttpGet" then
          if _SCENARIO == "httpgetnil" then return nil end
          return function(self, url, ...)
            local args = { fa(url) }
            for i = 1, select("#", ...) do args[#args + 1] = fa(select(i, ...)) end
            tr("CALL", "game:HttpGet(" .. table.concat(args, ", ") .. ")")
            if _SCENARIO == "httpfail" then error("HttpError: HTTP 404") end
            return "--[[SOURCE]]"
          end
        end
        return function(self, ...)
          local args = {}
          for i = 1, select("#", ...) do args[#args + 1] = fa(select(i, ...)) end
          tr("CALL", "game:" .. _tostring(k) .. "(" .. table.concat(args, ", ") .. ")")
          return nil
        end
      end,
    })

    loadstring = function(src, name)
      tr("CALL", "loadstring(" .. fa(src) .. (name ~= nil and (", " .. fa(name)) or "") .. ")")
      return function(...)
        local args = {}
        for i = 1, select("#", ...) do args[#args + 1] = fa(select(i, ...)) end
        tr("CALL", "loadstring_result(" .. table.concat(args, ", ") .. ")")
        return nil
      end
    end

    task = setmetatable({}, {
      __index = function(t, k)
        return function(self, ...)
          local args = {}
          for i = 1, select("#", ...) do args[#args + 1] = fa(select(i, ...)) end
          tr("CALL", "task." .. _tostring(k) .. "(" .. table.concat(args, ", ") .. ")")
          if k == "wait" or k == "spawn" or k == "delay" then
            waits = waits + 1
            if waits > 60 then error("__LOOP_BOUND__") end
          end
          return 0
        end
      end,
    })

    debug = setmetatable({}, {
      __index = function(t, k)
        if k == "getinfo" then
          return function(...)
            local args = {}
            for i = 1, select("#", ...) do args[#args + 1] = fa(select(i, ...)) end
            tr("CALL", "debug.getinfo(" .. table.concat(args, ", ") .. ")")
            if _SCENARIO == "getinfofail" then error("debug library disabled") end
            if _SCENARIO == "getinfonontable" then return nil end
            return {
              what = "main", source = "@src", short_src = "src",
              currentline = 1, linedefined = 0, lastlinedefined = 0,
              nups = 0, nparams = 0, isvararg = true, func = function() end,
            }
          end
        end
        return function(...)
          tr("CALL", "debug." .. _tostring(k) .. "()")
          return nil
        end
      end,
    })

    _GENV = setmetatable({}, {
      __index = function(t, k)
        tr("GET", "genv." .. _tostring(k))
        return nil
      end,
      __newindex = function(t, k, v)
        tr("SET", "genv." .. _tostring(k) .. " = " .. fa(v))
        rawset(t, k, v)
      end,
    })
    getgenv = function()
      tr("CALL", "getgenv()")
      if _SCENARIO == "genvnil" then return nil end
      return _GENV
    end

    getfenv = function(...)
      tr("CALL", "getfenv()")
      return _G
    end

    print = function(...)
      local args = {}
      for i = 1, select("#", ...) do args[#args + 1] = fa(select(i, ...)) end
      tr("CALL", "print(" .. table.concat(args, ", ") .. ")")
    end
    local _error = error
    error = function(msg, lvl)
      tr("CALL", "error(" .. fa(msg) .. ")")
      _error(msg, lvl)
    end
  `);

  // CPU-bound guard: count hook 30M instructions (nếu wasmoon hỗ trợ)
  await lua.doString(`
    _RAWPCALL(function()
      _REALDEBUG.sethook(function() error("__INSTR_BOUND__") end, "", 30000000)
    end)
    local ok, err = _RAWPCALL(_FN)
    _RUN_OK = ok
    _RUN_ERR = err
    _RAWPCALL(function() _REALDEBUG.sethook() end)
  `);

  const raw: string[] = lua.global.get("_TRACE") ?? [];
  return raw
    .filter((l) => typeof l === "string" && l.includes("\t"))
    .map((l) => {
      const [kind, ...rest] = l.split("\t");
      return { kind: kind as TraceEvent["kind"], text: rest.join("\t") };
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 3: synthesis — trace + scenario diff → code Lua sạch
// ═════════════════════════════════════════════════════════════════════════════

interface SynthResult {
  lines: string[];
  notes: string[];
}

function luaQuote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 32 || c === 127) out += "\\" + String(c).padStart(3, "0");
    else out += ch;
  }
  return out + '"';
}

/** Chuẩn hoá text event khi so sánh: sort keys của pairs() (thứ tự iteration không deterministic). */
function normEvText(t: string): string {
  const m = /^pairs\(keys=\[(.*)\]\)$/.exec(t);
  if (m) {
    const keys = m[1].split(", ").filter(Boolean).sort().join(", ");
    return `pairs(keys=[${keys}])`;
  }
  return t;
}

/** Tìm index event đầu tiên mà 2 trace khác nhau (theo text đã chuẩn hoá). */
function firstDivergence(a: TraceEvent[], b: TraceEvent[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (!a[i] || !b[i] || a[i].kind !== b[i].kind || normEvText(a[i].text) !== normEvText(b[i].text)) return i;
  }
  return -1;
}

/** Phát hiện wait-storm: ≥6 event task.wait liên tiếp (cho phép ≤3 event error/RET trước storm) → infinite loop. */
function isWaitStormTail(trace: TraceEvent[], from: number): boolean {
  let cnt = 0;
  let skipped = 0;
  for (let i = from; i < trace.length && i < from + 12; i++) {
    if (trace[i].kind === "CALL" && /^task\.wait\(/.test(trace[i].text)) cnt++;
    else {
      if (cnt > 0) break;
      skipped++;
      if (skipped > 3) return false;
    }
  }
  return cnt >= 6;
}

function synthesizeLoader(
  happy: TraceEvent[],
  fails: Record<string, TraceEvent[]>
): SynthResult {
  const lines: string[] = [];
  const notes: string[] = [];
  if (happy.length < 3) return { lines, notes };
  if (process.env.DEBUG_SYNTH) {
    console.error(`happy=${happy.length} events · divGenv=${firstDivergence(happy, fails.genvnil ?? [])} divGetinfoFail=${firstDivergence(happy, fails.getinfofail ?? [])} divGetinfoNonTable=${firstDivergence(happy, fails.getinfonontable ?? [])} divHttpFail=${firstDivergence(happy, fails.httpfail ?? [])}`);
    happy.forEach((e, i) => console.error(`  ${i} ${e.kind} ${JSON.stringify(e.text).slice(0, 110)}`));
  }

  // Trace chỉ chứa script events (harness dùng raw pcall, không qua hook)
  const evs = happy;

  // Guard conditions theo scenario (engine biết ý nghĩa từng scenario)
  const divGenv = firstDivergence(happy, fails.genvnil ?? []);
  const divGetinfoFail = firstDivergence(happy, fails.getinfofail ?? []);
  const divGetinfoNonTable = firstDivergence(happy, fails.getinfonontable ?? []);
  const divHttpFail = firstDivergence(happy, fails.httpfail ?? []);

  // Đặt tên biến per-base: ok, ok2, info, info2…
  const varCounts = new Map<string, number>();
  const nextVar = (base: string): string => {
    const n = (varCounts.get(base) ?? 0) + 1;
    varCounts.set(base, n);
    return n === 1 ? base : `${base}${n}`;
  };

  /** Tìm RET khớp với pcall CALL tại index i (nesting). */
  const findPcallEnd = (list: TraceEvent[], i: number): number => {
    let depth = 0;
    for (let j = i; j < list.length; j++) {
      if (list[j].kind === "CALL" && list[j].text.startsWith("pcall(")) depth++;
      else if (list[j].kind === "RET" && list[j].text.startsWith("pcall ok=")) {
        depth--;
        if (depth === 0) return j;
      }
    }
    return -1;
  };

  /** Emit khối pcall bọc tải nguồn (side-effect gán src) + loadstring sau pcall. */
  const emitDownloadPcall = (body: TraceEvent[], pcallEnd: number): number => {
    const httpEv = body.find((e) => e.kind === "CALL" && e.text.startsWith("game:HttpGet("));
    if (!httpEv) return -1;
    const m = /^game:\s*HttpGet\((.*)\)$/.exec(httpEv.text);
    if (!m) return -1;
    const urlArg = m[1];
    const okVar = nextVar("ok");
    const srcVar = nextVar("src");

    lines.push(`-- tải nguồn — lỗi mạng bị nuốt im lặng (pcall)`);
    lines.push(`local ${srcVar}`);
    lines.push(`local ${okVar} = pcall(function()`);
    lines.push(`    ${srcVar} = game:HttpGet(${urlArg})`);
    lines.push(`end)`);

    // loadstring(+result) theo SAU pcall → guard theo kết quả tải
    let consumed = pcallEnd + 1;
    const lsEv = evs[pcallEnd + 1];
    const lsrEv = evs[pcallEnd + 2];
    if (lsEv && lsEv.kind === "CALL" && lsEv.text.startsWith("loadstring(")) {
      const hasResult = lsrEv && lsrEv.kind === "CALL" && lsrEv.text.startsWith("loadstring_result(");
      const guardParts = [okVar];
      if (/^loadstring\(".*"\)/.test(lsEv.text)) guardParts.push(srcVar);
      lines.push(``);
      lines.push(`-- compile + chạy script thật (chỉ khi tải thành công)`);
      lines.push(`if ${guardParts.join(" and ")} then`);
      lines.push(`    loadstring(${srcVar})${hasResult ? "()" : ""}`);
      lines.push(`end`);
      consumed = pcallEnd + 1 + (hasResult ? 2 : 1);
      notes.push("Logic chính: tải nguồn qua game:HttpGet rồi loadstring chạy, lỗi bị nuốt im lặng.");
    }
    return consumed;
  };

  /** Emit khối pcall chứa body events. Trả về index tiếp theo sau khối (hoặc -1 nếu không khớp). */
  const emitPcall = (i: number): number => {
    const end = findPcallEnd(evs, i);
    if (end < 0) return -1;
    const body = evs.slice(i + 1, end);

    // Pattern 1: pcall chỉ bọc debug.getinfo(args) → inline pcall(debug.getinfo, args)
    const getinfoEv = body.find((e) => e.kind === "CALL" && e.text.startsWith("debug.getinfo("));
    if (getinfoEv) {
      const args = getinfoEv.text.slice("debug.getinfo(".length, -1);
      const okVar = nextVar("ok");
      const infoVar = nextVar("info");
      lines.push(`-- anti-tamper: debug.getinfo phải chạy được và trả table`);
      lines.push(`local ${okVar}, ${infoVar} = pcall(debug.getinfo, ${args || "1"})`);
      // Guard: getinfo fail / non-table → anti-analysis hang
      const conds: string[] = [];
      const inRange = (d: number) => d > 0 && d >= i && d <= end;
      if (inRange(divGetinfoFail) && isWaitStormTail(fails.getinfofail ?? [], divGetinfoFail)) {
        conds.push(`not ${okVar}`);
      }
      if (inRange(divGetinfoNonTable) && isWaitStormTail(fails.getinfonontable ?? [], divGetinfoNonTable)) {
        conds.push(`type(${infoVar}) ~= "table"`);
      }
      if (conds.length > 0) {
        lines.push(`if ${conds.join(" or ")} then`);
        lines.push(`    while true do task.wait() end -- anti-analysis: treo executor vĩnh viễn`);
        lines.push(`end`);
        notes.push("Phát hiện bẫy anti-analysis: debug bị hook/strip → vòng lặp task.wait vô hạn.");
      }
      return end + 1;
    }

    // Pattern 2: pcall bọc tải nguồn (game:HttpGet + loadstring ngay sau pcall)
    const httpEv = body.find((e) => e.kind === "CALL" && e.text.startsWith("game:HttpGet("));
    if (httpEv) {
      const nextIdx = emitDownloadPcall(body, end);
      if (nextIdx >= 0) return nextIdx;
      // fallback: pcall chứa HttpGet nhưng không có loadstring sau
      const okVar = nextVar("ok");
      lines.push(`local ${okVar} = pcall(function()`);
      lines.push(`    game:HttpGet(${/^game:\s*HttpGet\((.*)\)$/.exec(httpEv.text)?.[1] ?? ""})`);
      lines.push(`end)`);
      return end + 1;
    }

    // Generic: pcall với body bất kỳ
    const okVar = nextVar("ok");
    lines.push(`local ${okVar} = pcall(function()`);
    for (const e of body) {
      if (e.kind === "CALL") lines.push(`    -- ${e.text}`);
    }
    lines.push(`end)`);
    return end + 1;
  };

  let i = 0;
  while (i < evs.length) {
    const ev = evs[i];

    if (ev.kind === "CALL" && ev.text === "getgenv()") {
      // consume run of getgenv
      let j = i;
      while (j < evs.length && evs[j].kind === "CALL" && evs[j].text === "getgenv()") j++;
      const genvVar = nextVar("genv");
      lines.push(`-- guard executor: getgenv phải tồn tại`);
      lines.push(`local ${genvVar} = getgenv()`);
      // Guard: genv nil → hang
      if (divGenv > 0 && i < divGenv && divGenv <= j && isWaitStormTail(fails.genvnil ?? [], divGenv)) {
        lines.push(`if ${genvVar} == nil then`);
        lines.push(`    while true do task.wait() end -- anti-analysis: treo executor vĩnh viễn`);
        lines.push(`end`);
        notes.push("Phát hiện guard getgenv: executor không có getgenv → treo vĩnh viễn.");
      }
      i = j;
      continue;
    }

    if (ev.kind === "CALL" && ev.text.startsWith("pairs(")) {
      const m = /^pairs\(keys=\[(.*)\]\)$/.exec(ev.text);
      const keys = m ? m[1] : "";
      const keyList = keys.split(", ").filter(Boolean);
      const stdlibNames = ["pcall", "pairs", "error", "tostring", "type", "print", "tonumber", "select", "unpack", "next", "rawget", "rawset", "setmetatable", "getmetatable", "string", "table", "math", "os", "coroutine", "loadstring", "getfenv", "setfenv", "typeof", "require", "xpcall", "assert"];
      const allStdlib = keyList.length >= 3 && keyList.every((k) => stdlibNames.includes(k));
      if (allStdlib) {
        lines.push(`-- anti-hook: snapshot stdlib (nếu bị thay thế giữa chừng, các bước sau sẽ fail)`);
        lines.push(`local ${nextVar("stdlib")} = { ${keyList.map((k) => `${k} = ${k}`).join(", ")} }`);
      } else if (keyList.length > 0 && keyList.length <= 12) {
        lines.push(`-- (bảng nội bộ { ${keys} } — state giải mã của loader, không ảnh hưởng logic chính)`);
      } else {
        lines.push(`-- (duyệt bảng nội bộ ${keyList.length} mục)`);
      }
      i++;
      continue;
    }

    if (ev.kind === "CALL" && ev.text.startsWith("pcall(")) {
      const next = emitPcall(i);
      if (next > i) {
        i = next;
        continue;
      }
      i++;
      continue;
    }

    if (ev.kind === "GET" && ev.text.startsWith("game.")) {
      // GET game.X theo sau là pcall chứa game:X( → if game.X then wrapper
      const field = ev.text.slice("game.".length);
      let k = i + 1;
      while (k < evs.length && evs[k].kind === "GET") k++;
      if (k < evs.length && evs[k].kind === "CALL" && evs[k].text.startsWith("pcall(")) {
        const end = findPcallEnd(evs, k);
        if (end > 0) {
          const body = evs.slice(k + 1, end);
          const hasMethod = body.some((e) => e.kind === "CALL" && e.text.startsWith(`game:${field}(`));
          if (hasMethod) {
            lines.push(`-- kiểm tra API tải có sẵn rồi mới chạy`);
            lines.push(`if game.${field} then`);
            const saved = lines.length;
            const next = emitPcall(k);
            if (next > k) {
              for (let l = saved; l < lines.length; l++) lines[l] = "    " + lines[l];
              lines.push(`end`);
              i = next;
              continue;
            }
            lines.length = saved; // rollback
          }
        }
      }
      lines.push(`-- (đọc game.${field})`);
      i++;
      continue;
    }

    if (ev.kind === "CALL" && /^task\.wait\(/.test(ev.text)) {
      // collapse wait-storm trong happy path
      let j = i;
      while (j < evs.length && evs[j].kind === "CALL" && /^task\.wait\(/.test(evs[j].text)) j++;
      if (j - i >= 6) {
        lines.push(`while true do task.wait() end`);
      } else if (j - i === 1) {
        lines.push(`task.wait()`);
      } else {
        lines.push(`-- task.wait ×${j - i}`);
      }
      i = j;
      continue;
    }

    if (ev.kind === "CALL") {
      if (ev.text.startsWith("getfenv()")) {
        lines.push(`-- getfenv(): tham chiếu môi trường (không dùng tiếp trên happy path)`);
      } else if (ev.text.startsWith("print(")) {
        lines.push(`print(${ev.text.slice(6, -1)})`);
      } else if (ev.text.startsWith("error(")) {
        lines.push(`error(${ev.text.slice(6, -1)})`);
      } else {
        lines.push(`-- ${ev.text}`);
      }
      i++;
      continue;
    }

    if (ev.kind === "SET" && ev.text.startsWith("genv.")) {
      lines.push(`-- ${ev.text}`);
      i++;
      continue;
    }

    if (ev.kind === "GET") {
      lines.push(`-- (đọc ${ev.text})`);
      i++;
      continue;
    }

    // RET và các event khác: bỏ qua
    i++;
  }

  return { lines, notes };
}


// ═════════════════════════════════════════════════════════════════════════════
// Extract VM parts
// ═════════════════════════════════════════════════════════════════════════════

/** Trích (a) table constructor (đã convert binary literals) và (b) payload blob. */
function extractVMParts(input: string): { tableSrc: string; blob: string } {
  const rPos = input.search(/return\s*\(\s*\{/);
  if (rPos < 0) return { tableSrc: "", blob: "" };
  const openBrace = input.indexOf("{", rPos);
  const endMatch = input.lastIndexOf("}):M(");
  if (openBrace < 0 || endMatch < 0 || endMatch <= openBrace) return { tableSrc: "", blob: "" };
  let tableSrc = input.slice(openBrace, endMatch + 1);

  const blobMatch = input.match(/a\.k"((?:\\.|[^"\\])+)"/);
  const blob = blobMatch ? blobMatch[1] : "";
  if (!blob) return { tableSrc: "", blob: "" };

  tableSrc = convertBinaryLiterals(tableSrc);
  return { tableSrc, blob };
}

/** `0b101` → `5`, chỉ ngoài string literals. */
export function convertBinaryLiterals(src: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (inStr) {
      out += ch;
      if (ch === "\\") {
        if (i + 1 < n) out += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inStr = false;
      i++;
    } else if (ch === '"') {
      inStr = true;
      out += ch;
      i++;
    } else if (src.startsWith("0b", i) && i + 2 < n && (src[i + 2] === "0" || src[i + 2] === "1")) {
      const m = /^0b[01]+/.exec(src.slice(i));
      if (m) {
        out += String(parseInt(m[0].slice(2), 2));
        i += m[0].length;
      } else {
        out += ch;
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
