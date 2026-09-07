// Luau sandbox — luau-web wrapper for dynamic analysis of Luraph VM loaders.
//
// Why: Luraph v14.x VM loaders are Luau source (continue, 0x1__0F literals,
// bit32/buffer) that no Lua 5.x VM can parse. `luau-web` ships the real Luau
// runtime compiled to WASM with JS interop. Under Bun the JSPI backend is
// broken (pcall errors escape), so we force the Asyncify backend — the same
// logic as the package's own index.js, minus the WebAssembly.Suspending probe.
//
// Everything here is optional at runtime: if luau-web is not installed the
// caller falls back to static analysis.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface LuauSandbox {
  state: unknown;
  env: any;
  setGlobal: (key: string, value: unknown) => void;
  getGlobal: (key: string) => unknown;
  runChunk: (source: string, chunkName: string, timeoutMs: number) => Promise<{ ok: boolean; error?: string }>;
  guestLog: string[];
  bufferReads: { op: string; off: number; val: number | string }[];
  destroy: () => void;
}

interface BufferRecord {
  op: string;
  off: number;
  val: number | string;
}

let cachedProbe: boolean | null = null;

/**
 * Instantiate a FRESH Luau WASM module.
 *
 * luau-web's glue cannot create a new Lua state after one was destroyed in
 * the same WASM instance (dangling global lua_State), so every sandbox gets
 * its own module instance (~150ms boot). The Asyncify backend is forced
 * because Bun's WebAssembly.Suspending probe selects a broken JSPI build.
 */
async function createFreshLuauState(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = await import("luau-web/src/lib/Luau.Web.Asyncify.js");
  const factory = m.default ?? m;
  const Luau: any = {
    LUA_VALUE: Symbol("LuaValue"),
    JS_VALUE: Symbol("JsValue"),
    JS_MUTABLE: Symbol("JsMutable"),
    securityTransmitList: new Map(),
    options: new Map([["LUA_IMPLICIT_ARRAYS_TO_JS_ARRAYS", true]]),
    states: [],
  };
  const moduleInstance = await factory(Luau);
  Object.assign(Luau, moduleInstance);

  class CompileError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CompileError";
    }
  }

  class LuauState {
    state: any = null;
    env: any = null;
    stateIdx = 0;
    destroyed = false;

    static async createAsync(initialEnv?: Record<string, unknown>): Promise<any> {
      const instance = new LuauState();
      instance.state = await Luau._makeLuaState(instance.stateIdx);
      instance.env = Luau.states[instance.stateIdx].env;
      if (initialEnv) {
        for (const [key, value] of Object.entries(initialEnv)) {
          instance.env.set(key, value, true);
        }
      }
      return instance;
    }

    constructor() {
      this.stateIdx = Luau.states.length + 1;
      Luau.states[this.stateIdx] = {};
      Luau.states[this.stateIdx].luaValueCache = new Map();
      Luau.states[this.stateIdx].jsValueCache = new Map();
      Luau.states[this.stateIdx].jsValueReverse = new Map();
      Luau.states[this.stateIdx].transactionData = [];
      Luau.states[this.stateIdx].nextJSRef = -1;
      Luau.states[this.stateIdx].nextTXKey = 0;
      this.destroyed = false;
      this.state = null;
      this.env = null;
    }

    getValue(idx: number): any {
      if (this.destroyed) throw new Luau.GlueError("Cannot use destroyed Luau state");
      const transactionId = Luau._getLuaValue(this.state, idx);
      let luauValue = null;
      try {
        luauValue = JSON.parse(Luau.states[this.stateIdx].transactionData[transactionId]);
      } catch {
        /* not JSON */
      }
      return Luau.luauToJsValue(this.stateIdx, this.state, luauValue);
    }

    makeTransaction(value: unknown): number {
      if (this.destroyed) throw new Luau.GlueError("Cannot use destroyed Luau state");
      const idx = Luau.states[this.stateIdx].nextTXKey++;
      Luau.states[this.stateIdx].transactionData[idx] = value;
      return idx;
    }

    loadstring(source: string, chunkname = "LuauWeb", throwOnCompilationError = false): any {
      if (this.destroyed) throw new Luau.GlueError("Cannot use destroyed Luau state");
      const loadStatus = Luau._luauLoad(this.state, this.makeTransaction(source), this.makeTransaction(chunkname));
      if (loadStatus != 0) {
        const error = this.getValue(-1);
        if (throwOnCompilationError) throw new CompileError(error);
        return error;
      }
      return this.getValue(-1);
    }

    destroy(): void {
      if (this.destroyed) throw new Luau.GlueError("Cannot use destroyed Luau state");
      this.destroyed = true;
      this.env = null;
      Luau.states[this.stateIdx] = null;
      Luau._luauClose(this.state);
    }
  }

  return { LuauState, CompileError, Luau };
}

