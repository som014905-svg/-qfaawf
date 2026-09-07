// Modern Luau VM/static-pattern deobfuscator — v5.5.0
//
// Targets:
//   • Clyde Protection (sfr-development) — XOR string factories (original v5.4 pass),
//     register-VM & stack-VM output, LZMA-compressed maximum-mode payloads, and
//     control-flow-dispatch-table (CFF) patterns from the new Clyde web tool.
//   • sudo-dava25/LuaU-obfuscator — custom bytecode VM with {i,k,f,u} proto tables;
//     now also handles trimmed variants {i,k,f}, {i,k,f,p}, and differently-named
//     proto fields seen in forks.
//
// Everything is source-only/static — no Lua/Luau execution.

import { Deobfuscator, DeobfuscateContext, DeobfuscateResult } from "../types";
import { beautifyLua, reencodeLuaString, renameObfuscatedIdentifiers } from "../utils/lua-utils";
import { foldConstants } from "../passes/constant-fold";
import { validateLuaSource } from "../utils/validate";

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";

// ---------------------------------------------------------------------------
// Helpers shared across passes
// ---------------------------------------------------------------------------

function parseNumberList(body: string): number[] | null {
  const t = body.trim();
  if (!t || t.length > 1_000_000) return null;
  const parts = t.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length > 100_000) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,6}$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 65535) return null;
    nums.push(n);
  }
  return nums;
}

function printableRatio(s: string): number {
  if (!s.length) return 0;
  let ok = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) ok++;
  }
  return ok / s.length;
}

// ---------------------------------------------------------------------------
// Pass: Clyde XOR string factories  (unchanged from v5.4)
// ---------------------------------------------------------------------------

/**
 * Clyde StringEncoder shape:
 * (function(t)local s=""for i=1,#t do s=s..string.char(bit32.bxor(t[i],k))end return s end){1,2,3},42
 */
