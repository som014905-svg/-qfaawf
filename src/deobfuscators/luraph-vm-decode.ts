// Luraph VM Structural Decoder — v14.6+ "VM mode" (LPH] / LPH> payloads).
//
// Pipeline:
//   1. STATIC: extract the LPH payload, base85-decode it to the binary
//      LuaP-ish stream, and parse the interpreter's opcode dispatch tree
//      straight out of the (still-obfuscated) loader source — giving us the
//      complete opcode → handler map plus best-effort semantic names.
//   2. DYNAMIC (optional, requires `luau-web`): run the loader inside a real
//      Luau WASM sandbox with a JS-backed `buffer` and a proxied Roblox
//      environment. Every loader-method call is wrapped; when a call receives
//      a decoded program table (opcode array + constants + operand columns),
//      we snapshot it. This recovers the *actual* decoded VM program: opcode
//      stream, constants, operand columns and register counts.
//   3. Disassemble every recovered proto into an annotated listing and emit
//      artifacts (opcode map, constants, guest API trace).
//
// The guest program is never trusted: it runs behind proxies, task.wait is
// bounded, and the whole run has a wall-clock timeout.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult, DetectionMatch } from "../types";
import { beautifyLua, renameObfuscatedIdentifiers, unescapeStringLiterals } from "../utils/lua-utils";
import { foldConstants } from "../passes/constant-fold";
import { extractPayloads, decodePayload } from "./luraph";
import { findInstructionFetch, parseDispatchTree, classifyHandler } from "../vm/luraph-dispatch";
import {
  AliasInfo,
  findAliasDestructuring,
  parseFinalProgram,
  parseTrace,
  analyzeFlow,
  decompileProgram,
  correlateRegisters,
  DecompiledProto,
} from "../vm/luraph-lifter";
import { createLuauSandbox, luauSandboxAvailable, luauToJS, LuauSandbox } from "../vm/luau-sandbox";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface VMDump {
  opcodes: number[];
  constants: unknown[];
  columns: Record<string, number[]>;
  registers: number | null;
}

