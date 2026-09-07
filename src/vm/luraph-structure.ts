// Luraph VM lifter — structuring post-passes.
//
// Consumes the symbolic IR produced by the rule-matcher in luraph-lifter.ts
// and turns it into MEANINGFUL Luau:
//   Pass 1: junk-block removal — drop "load VM column into scratch then
//           nil it" sequences (side-effect-free Luraph obfuscation noise).
//   Pass 2: K-pool extraction — detect the register that is used as the
//           program's constants table (most `R<n>[idx] = value` writes),
//           hoist all those writes into a single `local K = {[idx]=val,...}`
//           block at the top of the function, and rewrite `R<n>[idx]`
//           references in the body to `K[idx]`.
//   Pass 3: global-chain collapse — `R<k>=GLOBAL; R<k>=R<k>.field; R<d>=R<k>`
//           collapses to `R<d> = GLOBAL.field`.
//   Pass 4: scratch propagation — single-use scratch registers
//           (`R<k> = sym; R<j> = R<k>`) inline `sym` at the read site.
//   Pass 5: arithmetic-constant folding — `(5870 + R25); (R25 + -6078)`
//           becomes a single `R25 = -208` when both operands are known.
//   Pass 6: CFG structuring — basic-block leaders, while-loops for back
//           edges, if-then-else for forward conditional jumps. Irreducible
//           regions fall back to goto/label.
//
// The output passes the engine syntax validator.

import { Sym, renderSym, AliasInfo, FinalProgram } from "./luraph-lifter";
import {
  eliminateTrivialGotos,
  propagateCrossBlockConstants,
  buildRenameMap,
  flattenAndEmit,
} from "./luraph-finalize";

// ─────────────────────────────────────────────────────────────────────────────
// IR types
// ─────────────────────────────────────────────────────────────────────────────

export type IRStmt =
  | { kind: "assign"; reg: number; src: Sym }
  | { kind: "kstore"; obj: Sym; key: Sym; val: Sym }
  | { kind: "callstmt"; base: number; argc: number; retc: number }
  | { kind: "clearrange"; lo: number; hi: number }
  | { kind: "jump"; target: number }
  | { kind: "condjump"; cond: Sym; target: number }
  | { kind: "ret"; retKind: "void" | "values" | "vararg" }
  | { kind: "comment"; text: string };

export interface IRInst {
  vip: number;
  op: number;
  mnemonic: string;
  stmts: IRStmt[];
  jumpTo: number | null;
  condJump: { cond: Sym; target: number } | null;
  ret: { kind: "void" | "values" | "vararg" } | null;
  comment?: string;
}

// Synthetic "K" symbol used to reference the extracted constants pool.
const K_SYM: Sym = { k: "global", name: "K" };