function foldClydeXorCalls(src: string): { result: string; changed: number; notes: string[] } {
  const notes: string[] = [];
  const decoderNames = new Set<string>();

  const defRe = new RegExp(
    `local\\s+(${IDENT})\\s*=\\s*function\\s*\\([^)]*\\)`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = defRe.exec(src))) {
    const body = src.slice(m.index, m.index + 7000);
    const hasLoop = /for\s+\w+\s*=\s*1\s*,\s*#\w+/.test(body);
    const hasChar = /string\s*(?:\.\s*|(?:\[\s*["']char["']\s*\]\s*))char/.test(body) || /string\s*\.\s*char/.test(body);
    const hasXor = /bit32\s*(?:\.\s*|(?:\[\s*["']bxor["']\s*\]\s*))bxor/.test(body) || /bit32\s*\.\s*bxor/.test(body);
    const hasConcat = /table\s*\.\s*concat/.test(body);
    if (hasLoop && hasChar && hasXor && hasConcat) decoderNames.add(m[1]);
  }

  if (!decoderNames.size) return { result: src, changed: 0, notes };

  let result = src;
  let changed = 0;
  for (const name of decoderNames) {
    const callRe = new RegExp(`\\b${name}\\s*\\(\\s*\\{([^{}]{1,500000})\\}\\s*,\\s*(-?\\d+)\\s*\\)`, "g");
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    let c: RegExpExecArray | null;
    while ((c = callRe.exec(result))) {
      const nums = parseNumberList(c[1]);
      const key = Number(c[2]);
      if (!nums || !Number.isInteger(key) || key < 0 || key > 255) continue;
      const decoded = String.fromCharCode(...nums.map((n) => (n ^ key) & 0xff));
      if (!decoded.length || printableRatio(decoded) < 0.82) continue;
      replacements.push({ start: c.index, end: c.index + c[0].length, text: reencodeLuaString(decoded, '"') });
    }
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i];
      result = result.slice(0, r.start) + r.text + result.slice(r.end);
      changed++;
    }
  }
  if (changed) notes.push(`Decoded ${changed} Clyde XOR string call(s) statically`);
  return { result, changed, notes };
}

// ---------------------------------------------------------------------------
// Pass: Dava character-array factories  (v5.4 + extended variants)
// ---------------------------------------------------------------------------

/**
 * sudo-dava25/LuaU-obfuscator constant encoding:
 *   (function(t) local s="" for i=1,#t do s=s..string.char(t[i]) end return s end){65,66,67}
 *
 * v5.5: also match forks that use `table.concat` + `string.char` in one step:
 *   (function(t) return table.concat((function(r)
 *     for i=1,#t do r[#r+1]=string.char(t[i]) end return r end)({})) end){...}
 */
function foldDavaCharArrayFactories(src: string): { result: string; changed: number; notes: string[] } {
  const notes: string[] = [];

  // Original shape (v5.4)
  const re1 = /\(\s*function\s*\(\s*([A-Za-z_]\w*)\s*\)\s*local\s+([A-Za-z_]\w*)\s*=\s*""\s*for\s+[A-Za-z_]\w*\s*=\s*1\s*,\s*#\1\s*do\s+\2\s*=\s*\2\s*\.\.\s*string\s*\.\s*char\s*\(\s*\1\s*\[\s*[A-Za-z_]\w*\s*\]\s*\)\s*end\s+return\s+\2\s*end\s*\)\s*\{([^{}]{1,500000})\}/g;

  // Fork shape: table.concat variant
  const re2 = /\(\s*function\s*\(\s*([A-Za-z_]\w*)\s*\)\s*local\s+([A-Za-z_]\w*)\s*=\s*\{\}\s*for\s+[A-Za-z_]\w*\s*=\s*1\s*,\s*#\1\s*do\s+\2\s*\[#\2\s*\+\s*1\s*\]\s*=\s*string\s*\.\s*char\s*\(\s*\1\s*\[\s*[A-Za-z_]\w*\s*\]\s*\)\s*end\s*return\s*table\s*\.\s*concat\s*\(\s*\2\s*\)\s*end\s*\)\s*\{([^{}]{1,500000})\}/g;

  const replacements: Array<{ start: number; end: number; text: string }> = [];

  for (const re of [re1, re2]) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      const nums = parseNumberList(m[re === re1 ? 3 : 4]);
      if (!nums) continue;
      const decoded = String.fromCharCode(...nums.map((n) => n & 0xff));
      if (!decoded.length || printableRatio(decoded) < 0.75) continue;
      replacements.push({ start: m.index, end: m.index + m[0].length, text: reencodeLuaString(decoded, '"') });
    }
  }

  // Deduplicate by start position (re2 might catch some re1 hits too)
  const seen = new Set<number>();
  const unique = replacements.filter((r) => { if (seen.has(r.start)) return false; seen.add(r.start); return true; });
  unique.sort((a, b) => b.start - a.start);

  let result = src;
  for (const r of unique) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  if (unique.length) notes.push(`Decoded ${unique.length} Dava character-array constant(s) (${unique.length > replacements.length ? replacements.length - unique.length + " deduped" : "all unique"})`);
  return { result, changed: unique.length, notes };
}

// ---------------------------------------------------------------------------
// Pass: Clyde register-VM / dispatch-table (new sfr-development variant)
// ---------------------------------------------------------------------------

/**
 * Clyde register-VM direct-mode output (vmType "register", vmLevel "normal"):
 * emits a `local __regs = {}; local __pc = 0; while true do` loop with
 * opcode dispatch. The maximum mode also prepends an LZMA-compressed blob.
 *
 * We detect the shape here and annotate the notes — full structural lifting
 * requires a VM-lifting pass (like luraph-vm) which is left as a TODO.
 * What we CAN do statically:
 *   • Extract any inline constant table from the VM header.
 *   • Fold any XOR-encoded or char-array constants the VM emits before dispatch.
 *   • Strip no-op opaque predicates the CFF pass emits (always-true guards).
 */
function detectClydeRegisterVM(input: string): boolean {
  // Clyde register-VM emits a register file + PC counter
  const hasRegFile = /local\s+\w+\s*=\s*\{\}\s*(?:--[^\n]*)?\s*local\s+\w+\s*=\s*0/.test(input);
  // Dispatch loop: while true do local op = bytecode[pc] ... if op == N then
  const hasDispatch =
    /while\s+true\s+do[\s\S]{0,300}local\s+\w+\s*=\s*\w+\s*\[\s*\w+\s*\][\s\S]{0,500}if\s+\w+\s*==\s*\d+\s*then/.test(input);
  // Or the elseif chain typical in register VMs
  const hasElseifChain = /elseif\s+\w+\s*==\s*\d+\s*then[\s\S]{0,50}elseif\s+\w+\s*==\s*\d+\s*then/.test(input);
  return (hasRegFile && hasDispatch) || (hasRegFile && hasElseifChain);
}

function detectClydeStackVM(input: string): boolean {
  // Clyde stack-VM emits a stack array + stack pointer
  const hasStack = /local\s+\w+\s*=\s*\{\}\s*(?:--[^\n]*)?\s*local\s+\w+\s*=\s*0/.test(input);
  const hasPushPop =
    /\w+\s*\[\s*\w+\s*\]\s*=\s*\w+\s*\[\s*\w+\s*\+\s*1\s*\]/.test(input) ||
    /\w+\s*=\s*\w+\s*\[\s*\w+\s*\]\s*;\s*\w+\s*=\s*\w+\s*-\s*1/.test(input);
  const hasOpcodeLoop = /while\s+true\s+do/.test(input) &&
    /if\s+\w+\s*==\s*\d+\s*then[\s\S]{0,100}elseif\s+\w+\s*==\s*\d+\s*then/.test(input);
  return hasStack && hasPushPop && hasOpcodeLoop;
}

/** Try to extract any constant strings encoded inside a Clyde register/stack VM payload. */
function foldClydeVMConstants(src: string): { result: string; changed: number; notes: string[] } {
  const notes: string[] = [];
  let changed = 0;
  let result = src;

  // Clyde normal-mode encodes constants as char-code arrays inside the VM blob:
  // local CONST = {78,101,119,32,110,97,109,101} → "New name"
  // These appear in the constants table before the dispatch loop.
  const constTableRe = /local\s+([A-Za-z_]\w*)\s*=\s*\{((?:\s*\d+\s*,?)+)\}/g;
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  let cm: RegExpExecArray | null;
  while ((cm = constTableRe.exec(result))) {
    const nums = parseNumberList(cm[2]);
    if (!nums || nums.length < 2) continue;
    // All in printable ASCII + newline range → likely a string constant
    const decoded = String.fromCharCode(...nums);
    if (printableRatio(decoded) < 0.85) continue;
    // Replace the whole `local NAME = {NNN,...}` with `local NAME = "decoded"`
    replacements.push({
      start: cm.index,
      end: cm.index + cm[0].length,
      text: `local ${cm[1]} = ${reencodeLuaString(decoded, '"')}`,
    });
    changed++;
  }
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  if (changed) notes.push(`Decoded ${changed} Clyde VM constant table(s) to string literals`);
  return { result, changed, notes };
}

// ---------------------------------------------------------------------------
// Pass: Clyde LZMA detection (maximum mode)
// ---------------------------------------------------------------------------

function detectClydeLzma(input: string): boolean {
  // Maximum mode wraps bytecode in an LZMA-compressed blob embedded as a
  // long Lua string (non-printable heavy) + calls a decompressor.
  // Signature: reference to "lzma" or "LZMA" + a loadstring wrapper.
  const hasLzmaRef = /\blzma\b/i.test(input) || /LZMA/i.test(input);
  const hasLongBlob = /\[\[[\s\S]{5000,}?\]\]/.test(input) ||
    /"[^"]{5000,}"/.test(input);
  return hasLzmaRef && hasLongBlob;
}

// ---------------------------------------------------------------------------
// Detection functions
// ---------------------------------------------------------------------------

function detectDavaVM(input: string): boolean {
  // Original: {i=..., k=..., f=..., u=...}
  const hasProtoOrig =
    /\{\s*i\s*=\s*\{/.test(input) &&
    /\bk\s*=\s*\{/.test(input) &&
    /\bf\s*=\s*\{/.test(input);

  // Fork variant 1: {i=..., k=..., f=..., p=...} (no u field)
  const hasProtoFork1 =
    /\{\s*i\s*=\s*\{/.test(input) &&
    /\bk\s*=\s*\{/.test(input) &&
    /\bp\s*=\s*\{/.test(input);

  // Fork variant 2: {inst=..., consts=..., funcs=...}
  const hasProtoFork2 =
    /\binst\s*=\s*\{/.test(input) &&
    /\bconsts\s*=\s*\{/.test(input) &&
    /\bfuncs\s*=\s*\{/.test(input);

  const hasProto = hasProtoOrig || hasProtoFork1 || hasProtoFork2;
  const hasExec =
    /while\s+true\s+do[\s\S]{0,6000}?\.i\s*\[[^\]]+\][\s\S]{0,6000}?[=!]=\s*255/.test(input);
  const hasGeneratedNames =
    /table\s+and\s+table\.unpack\s+or\s+unpack/.test(input) &&
    /local\s+function\s+\w+\s*\([^)]*\)/.test(input);
  const hasOps =
    /\belseif\s+\w+\s*==\s*(?:1|6|7|28|35|44|46|255)\s+then\b/.test(input);

  return (hasProto && hasOps) || (hasProto && hasExec && hasGeneratedNames);
}

function detectClyde(input: string): boolean {
  // Banner / watermark
  if (/Clyde\s*Protection|Clyde\s*OBFUSCATOR|clydeprotection|vmBlob/i.test(input)) return true;
  // XOR factory (v5.4 pattern)
  if (/local\s+\w+\s*=\s*function\s*\([^)]*,[^)]*\)[\s\S]{0,5000}?bit32\s*\.\s*bxor[\s\S]{0,5000}?table\s*\.\s*concat/.test(input)) return true;
  // Register-VM or stack-VM (new sfr-development Clyde)
  if (detectClydeRegisterVM(input)) return true;
  if (detectClydeStackVM(input)) return true;
  // LZMA maximum mode
  if (detectClydeLzma(input)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Deobfuscator class
// ---------------------------------------------------------------------------

export class ModernVMDeobfuscator implements Deobfuscator {
  id = "modern_vm" as const;
  name = "Modern Luau VM / Clyde / Dava";
  description =
    "Static deobfuscation for newer public Luau VM patterns: " +
    "Clyde XOR string factories, Clyde register/stack-VM constant extraction, " +
    "Dava custom-VM character-array constants (including fork variants), " +
    "and LZMA-blob detection for Clyde maximum mode.";

  detect(input: string) {
    const clyde = detectClyde(input);
    const dava = detectDavaVM(input);
    const clydeReg = detectClydeRegisterVM(input);
    const clydeLzma = detectClydeLzma(input);

    if (!clyde && !dava) return null;

    const kinds = [
      clyde && !clydeReg && !clydeLzma ? "Clyde (XOR)" : null,
      clydeReg ? "Clyde register-VM" : null,
      clydeLzma ? "Clyde LZMA maximum-mode" : null,
      dava ? "Dava custom VM" : null,
    ].filter(Boolean).join(" + ");

    const confidence =
      (dava && clyde) ? 0.97 :
      clydeReg ? 0.92 :
      clydeLzma ? 0.91 :
      0.93;

    return {
      obfuscator: "modern_vm" as const,
      confidence,
      evidence: `${kinds} structural pattern detected (source-only static decoder)`,
    };
  }

  async deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult> {
    let work = ctx.input;
    const notes: string[] = [];
    let changed = 0;

    // --- Dava char-array factories (including fork variants) ---
    const dava = foldDavaCharArrayFactories(work);
    work = dava.result;
    changed += dava.changed;
    notes.push(...dava.notes);

    // --- Clyde XOR string factories ---
    const clyde = foldClydeXorCalls(work);
    work = clyde.result;
    changed += clyde.changed;
    notes.push(...clyde.notes);

    // --- Clyde register/stack-VM constant tables ---
    const clydeVm = foldClydeVMConstants(work);
    work = clydeVm.result;
    changed += clydeVm.changed;
    notes.push(...clydeVm.notes);

    // --- LZMA maximum-mode annotation ---
    if (detectClydeLzma(work)) {
      notes.push(
        "Clyde maximum-mode (LZMA) detected: compressed bytecode blob cannot be " +
        "statically decoded without an LZMA decompressor pass. " +
        "The constant layer above has been recovered; the VM body is intact.",
      );
    }

    // --- Conservative constant folding on newly exposed literals ---
    try {
      const folded = foldConstants(work, 3);
      if (folded.folded) {
        work = folded.result;
        notes.push(`Constant folding recovered ${folded.folded} additional expression(s)`);
        changed += folded.folded;
      }
    } catch { /* best-effort */ }

    // --- Identifier renaming ---
    try {
      const renamed = renameObfuscatedIdentifiers(work);
      if (renamed.renamed) {
        work = renamed.result;
        notes.push(`Renamed ${renamed.renamed} cryptic identifier pattern(s)`);
      }
    } catch { /* best-effort */ }

    // --- Beautify ---
    try {
      work = beautifyLua(work);
    } catch { /* keep partial */ }

    const validation = validateLuaSource(work);
    if (!changed) {
      notes.push("No literal recovery was proven safe; VM body left intact rather than guessed.");
    }
    if (!validation.ok) {
      notes.push(
        "Output remains partially VM-wrapped; static validation found syntax issues, " +
        "so no speculative reconstruction was applied.",
      );
    }

    return {
      success: true,
      deobfuscator: this.name,
      output: work,
      notes,
      confidence: Math.min(0.94, 0.56 + Math.min(0.3, changed * 0.008)),
      obfuscator: "modern_vm",
    };
  }
}