const VM_TABLE_RE = /return\s*\(\s*\{[\s\S]{500,}\}\s*\)\s*:\s*\w+\s*\(/;

export class LuraphVMDecoder implements Deobfuscator {
  id = "luraph" as const;
  name = "Luraph VM Structural Decoder";
  description =
    "Luraph v14.6+ VM-mode recovery: static dispatch-tree extraction (opcode map) + dynamic Luau-sandbox program dump (opcodes/constants/operands) + annotated disassembly.";

  detect(input: string): DetectionMatch | null {
    if (!VM_TABLE_RE.test(input)) return null;
    const hits = extractPayloads(input);
    if (hits.length === 0) return null;
    const isLuraph = /Luraph\s*Obfuscator\s*v?1[45]/i.test(input) || /lura\.ph/i.test(input) || /LPH[}\]>+:]/.test(input);
    if (!isLuraph) return null;
    // The payload must decode to binary (VM mode) rather than plain source.
    const usesZSub =
      /gsub\s*\(\s*"?z"?\s*,\s*"!!!!!"/.test(input) || /,\s*"z"\s*,\s*"!!!!!"\s*\)/.test(input);
    let binary = false;
    for (const hit of hits.slice(0, 3)) {
      const outcome = decodePayload(hit, usesZSub);
      if (outcome && outcome.kind !== "source") {
        binary = true;
        break;
      }
    }
    if (!binary) return null;
    return {
      obfuscator: "luraph",
      confidence: 0.85,
      evidence: `Luraph VM-mode table structure + binary ${hits[0].prefix} payload`,
    };
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    const { input, log } = ctx;
    const notes: string[] = [];
    const artifacts: string[] = [];
    let confidence = 0.3;

    // ── Step 1: payload identification ───────────────────────────────────
    const hits = extractPayloads(input);
    const usesZSub =
      /gsub\s*\(\s*"?z"?\s*,\s*"!!!!!"/.test(input) || /,\s*"z"\s*,\s*"!!!!!"\s*\)/.test(input);
    let payloadInfo = "";
    for (const hit of hits.slice(0, 2)) {
      const outcome = decodePayload(hit, usesZSub);
      if (outcome && outcome.kind !== "source") {
        payloadInfo = `${hit.prefix} → ${outcome.data.length} bytes (${outcome.method})`;
        break;
      }
    }

    let handlers = new Map<number, string>();

    // ── Step 2: static dispatch-tree extraction ──────────────────────────
    log("luraph-vm: parsing interpreter dispatch tree...");
    const fetch = findInstructionFetch(input);
    let opcodeMap = new Map<number, string>();
    let namedCount = 0;
    if (fetch) {
      handlers = parseDispatchTree(input, fetch).handlers;
      for (const [op, text] of handlers) {
        const name = classifyHandler(text);
        opcodeMap.set(op, name ?? `OP_${op}`);
        if (name) namedCount++;
      }
      if (handlers.size > 0) {
        notes.push(
          `Extracted ${handlers.size} VM opcode handlers from the interpreter dispatch tree (${namedCount} classified semantically).`,
        );
        artifacts.push(this.renderOpcodeMap(handlers));
        confidence += 0.15;
      }
    } else {
      notes.push("Interpreter fetch site not found — dispatch-tree extraction skipped.");
    }

    // ── Step 3: dynamic program dump (luau-web) ──────────────────────────
    const dumps: VMDump[] = [];
    let guestLog: string[] = [];
    let finalDumps: string[] = [];
    let alias: AliasInfo | null = null;
    let traceChunks: string[] = [];
    const sandboxUsable = await luauSandboxAvailable().catch(() => false);
    if (sandboxUsable) {
      log("luraph-vm: running loader in Luau sandbox (dynamic decode)...");
      try {
        const dyn = await this.runDynamicDecode(input, log);
        dumps.push(...dyn.dumps);
        guestLog = dyn.guestLog;
        if (dyn.runError) notes.push(`Sandbox run ended early: ${dyn.runError}`);
        finalDumps = dyn.finalDumps ?? [];
        alias = dyn.alias ?? null;
        traceChunks = dyn.trace ?? [];
        if (dumps.length > 0) {
          notes.push(
            `Dynamically decoded ${dumps.length} VM proto(s): ` +
              dumps
                .map((d) => `${d.opcodes.length} ins, ${d.constants.length} consts${d.registers !== null ? `, ${d.registers} regs` : ""}`)
                .join("; ") +
              ".",
          );
          confidence += 0.3;
        }
        if (guestLog.length > 0) {
          notes.push(`Guest execution trace captured (${guestLog.length} events).`);
          confidence += 0.1;
        }
      } catch (e) {
        notes.push(`Dynamic decode failed: ${(e as Error).message?.slice(0, 160)}`);
      }
    } else {
      notes.push("luau-web not usable — dynamic program decode skipped (static analysis only).");
    }

    // ── Step 4: disassembly ──────────────────────────────────────────────
    if (dumps.length > 0) {
      for (const [i, d] of dumps.entries()) {
        const listing = this.disassemble(i + 1, d, opcodeMap);
        artifacts.push(listing);
      }
      const constArtifact = this.renderConstants(dumps);
      if (constArtifact) artifacts.push(constArtifact);
      if (guestLog.length > 0) {
        artifacts.push(`-- Guest API trace (${guestLog.length} events)\n${guestLog.map((l) => `-- ${l}`).join("\n")}`);
      }
      // Decoded VM programs are strictly more recovery than loader-only
      // beautification — outrank the basic Luraph engine so the structural
      // artifacts (opcode map, disassembly) reach the report.
      confidence = Math.max(confidence, 0.88);
    }

    // ── Step 4.5: VM decompilation (final programs + trace + handlers) ───
    let decompiled: DecompiledProto[] = [];
    if (finalDumps.length > 0 && alias) {
      const traceProtos = parseTrace(traceChunks);
      for (const [i, json] of finalDumps.entries()) {
        try {
          const prog = parseFinalProgram(json, alias);
          if (!prog || prog.instrCount < 8) continue;
          prog.registers = correlateRegisters(prog, dumps);
          const tp = traceProtos.find((t) => t.instrCount === prog.instrCount);
          const flow = tp ? analyzeFlow(tp.vips) : null;
          decompiled.push(decompileProgram(prog, alias, handlers, flow, i + 1));
        } catch {
          /* per-proto failures don't abort the rest */
        }
      }
    }
    if (decompiled.length > 0 && alias) {
      const totalIns = decompiled.reduce((a, d) => a + d.instrCount, 0);
      const totalRes = decompiled.reduce((a, d) => a + d.resolved, 0);
      notes.push(
        `Decompiled ${totalIns} VM instructions into Luau source (${totalRes} lifted, ` +
          `${((100 * totalRes) / Math.max(1, totalIns)).toFixed(0)}% coverage, ` +
          `${decompiled.length} proto(s)).`,
      );
      artifacts.push(
        decompiled.map((d) => d.source).join("\n\n"),
      );
      // structured constants from the fully-decoded programs (supersedes the
      // fallback-snapshot constants when fetch instrumentation is active)
      const konstLetter = alias.letters.find(
        (l, i) => alias!.fields[i] === 6,
      );
      if (konstLetter) {
        const all = new Set<string>();
        for (const json of finalDumps) {
          try {
            const prog = parseFinalProgram(json, alias);
            if (!prog) continue;
            for (const v of prog.constants.get(konstLetter)?.values() ?? []) {
              if (
                typeof v === "string" &&
                v.length >= 2 &&
                v.length <= 300 &&
                /^[\x20-\x7e\n\t]+$/.test(v)
              ) {
                all.add(v);
              }
            }
          } catch {
            /* skip */
          }
        }
        if (all.size > 0) {
          const lines = [
            `-- Structured constants recovered from fully-decoded VM program (${all.size} entries)`,
          ];
          for (const c of [...all].slice(0, 600)) lines.push(JSON.stringify(c));
          artifacts.push(lines.join("\n"));
        }
      }
      confidence = Math.max(confidence, 0.9);
    }

    // ── Step 5: loader beautification (main output fallback) ─────────────
    let output = input;
    try {
      const { result: renamed } = renameObfuscatedIdentifiers(input);
      let loader = renamed;
      const un = unescapeStringLiterals(loader);
      if (un.rewritten > 0) loader = un.result;
      const fold = foldConstants(loader, 2);
      if (fold.folded > 0) loader = fold.result;
      if (loader.length < 3_000_000) loader = beautifyLua(loader);
      output = loader;
    } catch (e) {
      log(`luraph-vm: loader beautify failed (${(e as Error).message})`);
    }

    if (payloadInfo) notes.unshift(`Payload: ${payloadInfo}.`);

    const totalInsNote =
      decompiled.length > 0
        ? `${decompiled.reduce((a, d) => a + d.instrCount, 0)} instructions across ` +
          `${decompiled.length} proto(s), ` +
          `${decompiled.reduce((a, d) => a + d.resolved, 0)} lifted to Luau.`
        : "loader layer only";

    // Main output preference: decompiled VM source > beautified loader.
    let finalOutput = output;
    if (decompiled.length > 0) {
      const header = [
        "-- ═══════════════════════════════════════════════════════════════",
        "-- Decompiled from Luraph VM bytecode (structural lifter)",
        `-- Source: ${totalInsNote}`,
        "-- Registers R0..Rn are VM registers; U0..Un are upvalues.",
        "-- ::L<n>:: labels / goto map 1:1 to VM instruction pointers.",
        "-- Unresolved instructions are preserved as comments (-- OP_n).",
        "-- ═══════════════════════════════════════════════════════════════",
        "",
      ];
      finalOutput = header.join("\n") + decompiled.map((d) => d.source).join("\n\n");
    }

    return {
      success: true,
      deobfuscator: this.name,
      output: finalOutput,
      notes,
      confidence: Math.min(0.92, confidence),
      artifacts,
      obfuscator: "luraph",
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dynamic decode
  // ─────────────────────────────────────────────────────────────────────────

  async runDynamicDecode(
    input: string,
    log: (s: string) => void,
  ): Promise<{
    dumps: VMDump[];
    guestLog: string[];
    runError?: string;
    raws?: string[];
    trace?: string[];
    finalDumps?: string[];
    alias?: AliasInfo | null;
  }> {
    // Split `return ({...}):R()(...)` into the table constructor + entry call.
    const rIdx = input.search(/return\s*\(\s*\{/);
    const tailM = /\}\s*\)\s*:\s*(\w+)\s*\(/.exec(input.slice(input.length - 200));
    if (rIdx < 0 || !tailM) return { dumps: [], guestLog: [] };
    const tailIdx = input.lastIndexOf(`}):${tailM[1]}(`);
    if (tailIdx < 0) return { dumps: [], guestLog: [] };
    let tableSrc = input.slice(rIdx + "return ".length, tailIdx + 1);
    const entry = tailM[1];

    // ── Fetch-site instrumentation ─────────────────────────────────────────
    // 1) Parse the alias destructuring that binds the interpreter's operand
    //    column locals from the program table (`local H,m,J,Z,r,t,p =
    //    E[8],E[7],E[2],E[4],E[9],E[6],E[11]`).
    // 2) Inject `__VMSTEP(F, <letters...>)` at the top of the dispatch loop.
    //    On the interpreter's FIRST step (program fully decoded by then) it
    //    serialises the COMPLETE program (opcodes + columns + constants) to
    //    JS — no more incomplete growing snapshots. It also records the VIP
    //    of every dispatch iteration: the actual execution path.
    let tracePatched = false;
    let alias: AliasInfo | null = null;
    let aliasArgs = "";
    try {
      const fetch = findInstructionFetch(tableSrc);
      if (fetch) {
        alias = findAliasDestructuring(tableSrc, fetch);
        const letters = alias ? alias.letters.filter((l, i) => alias!.fields[i] !== null && l !== fetch.opCol) : [];
        aliasArgs = [fetch.opCol, ...letters].join(",");
        const fetchRe = new RegExp(
          `while\\s+true\\s+do(\\s*)local\\s+${fetch.opVar}\\s*=\\s*\\(?\\s*${fetch.opCol}\\s*\\[\\s*${fetch.vipVar}\\s*\\]\\s*\\)?\\s*;`,
        );
        const fm = fetchRe.exec(tableSrc);
        if (fm) {
          const head = `while true do${fm[1]}`;
          const injected = fm[0].replace(
            head,
            `${head}__VMSTEP(${fetch.vipVar},${aliasArgs});`,
          );
          tableSrc = tableSrc.slice(0, fm.index) + injected + tableSrc.slice(fm.index + fm[0].length);
          tracePatched = true;
        }
      }
    } catch {
      /* best-effort */
    }
    log(
      `luraph-vm: fetch-site instrumentation ${tracePatched ? `applied (${aliasArgs || "vip only"})` : "NOT applicable"}`,
    );

    let sandbox: LuauSandbox | null = null;
    try {
      sandbox = await createLuauSandbox({ waitBound: 120, logCap: 500, recordReads: false });
    } catch (e) {
      return { dumps: [], guestLog: [], runError: `sandbox init: ${(e as Error).message}` };
    }

    const seenJson = new Set<string>();
    const rawJsons: string[] = [];
    const t0 = Date.now();
    // Wall-clock budget guard: the WASM sandbox blocks the JS event loop while
    // interpreting, so Promise-based timeouts cannot fire mid-run. Throwing
    // from this callback unwinds the Luau execution instead (the loader's own
    // xpcall rethrows it and the chunk terminates).
    const BUDGET_MS = 16_000;
    let budgetHit = false;
    const pushDump = (json: string): void => {
      if (Date.now() - t0 > BUDGET_MS) {
        budgetHit = true;
        throw new Error("__VMBUDGET__");
      }
      if (rawJsons.length >= 200 || seenJson.has(json)) return;
      seenJson.add(json);
      rawJsons.push(json);
    };
    sandbox.setGlobal("__VMDUMPJSON", pushDump);

    // Transform: instantiate the table, wrap every method with a scanner that
    // inspects table arguments for decoded program tables (recognised by a
    // large numeric array at slot 4 + a table at slot 6), serialise them to
    // JSON in Lua (interop table conversion is unreliable for big nested
    // structures) and hand the string to JS.
    const stepArgs = alias ? alias.letters.filter((l, i) => alias!.fields[i] !== null) : [];
    // letters in CALL order (opLetter passed positionally as `z`)
    const callLetters = stepArgs.filter((l) => l !== alias?.opLetter);
    const dumpTable = stepArgs.length
      ? `{ ${stepArgs
          .map((l) => `['${l}']=${l === (alias?.opLetter ?? "\u0000") ? "z" : `c${callLetters.indexOf(l)}`}`)
          .join(", ")} }`
      : "z";
    const stepParams = callLetters.map((_, i) => `c${i}`).join(", ");
    const tracePrelude =
      `__vmt = {}\n` +
      `__vmn = 0\n` +
      `__vmids = setmetatable({}, { __mode = 'k' })\n` +
      `__vmidn = 0\n` +
      `__vmcurz = nil\n` +
      `function __VMSTEP(f, z${stepParams ? ", " + stepParams : ""})\n` +
      `  if __vmn >= 200000 then return end\n` +
      `  if z ~= __vmcurz then\n` +
      `    __vmcurz = z\n` +
      `    if __vmids[z] == nil then\n` +
      `      __vmidn = __vmidn + 1\n` +
      `      __vmids[z] = __vmidn\n` +
      `      -- first dispatch of this interpreter: program fully decoded\n` +
      `      local __ok, __json = pcall(__jser, ${dumpTable}, 0)\n` +
      `      if __ok and __json and #__json < 4000000 then\n` +
      `        local __dok = pcall(__VMDUMPFINAL, __json)\n` +
      `        if not __dok then __VMDBG('dumpfinal-call-failed') end\n` +
      `      elseif __ok then\n` +
      `        __VMDBG('dump-too-big:' .. tostring(__json and #__json))\n` +
      `      else\n` +
      `        __VMDBG('dump-jser-failed:' .. tostring(__json):sub(1, 120))\n` +
      `      end\n` +
      `    end\n` +
      `    if __vmn > 0 then\n` +
      `      __VMTRACE(table.concat(__vmt, ',', 1, __vmn))\n` +
      `      __vmt = {}\n` +
      `      __vmn = 0\n` +
      `    end\n` +
      `    __VMTRACE('P' .. __vmids[z] .. ':' .. #z)\n` +
      `  end\n` +
      `  __vmn = __vmn + 1\n` +
      `  __vmt[__vmn] = f\n` +
      `  if __vmn >= 4096 then\n` +
      `    __VMTRACE(table.concat(__vmt, ',', 1, __vmn))\n` +
      `    __vmt = {}\n` +
      `    __vmn = 0\n` +
      `  end\n` +
      `end\n`;
    const patched =

      `local __esc = { ['"'] = '\\\\"', ['\\\\'] = '\\\\\\\\', ['\\n'] = '\\\\n', ['\\r'] = '\\\\r', ['\\t'] = '\\\\t', ['\\b'] = '\\\\b', ['\\f'] = '\\\\f' }\n` +
      `local function __jstr(s)\n` +
      `  local out, n = { '"' }, 1\n` +
      `  for i = 1, #s do\n` +
      `    local c = s:sub(i, i)\n` +
      `    local b = c:byte()\n` +
      `    local e = __esc[c]\n` +
      `    if e then n = n + 1; out[n] = e\n` +
      `    elseif b < 32 or b > 126 then n = n + 1; out[n] = string.format('\\\\u%04x', b)\n` +
      `    else n = n + 1; out[n] = c end\n` +
      `  end\n` +
      `  n = n + 1; out[n] = '"'\n` +
      `  return table.concat(out)\n` +
      `end\n` +
      `local function __jser(v, depth)\n` +
      `  local t = type(v)\n` +
      `  if t == 'number' then\n` +
      `    if v ~= v or v == math.huge or v == -math.huge then return '0' end\n` +
      `    if v % 1 == 0 and v > -9007199254740992 and v < 9007199254740992 then return string.format('%d', v) end\n` +
      `    return string.format('%.17g', v)\n` +
      `  elseif t == 'string' then return __jstr(v)\n` +
      `  elseif t == 'boolean' then return tostring(v)\n` +
      `  elseif t == 'nil' then return 'null'\n` +
      `  elseif t == 'table' and depth < 4 then\n` +
      `    local parts, n = {}, 0\n` +
      `    for k, val in pairs(v) do\n` +
      `      n = n + 1\n` +
      `      if n > 3000 then break end\n` +
      `      local kt = type(k)\n` +
      `      local kk\n` +
      `      if kt == 'number' then kk = '"' .. string.format('%d', k) .. '"'\n` +
      `      elseif kt == 'string' then kk = __jstr(k)\n` +
      `      else kk = '"' .. kt .. '"'\n` +
      `      end\n` +
      `      parts[n] = kk .. ':' .. __jser(val, depth + 1)\n` +
      `    end\n` +
      `    return '{' .. table.concat(parts, ',') .. '}'\n` +
      `  else\n` +
      `    return '"' .. t .. '"'\n` +
      `  end\n` +
      `end\n` +
      tracePrelude +
      `local __T = ${tableSrc}\n` +
      // Fallback program scan (only when the fetch-site instrumentation could
      // NOT be applied): wrap every method, look for decoded program tables in
      // the arguments. Serialisation is guarded per table on opcode-count
      // change — the loader hands the program table to some methods tens of
      // thousands of times and re-serialising each time is O(n²).
      (tracePatched
        ? ""
        : `__vmseen = setmetatable({}, { __mode = 'k' })\n` +
          `for __k, __v in pairs(__T) do\n` +
          `  if type(__v) == 'function' and __k ~= '${entry}' then\n` +
          `    local __o = __v\n` +
          `    __T[__k] = function(self, ...)\n` +
          `      local __n = select('#', ...)\n` +
          `      for __i = 1, __n do\n` +
          `        local __a = select(__i, ...)\n` +
          `        if type(__a) == 'table' then\n` +
          `          local __ok, __c4 = pcall(rawget, __a, 4)\n` +
          `          if __ok and type(__c4) == 'table' then\n` +
          `            local __len = #__c4\n` +
          `            if __len >= 8 and type(rawget(__c4, 1)) == 'number' then\n` +
          `              local __ok6, __c6 = pcall(rawget, __a, 6)\n` +
          `              if __ok6 and type(__c6) == 'table' then\n` +
          `                if __vmseen[__a] ~= __len then\n` +
          `                  __vmseen[__a] = __len\n` +
          `                  local __okj, __json = pcall(__jser, __a, 0)\n` +
          `                  if __okj then __VMDUMPJSON(__json) end\n` +
          `                end\n` +
          `              end\n` +
          `            end\n` +
          `          end\n` +
          `        end\n` +
          `      end\n` +
          `      return __o(self, ...)\n` +
          `    end\n` +
          `  end\n` +
          `end\n`) +
      `local __ok, __err = xpcall(function() return __T:${entry}() end, debug.traceback)\n` +
      `if not __ok then __VMERR(tostring(__err):sub(1, 200)) end\n` +
      `if __vmn and __vmn > 0 then __VMTRACE(table.concat(__vmt, ',', 1, __vmn)) end\n` +
      `return __ok`;

    let runError: string | undefined;
    sandbox.setGlobal("__VMERR", (e: string) => {
      runError = e.split("\n")[0]?.slice(0, 160);
    });
    const dbg: string[] = [];
    sandbox.setGlobal("__VMDBG", (e: string) => {
      if (dbg.length < 40) dbg.push(e);
    });
    const traceChunks: string[] = [];
    sandbox.setGlobal("__VMTRACE", (s: string) => {
      if (traceChunks.length < 4000) traceChunks.push(String(s));
    });
    const finalDumps: string[] = [];
    sandbox.setGlobal("__VMDUMPFINAL", (s: string) => {
      if (finalDumps.length < 24) finalDumps.push(String(s));
    });

    if (process.env.LURAPH_VM_DEBUG_CHUNK) {
      try {
        (await import("node:fs")).writeFileSync(process.env.LURAPH_VM_DEBUG_CHUNK, patched);
        log(`luraph-vm: debug chunk written (${patched.length} chars)`);
      } catch { /* ignore */ }
    }
    const t0Run = Date.now();
    // Budget stays under the orchestrator's default per-engine timeout (30s):
    // dumps are collected live, so even a truncated run keeps partial programs.
    const res = await sandbox.runChunk(patched, "luraph-vm-loader", 22_000);
    log(`luraph-vm: sandbox run ${res.ok ? "completed" : "aborted"} in ${Date.now() - t0Run}ms`);
    if (!res.ok && !runError) runError = res.error?.slice(0, 160);
    if (budgetHit) runError = undefined; // clean early-stop, not a failure
    sandbox.destroy();
    // Post-process: parse, dedup and rank by instruction count. Setup-phase VM
    // state tables and repeated snapshots of a lazily-decoded program can
    // both match the scan shape, so we keep the most complete snapshot of
    // each distinct program (detected via opcode-prefix matching) and rank
    // by size.
    const all: VMDump[] = [];
    for (const json of rawJsons) {
      try {
        const d = this.parseProgramJSON(json);
        if (d && d.opcodes.length >= 8) all.push(d);
      } catch {
        /* malformed — skip */
      }
    }
    all.sort((a, b) => b.opcodes.length - a.opcodes.length);
    const dumpsFinal: VMDump[] = [];
    for (const d of all) {
      const isPrefixOfKept = dumpsFinal.some(
        (k) =>
          k.opcodes.length >= d.opcodes.length &&
          k.opcodes.slice(0, d.opcodes.length).every((v, i) => v === d.opcodes[i]),
      );
      if (!isPrefixOfKept) dumpsFinal.push(d);
    }
    const dumps = dumpsFinal.slice(0, 12);
    if (dbg.length > 0) log(`luraph-vm: lua-dbg: ${dbg.join(" | ").slice(0, 600)}`);
    return {
      dumps,
      guestLog: sandbox.guestLog,
      runError,
      raws: rawJsons,
      trace: traceChunks,
      finalDumps,
      alias,
    };
  }

  /** Parse a Lua-side JSON serialisation of a decoded program table into a
   * VMDump: the opcode array (largest numeric column), the constants pool
   * (mixed-type table) and the remaining operand columns. */
  parseProgramJSON(json: string): VMDump | null {
    let js: any;
    try {
      js = JSON.parse(json);
    } catch {
      return null;
    }
    if (!js || typeof js !== "object") return null;
    // Convert {"1": v, "2": v} keys into a sorted numeric view.
    const entries: Array<[number, unknown]> = [];
    for (const key of Object.keys(js)) {
      const n = Number(key);
      if (Number.isFinite(n)) entries.push([n, js[key]]);
    }
    entries.sort((a, b) => a[0] - b[0]);
    let opcodes: number[] | null = null;
    let opcodeLen = 0;
    let constants: unknown[] | null = null;
    const columns: Record<string, number[]> = {};
    let registers: number | null = null;
    for (const [key, v] of entries) {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        const sub = v as Record<string, unknown>;
        const vals = Object.keys(sub)
          .map((k) => Number(k))
          .filter((k) => Number.isFinite(k))
          .sort((a, b) => a - b)
          .map((k) => sub[String(k)]);
        const numeric = vals.length >= 3 && vals.every((x) => typeof x === "number");
        if (numeric) {
          if (vals.length > opcodeLen) {
            if (opcodes) columns[`col_${key}`] = opcodes;
            opcodes = vals as number[];
            opcodeLen = vals.length;
          } else {
            columns[`col_${key}`] = vals as number[];
          }
        } else if (!constants && vals.length >= 2) {
          const hasString = vals.some((x) => typeof x === "string");
          if (hasString) constants = vals;
        }
      } else if (typeof v === "number" && v >= 1 && v <= 1024 && !registers) {
        registers = v;
      }
    }
    if (!opcodes) return null;
    return { opcodes, constants: constants ?? [], columns, registers };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  private renderOpcodeMap(handlers: Map<number, string>): string {
    const lines: string[] = [];
    lines.push(`-- VM opcode map (${handlers.size} handlers extracted from the dispatch tree)`);
    for (const op of [...handlers.keys()].sort((a, b) => a - b)) {
      const text = handlers.get(op) ?? "";
      const name = classifyHandler(text);
      const body = text.replace(/\s+/g, " ").slice(0, 110);
      lines.push(`-- [${op}] ${name ?? "OP_" + op}: ${body}`);
    }
    return lines.join("\n");
  }

  private disassemble(index: number, d: VMDump, opcodeMap: Map<number, string>): string {
    const lines: string[] = [];
    lines.push(`-- ── Proto #${index} disassembly ──`);
    lines.push(
      `-- ${d.opcodes.length} instructions · ${d.constants.length} constants` +
        (d.registers !== null ? ` · ${d.registers} registers` : ""),
    );
    const colKeys = Object.keys(d.columns).sort();
    const limit = Math.min(d.opcodes.length, 4000);
    for (let vip = 1; vip <= limit; vip++) {
      const op = d.opcodes[vip - 1] ?? 0;
      const name = opcodeMap.get(op) ?? `OP_${op}`;
      const parts: string[] = [];
      for (const k of colKeys) {
        const col = d.columns[k];
        if (col === undefined) continue;
        const val = col[vip - 1];
        if (val !== undefined && val !== null) parts.push(`${k}=${val}`);
      }
      // constant at this VIP (constants pool is 1-based over its own space —
      // we annotate with the constant the operands likely reference)
      const kConst = d.constants[vip - 1];
      if (kConst !== undefined) {
        const ks = typeof kConst === "string" ? JSON.stringify(kConst).slice(0, 40) : String(kConst);
        parts.push(`K=${ks}`);
      }
      lines.push(`-- ${String(vip).padStart(4, "0")}  ${name.padEnd(14)} ${parts.join(" ")}`);
    }
    if (d.opcodes.length > limit) lines.push(`-- … ${d.opcodes.length - limit} more instructions (truncated)`);
    return lines.join("\n");
  }

  private renderConstants(dumps: VMDump[]): string | null {
    const all = new Set<string>();
    for (const d of dumps) {
      for (const c of d.constants) {
        if (typeof c === "string" && c.length >= 2 && c.length <= 200 && /^[\x20-\x7e]+$/.test(c)) {
          all.add(c);
        }
      }
    }
    if (all.size === 0) return null;
    const lines = [`-- Structured constants recovered from decoded VM program (${all.size} entries)`];
    for (const c of [...all].slice(0, 500)) lines.push(JSON.stringify(c));
    return lines.join("\n");
  }
}