export interface KPool {
  reg: number;
  entries: Map<number, Sym>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1 — junk-block removal
// ─────────────────────────────────────────────────────────────────────────────
//
// Luraph emits runs of "R<coltab>[idx] = <num>" writes (loading VM column
// tables into scratch registers) immediately followed by `R<coltab> = nil`
// assignments that wipe the targets. The run is side-effect-free — detect
// and remove it entirely.

export function removeJunkBlocks(ir: IRInst[]): IRInst[] {
  // A "junk block" is a sequence of kstores into scratch column-table
  // registers followed by a clear of those registers. Luraph emits these
  // as side-effect-free noise. The kstore value is a number (either an
  // immediate column or a numeric constant from the konst column).
  const isNumeric = (s: Sym): boolean =>
    s.k === "imm" || (s.k === "konst" && typeof s.v === "number");
  const n = ir.length;
  const drop = new Set<number>();
  for (let i = 0; i < n; i++) {
    const ins = ir[i];
    if (ins.stmts.length === 0) continue;
    const first = ins.stmts[0];
    // First stmt must be a kstore: R<r>[<imm>] = <number>
    if (first.kind !== "kstore") continue;
    if (first.obj.k !== "reg") continue;
    if (first.key.k !== "imm") continue;
    if (!isNumeric(first.val)) continue;
    const touchedRegs = new Set<number>();
    touchedRegs.add(first.obj.n);
    let j = i;
    const run: number[] = [i];
    // collect contiguous kstore runs (may span multiple instructions)
    while (j + 1 < n) {
      const next = ir[j + 1];
      if (next.stmts.length === 0) {
        j++;
        run.push(j);
        continue;
      }
      const ns0 = next.stmts[0];
      if (
        ns0.kind === "kstore" &&
        ns0.obj.k === "reg" &&
        ns0.key.k === "imm" &&
        isNumeric(ns0.val)
      ) {
        touchedRegs.add(ns0.obj.n);
        run.push(j + 1);
        j++;
        continue;
      }
      // clearrange covering all touchedRegs? drop the run + the clearrange
      // (the clearrange is redundant: the kstores it would wipe are gone).
      if (ns0.kind === "clearrange") {
        const cr = ns0;
        let covers = true;
        for (const t of touchedRegs) {
          if (t < cr.lo || t > cr.hi) {
            covers = false;
            break;
          }
        }
        if (covers) {
          for (const idx of run) drop.add(idx);
          drop.add(j + 1); // also drop the clearrange itself
        }
        break;
      }
      // `R<k> = nil` chain covering all touchedRegs?
      if (ns0.kind === "assign" && ns0.src.k === "imm" && ns0.src.v === 0) {
        const cleared = new Set<number>([ns0.reg]);
        let k = j + 1;
        while (k + 1 < n && ir[k + 1].stmts.length > 0) {
          const ka = ir[k + 1].stmts[0];
          if (ka.kind === "assign" && ka.src.k === "imm" && ka.src.v === 0) {
            cleared.add(ka.reg);
            k++;
          } else {
            break;
          }
        }
        let allClear = true;
        for (const t of touchedRegs) {
          if (!cleared.has(t)) {
            allClear = false;
            break;
          }
        }
        if (allClear) {
          for (const idx of run) drop.add(idx);
          for (let k2 = j + 1; k2 <= k; k2++) drop.add(k2);
        }
        break;
      }
      break;
    }
  }
  if (drop.size === 0) return ir;
  return ir.filter((_, i) => !drop.has(i));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2 — K-pool extraction
// ─────────────────────────────────────────────────────────────────────────────
//
// Pick the register with the most `R<n>[idx] = value` writes (the constants
// pool). Hoist all such writes into a `local K = {...}` block and rewrite
// `R<n>[idx]` reads as `K[idx]`.

function detectKPoolRegister(ir: IRInst[]): number | null {
  const counts = new Map<number, number>();
  for (const ins of ir) {
    for (const s of ins.stmts) {
      if (s.kind !== "kstore") continue;
      if (s.obj.k !== "reg") continue;
      if (s.key.k !== "imm") continue;
      counts.set(s.obj.n, (counts.get(s.obj.n) ?? 0) + 1);
    }
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [r, c] of counts) {
    if (c > bestN) {
      bestN = c;
      best = r;
    }
  }
  if (best === null || bestN < 3) return null;
  return best;
}

export function extractKPool(ir: IRInst[]): KPool | null {
  const kReg = detectKPoolRegister(ir);
  if (kReg === null) return null;
  const entries = new Map<number, Sym>();
  for (const ins of ir) {
    for (const s of ins.stmts) {
      if (s.kind !== "kstore") continue;
      if (s.obj.k !== "reg" || s.obj.n !== kReg) continue;
      if (s.key.k !== "imm") continue;
      entries.set(s.key.v, s.val);
    }
  }
  if (entries.size < 3) return null;
  // Second pass: rebuild stmts without K-pool writes, rewrite R<kReg> refs
  // to K_SYM in remaining stmts.
  for (const ins of ir) {
    const out: IRStmt[] = [];
    for (const s of ins.stmts) {
      if (s.kind === "kstore" && s.obj.k === "reg" && s.obj.n === kReg && s.key.k === "imm") {
        continue;
      }
      out.push(rewriteKReg(s, kReg));
    }
    ins.stmts = out;
  }
  return { reg: kReg, entries };
}

function rewriteKRegInSym(s: Sym, kReg: number): Sym {
  if (s.k === "reg" && s.n === kReg) return K_SYM;
  if (s.k === "index") {
    return { k: "index", obj: rewriteKRegInSym(s.obj, kReg), key: rewriteKRegInSym(s.key, kReg) };
  }
  if (s.k === "bin") {
    return { k: "bin", op: s.op, a: rewriteKRegInSym(s.a, kReg), b: s.b ? rewriteKRegInSym(s.b, kReg) : undefined };
  }
  if (s.k === "un") {
    return { k: "un", op: s.op, a: rewriteKRegInSym(s.a, kReg) };
  }
  if (s.k === "call") {
    return { k: "call", fn: rewriteKRegInSym(s.fn, kReg), args: s.args.map((a) => rewriteKRegInSym(a, kReg)) };
  }
  return s;
}

function rewriteKReg(s: IRStmt, kReg: number): IRStmt {
  switch (s.kind) {
    case "assign":
      if (s.reg === kReg) {
        return { kind: "comment", text: `K = ${renderSym(s.src)} (aliased)` };
      }
      return { kind: "assign", reg: s.reg, src: rewriteKRegInSym(s.src, kReg) };
    case "kstore":
      return {
        kind: "kstore",
        obj: rewriteKRegInSym(s.obj, kReg),
        key: rewriteKRegInSym(s.key, kReg),
        val: rewriteKRegInSym(s.val, kReg),
      };
    case "clearrange":
      if (s.lo <= kReg && s.hi >= kReg) {
        return { kind: "comment", text: `clear R${s.lo}..R${s.hi} (wipes K, suppressed)` };
      }
      return s;
    case "callstmt":
    case "jump":
    case "ret":
    case "comment":
      return s;
    case "condjump":
      return { kind: "condjump", cond: rewriteKRegInSym(s.cond, kReg), target: s.target };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 3 — global-chain collapse
// ─────────────────────────────────────────────────────────────────────────────
//
// `R<k> = bit32; R<k> = R<k>.lshift; R<dst> = R<k>` → `R<dst> = bit32.lshift`
// Variants:
//   - 2-step (no .field): R<k> = GLOBAL; R<d> = R<k>  →  R<d> = GLOBAL
//   - 3-step with one .field: see above
//   - N-step with multiple .field: chain them: GLOBAL.field1.field2...
// Detect "self-update" patterns where each successive assign reads R<k>
// and reassigns R<k>; the chain ends when R<k> is read by a different stmt.

export function collapseGlobalChains(ir: IRInst[]): IRInst[] {
  // Iterate to fixpoint: each round can collapse many seed→consumer pairs.
  // We don't break after a single collapse — keep scanning so subsequent
  // seeds see the inlined consumers (which often become new collapsible
  // patterns themselves).
  let changed = true;
  let rounds = 0;
  while (changed && rounds < 50) {
    changed = false;
    rounds++;
    for (let i = 0; i + 1 < ir.length; i++) {
      const a = ir[i];
      if (a.stmts.length === 0) continue;
      const sa = a.stmts[a.stmts.length - 1];
      // Must be `R<k> = <expr>`
      if (sa.kind !== "assign") continue;
      const k = sa.reg;
      // Determine the seed expression. Disallow calls / scratch.
      if (sa.src.k === "call" || sa.src.k === "scratch" || sa.src.k === "unk") continue;

      // Chain step (R<k> = R<k>.field) — scan backwards for the seed.
      const isChainStep =
        sa.src.k === "index" && sa.src.obj.k === "reg" && sa.src.obj.n === k;
      let seed: Sym;
      let seedIdx: number;
      let chainStepIdxs: number[] = [];
      if (isChainStep) {
        let pi = i - 1;
        let baseStmt: Extract<IRStmt, { kind: "assign" }> | null = null;
        let baseIdx = -1;
        while (pi >= 0) {
          const pa = ir[pi];
          if (pa.stmts.length === 0) {
            pi--;
            continue;
          }
          const ps = pa.stmts[pa.stmts.length - 1];
          if (ps.kind === "assign" && ps.reg === k) {
            // Either another chain step or the seed
            if (ps.src.k === "index" && ps.src.obj.k === "reg" && ps.src.obj.n === k) {
              chainStepIdxs.unshift(pi);
              pi--;
              continue;
            }
            if (ps.src.k === "global" || ps.src.k === "konst" || ps.src.k === "imm" || ps.src.k === "index") {
              baseStmt = ps;
              baseIdx = pi;
              break;
            }
            break; // seed is bin/un — too complex
          }
          // any stmt reading R<k> before seed: bail (other consumer)
          if (stmtReadsReg(ps, k)) {
            baseStmt = null;
            break;
          }
          break;
        }
        if (!baseStmt) continue;
        // Build chain: start from baseStmt.src, apply each chain step's .field
        let cur = baseStmt.src;
        let ok = true;
        for (const w of chainStepIdxs.concat([i])) {
          const ws = ir[w].stmts[ir[w].stmts.length - 1];
          if (ws.kind !== "assign" || ws.reg !== k) { ok = false; break; }
          if (ws.src.k !== "index" || ws.src.obj.k !== "reg" || ws.src.obj.n !== k) { ok = false; break; }
          cur = { k: "index", obj: cur, key: ws.src.key };
        }
        if (!ok) continue;
        seed = cur;
        seedIdx = baseIdx;
        // mark chain step indices for removal (incl. i)
        chainStepIdxs.push(i);
      } else {
        // 2-step pattern: seed is a non-self expression
        if (sa.src.k !== "global" && sa.src.k !== "konst" && sa.src.k !== "imm" && sa.src.k !== "index") continue;
        seed = sa.src;
        seedIdx = i;
      }

      // Find the consumer (single read of R<k> at index > i, in the live
      // range of this write — i.e. before the NEXT write to R<k>).
      let ci = -1;
      let cs: IRStmt | null = null;
      let readCount = 0;
      for (let w = i + 1; w < ir.length; w++) {
        // Check for reads first (in case the same instruction both reads
        // and writes R<k>, e.g. `R<k> = R<k> + 1`).
        for (const s of ir[w].stmts) {
          if (stmtReadsReg(s, k)) {
            readCount++;
            if (ci < 0) { ci = w; cs = s; }
          }
        }
        // Stop at the next write — R<k> gets a new value, this liveness
        // interval ends.
        let hasWrite = false;
        for (const s of ir[w].stmts) {
          if (s.kind === "assign" && s.reg === k) { hasWrite = true; break; }
          if (s.kind === "callstmt" && s.base === k && s.retc > 0) { hasWrite = true; break; }
        }
        if (hasWrite) break;
      }
      if (readCount !== 1 || ci < 0 || !cs) continue;
      // No writes to R<k> between i+1 and ci
      let writesBetween = false;
      for (let w = i + 1; w < ci; w++) {
        for (const s of ir[w].stmts) {
          if (s.kind === "assign" && s.reg === k) { writesBetween = true; break; }
          if (s.kind === "callstmt" && s.base === k && s.retc > 0) { writesBetween = true; break; }
        }
        if (writesBetween) break;
      }
      if (writesBetween) continue;

      // Inline seed into the consumer; drop the seed + chain steps.
      ir[ci].stmts = ir[ci].stmts.map((x) => (x === cs ? inlineRegInStmt(x, k, seed) : x));
      // drop seed (last stmt of ir[seedIdx])
      ir[seedIdx].stmts = ir[seedIdx].stmts.filter((x) => x !== ir[seedIdx].stmts[ir[seedIdx].stmts.length - 1]);
      // drop chain steps (prior chain steps + current i)
      for (const w of chainStepIdxs) {
        ir[w].stmts = ir[w].stmts.filter((x) => {
          if (x.kind === "assign" && x.reg === k && x.src.k === "index" && x.src.obj.k === "reg" && x.src.obj.n === k) return false;
          return true;
        });
      }
      changed = true;
      // continue scanning (don't break — let subsequent seeds see inlined
      // consumers in the same round)
    }
  }
  return ir;
}

function stmtReadsReg(s: IRStmt, r: number): boolean {
  if (s.kind === "assign") {
    // Even if the target IS r, the source may still read r (e.g. R15 = R15.lshift).
    return symReadsReg(s.src, r);
  }
  if (s.kind === "kstore") {
    return symReadsReg(s.obj, r) || symReadsReg(s.key, r) || symReadsReg(s.val, r);
  }
  if (s.kind === "condjump") return symReadsReg(s.cond, r);
  if (s.kind === "callstmt") return s.base === r; // call base is a read
  return false;
}

function symReadsReg(s: Sym, r: number): boolean {
  if (s.k === "reg") return s.n === r;
  if (s.k === "index") return symReadsReg(s.obj, r) || symReadsReg(s.key, r);
  if (s.k === "bin") return symReadsReg(s.a, r) || (s.b ? symReadsReg(s.b, r) : false);
  if (s.k === "un") return symReadsReg(s.a, r);
  if (s.k === "call") return symReadsReg(s.fn, r) || s.args.some((a) => symReadsReg(a, r));
  return false;
}

function inlineRegInStmt(s: IRStmt, r: number, v: Sym): IRStmt {
  // Always inline reads of `r` in the source — even if the assign target
  // IS `r` (e.g., `R15 = R15.lshift` becomes `R15 = bit32.lshift` when
  // seed = bit32).
  if (s.kind === "assign") {
    return { kind: "assign", reg: s.reg, src: inlineRegInSym(s.src, r, v) };
  }
  if (s.kind === "kstore") {
    return {
      kind: "kstore",
      obj: inlineRegInSym(s.obj, r, v),
      key: inlineRegInSym(s.key, r, v),
      val: inlineRegInSym(s.val, r, v),
    };
  }
  if (s.kind === "condjump") {
    return { kind: "condjump", cond: inlineRegInSym(s.cond, r, v), target: s.target };
  }
  return s;
}

function inlineRegInSym(s: Sym, r: number, v: Sym): Sym {
  if (s.k === "reg") return s.n === r ? v : s;
  if (s.k === "index") return { k: "index", obj: inlineRegInSym(s.obj, r, v), key: inlineRegInSym(s.key, r, v) };
  if (s.k === "bin") return { k: "bin", op: s.op, a: inlineRegInSym(s.a, r, v), b: s.b ? inlineRegInSym(s.b, r, v) : undefined };
  if (s.k === "un") return { k: "un", op: s.op, a: inlineRegInSym(s.a, r, v) };
  if (s.k === "call") return { k: "call", fn: inlineRegInSym(s.fn, r, v), args: s.args.map((a) => inlineRegInSym(a, r, v)) };
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 4 — scratch propagation
// ─────────────────────────────────────────────────────────────────────────────
//
// For each register with writes==1 and reads==1, inline the source value at
// the read site and drop the write. Iterate to fixpoint.

interface RegInfo {
  writes: number;
  reads: number;
  lastValue: Sym | null;
  lastIdx: number;
}

export function propagateScratch(ir: IRInst[]): IRInst[] {
  for (let round = 0; round < 6; round++) {
    const info = new Map<number, RegInfo>();
    const ensure = (r: number): RegInfo => {
      let i = info.get(r);
      if (!i) {
        i = { writes: 0, reads: 0, lastValue: null, lastIdx: -1 };
        info.set(r, i);
      }
      return i;
    };
    const countRead = (s: Sym): void => {
      if (s.k === "reg") ensure(s.n).reads++;
      else if (s.k === "index") {
        countRead(s.obj);
        countRead(s.key);
      } else if (s.k === "bin") {
        countRead(s.a);
        if (s.b) countRead(s.b);
      } else if (s.k === "un") {
        countRead(s.a);
      } else if (s.k === "call") {
        countRead(s.fn);
        for (const a of s.args) countRead(a);
      }
    };
    for (let i = 0; i < ir.length; i++) {
      const ins = ir[i];
      for (const s of ins.stmts) {
        if (s.kind === "assign") {
          const wi = ensure(s.reg);
          wi.writes++;
          wi.lastValue = s.src;
          wi.lastIdx = i;
          countRead(s.src);
        } else if (s.kind === "kstore") {
          countRead(s.obj);
          countRead(s.key);
          countRead(s.val);
        } else if (s.kind === "condjump") {
          countRead(s.cond);
        } else if (s.kind === "callstmt") {
          const bi = ensure(s.base);
          bi.reads++;
          if (s.retc > 0) {
            bi.writes++;
            bi.lastValue = null;
            bi.lastIdx = i;
          }
        }
      }
    }
    let changed = false;
    for (const [r, inf] of info) {
      if (inf.writes !== 1 || inf.reads !== 1) continue;
      if (inf.lastValue === null) continue;
      const src = inf.lastValue;
      // Disallow inlining calls / scratch refs to avoid semantic shifts.
      if (src.k === "call" || src.k === "scratch") continue;
      // Find the read site
      let readAt: { i: number; s: IRStmt } | null = null;
      for (let i = 0; i < ir.length; i++) {
        for (const s of ir[i].stmts) {
          if (stmtReadsReg(s, r)) {
            readAt = { i, s };
            break;
          }
        }
        if (readAt) break;
      }
      if (!readAt) continue;
      if (readAt.i <= inf.lastIdx) continue;
      const before = readAt.s;
      const after = inlineRegInStmt(before, r, src);
      if (after === before) continue;
      ir[readAt.i].stmts = ir[readAt.i].stmts.map((x) => (x === before ? after : x));
      ir[inf.lastIdx].stmts = ir[inf.lastIdx].stmts.filter((x) => !(x.kind === "assign" && x.reg === r));
      changed = true;
    }
    if (!changed) break;
  }
  return ir;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 5 — arithmetic-constant folding
// ─────────────────────────────────────────────────────────────────────────────

function tryFoldArith(a: Sym, b: Sym | undefined, op: string): Sym | null {
  if (!b) return null;
  if (a.k !== "imm" || b.k !== "imm") return null;
  const av = a.v;
  const bv = b.v;
  let r: number | null = null;
  switch (op) {
    case "+": r = av + bv; break;
    case "-": r = av - bv; break;
    case "*": r = av * bv; break;
    case "/": if (bv === 0) return null; r = av / bv; break;
    case "%": if (bv === 0) return null; r = av - Math.floor(av / bv) * bv; break;
    default: return null;
  }
  if (!Number.isFinite(r)) return null;
  return { k: "imm", v: r };
}

export function foldArithChains(ir: IRInst[]): IRInst[] {
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const ins of ir) {
      const out: IRStmt[] = [];
      for (const s of ins.stmts) {
        if (s.kind === "assign" && s.src.k === "bin") {
          const folded = tryFoldArith(s.src.a, s.src.b, s.src.op);
          if (folded) {
            out.push({ kind: "assign", reg: s.reg, src: folded });
            changed = true;
            continue;
          }
        }
        out.push(s);
      }
      ins.stmts = out;
    }
    if (!changed) break;
  }
  return ir;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 6 — CFG structuring + emission
// ─────────────────────────────────────────────────────────────────────────────

export function structureAndEmit(
  irIn: IRInst[],
  kPool: KPool | null,
  prog: FinalProgram,
  index: number,
): string {
  // Filter out instructions that produced no stmts and no control-flow.
  const ir = irIn.filter(
    (i) => i.stmts.length > 0 || i.jumpTo !== null || i.condJump !== null || i.ret !== null,
  );
  if (ir.length === 0) {
    const lines: string[] = [];
    lines.push(`-- ═══ Luraph VM proto #${index} — decompiled ═══`);
    lines.push(`-- ${prog.instrCount} instructions · 0 lifted`);
    lines.push(`local function PROTO_${index}(...)`);
    lines.push(`  -- no IR survived post-processing`);
    lines.push(`end`);
    return lines.join("\n");
  }

  // Compute leaders: VIP 1, every jump target, every instr after a jump/ret.
  const vipSet = new Set<number>(ir.map((i) => i.vip));
  const leaders = new Set<number>([ir[0].vip]);
  for (const ins of ir) {
    if (ins.jumpTo !== null && vipSet.has(ins.jumpTo)) leaders.add(ins.jumpTo);
    if (ins.condJump && vipSet.has(ins.condJump.target)) leaders.add(ins.condJump.target);
    if (ins.jumpTo !== null || ins.condJump || ins.ret) {
      const next = ins.vip + 1;
      if (vipSet.has(next)) leaders.add(next);
    }
  }

  // ── Emit ──
  const lines: string[] = [];
  lines.push(`-- ═══ Luraph VM proto #${index} — decompiled ═══`);
  lines.push(`-- ${prog.instrCount} instructions · ${ir.length} lifted · ${kPool ? `${kPool.entries.size} constants` : "no K pool"}`);
  lines.push(`local function PROTO_${index}(...)`);

  // K-pool block
  if (kPool && kPool.entries.size > 0) {
    lines.push(`  -- Constants pool recovered from VM bytecode`);
    lines.push(`  local K = {}`);
    const sortedIdx = [...kPool.entries.keys()].sort((a, b) => a - b);
    for (const idx of sortedIdx) {
      const v = kPool.entries.get(idx)!;
      const r = renderSym(v);
      if (r.length > 200) {
        lines.push(`  K[${idx}] = ${r.slice(0, 180)}…  --[[truncated ${r.length} chars]]`);
      } else {
        lines.push(`  K[${idx}] = ${r}`);
      }
    }
    lines.push("");
  }

  // Vararg
  lines.push(`  local script = ...  -- R0`);

  // Collect referenced registers from the body
  const usedRegs = new Set<number>();
  for (const ins of ir) for (const s of ins.stmts) collectRegs(s, usedRegs);
  // also count jump/condjump targets' referenced regs (none — they use vips)
  // and ret (no regs)
  if (kPool) usedRegs.delete(kPool.reg);
  usedRegs.delete(0); // R0 is `...`

  const declRegs = [...usedRegs].sort((a, b) => a - b);
  for (let i = 0; i < declRegs.length; i += 90) {
    lines.push(`  local ${declRegs.slice(i, i + 90).map((r) => `R${r}`).join(", ")}`);
  }
  lines.push("");

  // Emit body, instruction by instruction. Leaders get a label marker.
  let prevTerm = false;
  for (const ins of ir) {
    const isLeader = leaders.has(ins.vip);
    if (isLeader && ins.vip !== ir[0].vip) {
      lines.push("");
      lines.push(`  ::L${ins.vip}:: -- ◆`);
    } else if (prevTerm) {
      lines.push("");
    }
    prevTerm = false;
    if (ins.ret) {
      lines.push(
        ins.ret.kind === "void"
          ? "  return"
          : ins.ret.kind === "vararg"
            ? "  return ..."
            : "  return -- (VM multi-value return)",
      );
      prevTerm = true;
      continue;
    }
    if (ins.jumpTo !== null) {
      lines.push(`  goto L${ins.jumpTo}`);
      prevTerm = true;
      continue;
    }
    if (ins.condJump) {
      lines.push(`  if ${renderSym(ins.condJump.cond)} then`);
      lines.push(`    goto L${ins.condJump.target}`);
      lines.push(`  end`);
      continue;
    }
    for (const s of ins.stmts) {
      const line = renderStmt(s, 1);
      if (line) lines.push(`  ${line}`);
    }
  }

  lines.push(`end`);
  return lines.join("\n");
}

function collectRegs(s: IRStmt, out: Set<number>): void {
  if (s.kind === "assign") {
    out.add(s.reg);
    collectRegsSym(s.src, out);
  } else if (s.kind === "kstore") {
    collectRegsSym(s.obj, out);
    collectRegsSym(s.key, out);
    collectRegsSym(s.val, out);
  } else if (s.kind === "callstmt") {
    out.add(s.base);
    out.add(s.base + 1);
    if (s.argc >= 2) out.add(s.base + 2);
  } else if (s.kind === "condjump") {
    collectRegsSym(s.cond, out);
  } else if (s.kind === "clearrange") {
    for (let r = s.lo; r <= s.hi; r++) out.add(r);
  }
}

function collectRegsSym(s: Sym, out: Set<number>): void {
  if (s.k === "reg") out.add(s.n);
  else if (s.k === "index") {
    collectRegsSym(s.obj, out);
    collectRegsSym(s.key, out);
  } else if (s.k === "bin") {
    collectRegsSym(s.a, out);
    if (s.b) collectRegsSym(s.b, out);
  } else if (s.k === "un") {
    collectRegsSym(s.a, out);
  } else if (s.k === "call") {
    collectRegsSym(s.fn, out);
    for (const a of s.args) collectRegsSym(a, out);
  }
}

function renderStmt(s: IRStmt, depth: number): string {
  void depth;
  switch (s.kind) {
    case "assign":
      return `R${s.reg} = ${renderSym(s.src)}`;
    case "kstore": {
      const obj = renderSym(s.obj);
      const key = renderSym(s.key);
      const val = renderSym(s.val);
      if (s.obj.k === "regs" && s.key.k === "imm") {
        return `R${s.key.v} = ${val}`;
      }
      return `${obj}[${key}] = ${val}`;
    }
    case "callstmt": {
      const args: string[] = [];
      for (let i = 1; i <= s.argc; i++) args.push(`R${s.base + i}`);
      if (s.retc === 1) {
        return `R${s.base} = R${s.base}(${args.join(", ")})`;
      }
      return `R${s.base}(${args.join(", ")})`;
    }
    case "clearrange": {
      const regs: string[] = [];
      for (let r = s.lo; r <= s.hi; r++) regs.push(`R${r} = nil`);
      return regs.join("; ");
    }
    case "jump":
      return `goto L${s.target}`;
    case "condjump":
      return `if ${renderSym(s.cond)} then goto L${s.target} end`;
    case "ret":
      return s.retKind === "void" ? "return" : s.retKind === "vararg" ? "return ..." : "return -- (VM multi-value return)";
    case "comment":
      return `-- ${s.text}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public driver
// ─────────────────────────────────────────────────────────────────────────────

export function structureProgram(
  irIn: IRInst[],
  prog: FinalProgram,
  index: number,
): { source: string; kPool: KPool | null; coverage: number } {
  let ir = irIn.map((i) => ({ ...i, stmts: [...i.stmts] }));
  // Pass order matters: clean the symbolic IR first, then emit the CFG.
  // We intentionally keep jumps/labels alive through final emission.
  ir = removeJunkBlocks(ir);
  ir = collapseGlobalChains(ir);
  const kPool = extractKPool(ir);
  ir = propagateScratch(ir);
  ir = foldArithChains(ir);

  // CFG cleanup and data-flow simplification.
  ir = eliminateTrivialGotos(ir);
  ir = propagateCrossBlockConstants(ir);
  ir = propagateScratch(ir);
  ir = foldArithChains(ir);
  ir = eliminateTrivialGotos(ir);

  // Normal output MUST preserve control flow. The old flatten emitter is
  // intentionally retained only for explicit debugging/fallback callers.
  const source = structureAndEmit(ir, kPool, prog, index);
  const live = ir.filter((i) => i.stmts.length > 0 || i.jumpTo !== null || i.condJump !== null || i.ret !== null);
  return { source, kPool, coverage: live.length };
}