/** Quick capability probe (cached per process) — verifies that the WASM
 * module boots and that pcall actually catches errors (broken JSPI builds
 * let them escape). */
export async function luauSandboxAvailable(): Promise<boolean> {
  if (cachedProbe !== null) return cachedProbe;
  try {
    const { LuauState } = await createFreshLuauState();
    const state = await LuauState.createAsync();
    const f = state.loadstring(
      "local ok, e = pcall(function() error('probe') end); return ok, e",
      "probe",
      true,
    );
    const r = await f();
    cachedProbe = Array.isArray(r) && r[0] === false;
  } catch {
    cachedProbe = false;
  }
  return cachedProbe;
}

export interface SandboxOptions {
  /** Cap for task.wait() calls before we abort the guest (default 30). */
  waitBound?: number;
  /** Cap for guest log lines (default 400). */
  logCap?: number;
  /** Cap for recorded buffer reads (default 1M). */
  readCap?: number;
  /** Record buffer reads (adds overhead; default true). */
  recordReads?: boolean;
}

/**
 * Build a full Luau sandbox with:
 *  - JS-backed `buffer` implementation (records reads for format analysis)
 *  - deep-proxy Roblox-ish guest environment (game/Instance/task/…)
 *  - executor shims (getfenv/setfenv/getgenv/loadstring/http_request/…)
 *  - task.wait bound + wall-clock timeout protection
 */
export async function createLuauSandbox(opts: SandboxOptions = {}): Promise<LuauSandbox> {
  const { LuauState } = await createFreshLuauState();
  const waitBound = opts.waitBound ?? 30;
  const logCap = opts.logCap ?? 400;
  const readCap = opts.readCap ?? 1_000_000;
  const recordReads = opts.recordReads ?? true;

  const state = await LuauState.createAsync();
  const env: any = state.env;
  const guestLog: string[] = [];
  const bufferReads: BufferRecord[] = [];
  let waitCalls = 0;

  const mklog = (s: string): void => {
    if (guestLog.length < logCap) guestLog.push(s);
  };
  const set = (k: string, v: unknown): void => {
    env.set(k, v, true);
  };

  // ── buffer shim (JS objects ↔ Luau opaque values) ──
  interface Buf {
    bytes: Uint8Array;
  }
  const bufs = new Map<object, Buf>();
  const mk = (n: number): object => {
    const o = {};
    bufs.set(o, { bytes: new Uint8Array(n) });
    return o;
  };
  const get = (b: any): Buf => {
    const r = bufs.get(b);
    if (!r) throw new Error("bad buffer argument");
    return r;
  };
  const rd = (op: string, off: number, val: number | string): number => {
    if (recordReads && bufferReads.length < readCap) bufferReads.push({ op, off, val });
    return val as number;
  };
  const traceBuf: Record<string, unknown> = {
    create: (n: number) => mk(n),
    fromstring: (s: string) => {
      const o = {};
      const b = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
      bufs.set(o, { bytes: b });
      return o;
    },
    tostring: (b: any) => {
      const r = get(b);
      let s = "";
      for (const c of r.bytes) s += String.fromCharCode(c);
      return s;
    },
    len: (b: any) => get(b).bytes.length,
    readu8: (b: any, o: number) => rd("u8", o, get(b).bytes[o] ?? 0),
    readu16: (b: any, o: number) => {
      const d = get(b).bytes;
      return rd("u16", o, (d[o]! | (d[o + 1]! << 8)) & 0xffff);
    },
    readu32: (b: any, o: number) => {
      const d = get(b).bytes;
      return rd("u32", o, (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! * 0x1000000)) >>> 0);
    },
    readi16: (b: any, o: number) => {
      const d = get(b).bytes;
      let v = d[o]! | (d[o + 1]! << 8);
      if (v >= 0x8000) v -= 0x10000;
      return rd("i16", o, v);
    },
    readi32: (b: any, o: number) => {
      const d = get(b).bytes;
      return rd("i32", o, (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! * 0x1000000)) | 0);
    },
    readf32: (b: any, o: number) => {
      const d = get(b).bytes;
      return rd("f32", o, new DataView(d.buffer, d.byteOffset + o, 4).getFloat32(0, true));
    },
    readf64: (b: any, o: number) => {
      const d = get(b).bytes;
      return rd("f64", o, new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true));
    },
    readstring: (b: any, o: number, n: number) => {
      const d = get(b).bytes;
      let s = "";
      for (let i = 0; i < n; i++) s += String.fromCharCode(d[o + i]!);
      return rd("str", o, s);
    },
    writeu8: (b: any, o: number, v: number) => {
      get(b).bytes[o] = v & 0xff;
    },
    writeu16: (b: any, o: number, v: number) => {
      const d = get(b).bytes;
      d[o] = v & 0xff;
      d[o + 1] = (v >> 8) & 0xff;
    },
    writeu32: (b: any, o: number, v: number) => {
      const d = get(b).bytes;
      d[o] = v & 0xff;
      d[o + 1] = (v >> 8) & 0xff;
      d[o + 2] = (v >> 16) & 0xff;
      d[o + 3] = (v >> 24) & 0xff;
    },
    writestring: (b: any, o: number, s: string) => {
      const d = get(b).bytes;
      for (let i = 0; i < s.length; i++) d[o + i] = s.charCodeAt(i) & 0xff;
    },
    copy: () => {},
    fill: () => {},
    writei16: (b: any, o: number, v: number) => {
      const d = get(b).bytes;
      d[o] = v & 0xff;
      d[o + 1] = (v >> 8) & 0xff;
    },
    writei32: (b: any, o: number, v: number) => {
      const d = get(b).bytes;
      d[o] = v & 0xff;
      d[o + 1] = (v >> 8) & 0xff;
      d[o + 2] = (v >> 16) & 0xff;
      d[o + 3] = (v >> 24) & 0xff;
    },
    writef32: () => {},
    writef64: () => {},
  };
  set("buffer", traceBuf);

  // ── guest environment ──
  set("print", (...a: any[]) => mklog("print: " + a.map(String).join(" ")));
  set("warn", () => {});
  set(
    "task",
    Object.freeze({
      wait: () => {
        if (++waitCalls > waitBound) throw new Error("__SANDBOX_WAIT_BOUND__");
        return 0;
      },
      spawn: () => {},
      delay: () => {},
      defer: () => {},
    }),
  );
  set("shared", {});
  set("loadstring", (s: string) => {
    mklog("loadstring: " + String(s).slice(0, 120));
    return () => {};
  });
  set("load", (s: string) => {
    mklog("load: " + String(s).slice(0, 120));
    return () => {};
  });
  const httpReq = (t: any) => {
    mklog("http_request: " + String(t?.Url ?? t));
    return { Body: "", StatusCode: 200, Headers: {} };
  };
  set("http_request", httpReq);
  set("request", httpReq);
  set("syn", { request: httpReq });
  set("identifyexecutor", () => "zai-deobf-sandbox");
  set("hookfunction", () => () => {});
  set("hookmetamethod", () => () => {});
  set("checkcaller", () => false);
  set("getconnections", () => ({}));
  set("getreg", () => ({}));

  // ── Lua-side shims (defined in a chunk so we get real Lua closures) ──
  // NOTE: every Luau invocation must be awaited — the Asyncify backend
  // suspends the WASM instance on JS↔Luau transitions.
  // Complex globals (game/Instance/…) are auto-proxies built in Lua because
  // Luau functions cannot be indexed (JS function proxies would break
  // `game:GetService(...)`-style method calls).
  set("__GLOG", (s: string) => mklog(s));
  try {
    const boot = state.loadstring(
      `
      unpack = table.unpack
      getfenv = function(f) return _G end
      setfenv = function(f, t) return f end
      getgenv = function() return _G end
      getrenv = function() return _G end
      getsenv = function() return _G end

      local function autop(path)
        return setmetatable({}, {
          __index = function(t, k)
            local key = tostring(k)
            __GLOG("GET " .. path .. "." .. key)
            return function(self, ...)
              local args = {}
              for i = 1, select('#', ...) do
                local a = select(i, ...)
                local ty = type(a)
                if ty == "string" or ty == "number" or ty == "boolean" then
                  args[#args + 1] = tostring(a)
                else
                  args[#args + 1] = ty
                end
              end
              __GLOG("CALL " .. path .. ":" .. key .. "(" .. table.concat(args, ", ") .. ")")
              return autop(path .. ":" .. key .. "()")
            end
          end,
        })
      end
      -- Unknown globals become auto-proxies too: guest feature-detection
      -- (Drawing.new, firetouchinterest, …) no longer crashes on nil, so the
      -- VM program executes further and the trace covers more instructions.
      setmetatable(_G, {
        __index = function(_t, k)
          local key = tostring(k)
          if key ~= "_G" then
            __GLOG("GLOBAL " .. key)
            return autop("G:" .. key)
          end
          return nil
        end,
      })
      game = autop("game")
      workspace = autop("workspace")
      Workspace = autop("Workspace")
      script = autop("script")
      Instance = autop("Instance")
      for _, name in ipairs({
        "Vector3", "Vector2", "CFrame", "Color3", "UDim", "UDim2", "TweenInfo",
        "Ray", "Random", "DateTime", "Enum", "NumberRange", "NumberSequence",
        "ColorSequence", "Rect", "Region3", "Font", "PhysicalProperties", "FontFace",
      }) do
        _G[name] = autop(name)
      end
      `,
      "sandbox-boot",
      true,
    );
    await boot();
  } catch {
    /* non-fatal: getfenv etc. may already exist */
  }

  return {
    state,
    env,
    setGlobal: set,
    getGlobal: (k: string) => env.get(k),
    guestLog,
    bufferReads,
    runChunk: async (source: string, chunkName: string, timeoutMs: number) => {
      const fn = state.loadstring(source, chunkName, true);
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`__SANDBOX_TIMEOUT_${timeoutMs}ms__`)), timeoutMs),
      );
      try {
        await Promise.race([(async () => await fn())(), timeout]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message?.slice(0, 500) };
      }
    },
    destroy: () => {
      try {
        state.destroy();
      } catch {
        /* already destroyed */
      }
    },
  };
}

/** Deep-convert a Luau value (table proxies from the interop) into plain JS. */
export function luauToJS(v: any, depth = 0, seen = new Set<any>()): any {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === "number" || t === "boolean") return v;
  if (t === "string") {
    const s = v as string;
    return s.length > 80 ? s.slice(0, 80) + `…+${s.length}` : s;
  }
  if (t === "function") return "<fn>";
  if (t === "object") {
    if (typeof v.get === "function" && typeof v.keys === "function") {
      if (seen.has(v)) return "<cycle>";
      if (depth > 10) return "<deep>";
      seen.add(v);
      const o: Record<string, unknown> = {};
      let n = 0;
      for (const k of v.keys()) {
        if (++n > 600) {
          o.__truncated = true;
          break;
        }
        try {
          o[String(k)] = luauToJS(v.get(k), depth + 1, seen);
        } catch {
          o[String(k)] = "<err>";
        }
      }
      return o;
    }
    if (Array.isArray(v)) return depth < 10 ? v.map((x) => luauToJS(x, depth + 1, seen)) : `arr(${v.length})`;
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = depth < 10 ? luauToJS(v[k], depth + 1, seen) : "…";
    return o;
  }
  return String(v);
}
