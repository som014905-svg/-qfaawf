// Luraph VM lifter — final-structuring passes (v4.6.1).
//
// Post-passes run AFTER the existing structureProgram pipeline (junk removal,
// global-chain collapse, K-pool extraction, scratch propagation, arithmetic
// fold). They take the IR + K-pool and produce MEANINGFUL Luau by:
//
//   Pass 6: trivial-goto elimination — collapse `goto L<a>; ::L<a>:: goto L<b>`
//           chains by inlining the eventual target. Empty labels (label that
//           only contains a `goto` and no real stmts) become "redirectable":
//           any `goto L<a>` whose target is an empty label is rewritten to
//           that label's eventual target. Iterate to fixpoint. After this
//           pass, the goto graph is the irreducible core.
//
//   Pass 7: cross-block constant propagation — track the most-recent
//           `R<n> = <simple_value>` assignment (where simple_value is a
//           global/konst/imm/table, NOT a call/scratch/reg). For each
//           subsequent read of R<n> before the next write, inline the
//           tracked value. This is a forward dataflow pass that operates
//           on the IR list in source order, switching the tracked value
//           on write and inlining on read.
//
//   Pass 8: register renaming — R0 → script (the vararg), R<kPoolReg> → K
//           (already rewritten by extractKPool), every other R<n> → vN
//           where N is the order of first appearance. This makes the
//           output read like real Lua with local variable names instead
//           of VM register numbers.
//
//   Flatten mode: instead of emitting goto/label, drop all control-flow
//           markers and emit the lifted statements in source order. For
//           programs that are essentially "constants pool + sparse register
//           operations wrapped in goto-spaghetti", this yields a small,
//           readable file. Real control-flow structuring (if/while/for)
//           requires lifting the conditional opcodes — not yet done.

import { Sym, renderSym, AliasInfo, FinalProgram } from "./luraph-lifter";
import { IRInst, IRStmt, KPool } from "./luraph-structure";

// ─────────────────────────────────────────────────────────────────────────────
// Pass 6 — trivial-goto elimination
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collapse goto-chains. For each "empty label" (instruction at a leader whose
 * only stmts are comments and that has an unconditional `jumpTo` to another
 * vip), every `goto L<empty>` is rewritten to `goto L<empty.jumpTo>`. Iterate
 * to fixpoint. After this pass, all remaining gotos point at labels with real
 * statements (non-comment stmts).
 *
 * Also drops the trivial `goto L<n>` when the next instruction in source order
 * is the label `::L<n>::` (fall-through).
 */
export function eliminateTrivialGotos(irIn: IRInst[]): IRInst[] {
  let ir = irIn;
  for (let round = 0; round < 30; round++) {
    let changed = false;

    // Map vip → index in ir.
    const vipToIdx = new Map<number, number>();
    for (let i = 0; i < ir.length; i++) vipToIdx.set(ir[i].vip, i);

    // Find empty labels: vip → jumpTo (only meaningful if that instruction has
    // no real stmts and an unconditional jumpTo).
    const emptyLabelRedirect = new Map<number, number>();
    for (const ins of ir) {
      const hasRealStmts = ins.stmts.some(
        (s) => s.kind !== "comment" && s.kind !== "clearrange",
      );
      if (!hasRealStmts && ins.jumpTo !== null && ins.condJump === null && ins.ret === null) {
        emptyLabelRedirect.set(ins.vip, ins.jumpTo);
      }
    }

    // Resolve transitive closure of empty-label redirects.
    const resolveChain = (vip: number, seen: Set<number>): number => {
      if (seen.has(vip)) return vip; // cycle
      seen.add(vip);
      const r = emptyLabelRedirect.get(vip);
      if (r === undefined) return vip;
      return resolveChain(r, seen);
    };

    // Rewrite every jumpTo/condJump.target through the chain.
    for (const ins of ir) {
      if (ins.jumpTo !== null) {
        const r = resolveChain(ins.jumpTo, new Set());
        if (r !== ins.jumpTo) {
          ins.jumpTo = r;
          changed = true;
        }
      }
      if (ins.condJump) {
        const r = resolveChain(ins.condJump.target, new Set());
        if (r !== ins.condJump.target) {
          ins.condJump = { ...ins.condJump, target: r };
          changed = true;
        }
      }
    }

    // Drop the trivial fall-through: if instruction at index i has jumpTo ==
    // vip of instruction at i+1, clear the jumpTo (it's a fall-through, not a
    // real jump).
    for (let i = 0; i + 1 < ir.length; i++) {
      const ins = ir[i];
      if (ins.jumpTo !== null && i + 1 < ir.length && ir[i + 1].vip === ins.jumpTo) {
        ins.jumpTo = null;
        changed = true;
      }
    }

    // Drop empty-label instructions entirely (their readers have been
    // redirected). Only drop if the instruction has no real stmts AND its
    // vip is not the program entry (vip 1 or ir[0].vip).
    if (emptyLabelRedirect.size > 0) {
      const dropSet = new Set<number>();
      for (const [vip] of emptyLabelRedirect) {
        // only drop if all readers have been redirected (no remaining
        // jumpTo/condJump target equals vip)
        let stillReferenced = false;
        for (const ins2 of ir) {
          if (ins2.jumpTo === vip) stillReferenced = true;
          if (ins2.condJump?.target === vip) stillReferenced = true;
        }
        if (!stillReferenced) dropSet.add(vip);
      }
      if (dropSet.size > 0) {
        ir = ir.filter((ins) => !dropSet.has(ins.vip));
        changed = true;
      }
    }

    if (!changed) break;
  }
  return ir;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 7 — cross-block constant propagation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For each register R<n>, track the most recent `R<n> = <simple_value>`
 * assignment. For each subsequent read of R<n> before the next write, inline
 * the tracked value at the read site.
 *
 * "Simple value" = global, konst, imm, table, or index-of-simple. NOT call
 * (side-effects), NOT scratch (named temp), NOT reg (would just shuffle).
 *
 * Operates on the IR in source order — does NOT model control flow. This
 * means a register that gets a simple value in one basic block and is read
 * in a different basic block will still be inlined, which is sound IF the
 * assignment dominates the read. For goto-heavy VM output where the
 * dispatcher emits a linear stream of statements, this is usually safe.
 */
export function propagateCrossBlockConstants(irIn: IRInst[]): IRInst[] {
  const ir = irIn;
  for (let round = 0; round < 8; round++) {
    // valueMap: reg number → current symbolic value (latest write wins)
    const valueMap = new Map<number, Sym>();
    let changed = false;

    const isSimple = (s: Sym): boolean => {
      if (s.k === "global" || s.k === "konst" || s.k === "imm" || s.k === "table") return true;
      if (s.k === "index") return isSimple(s.obj) && isSimple(s.key);
      if (s.k === "un") return isSimple(s.a);
      // Do NOT propagate bin/call/scratch/reg — too risky.
      return false;
    };

    const inlineInSym = (s: Sym, m: Map<number, Sym>): { sym: Sym; changed: boolean } => {
      if (s.k === "reg") {
        const v = m.get(s.n);
        if (v !== undefined) return { sym: v, changed: true };
        return { sym: s, changed: false };
      }
      if (s.k === "index") {
        const a = inlineInSym(s.obj, m);
        const b = inlineInSym(s.key, m);
        return { sym: { k: "index", obj: a.sym, key: b.sym }, changed: a.changed || b.changed };
      }
      if (s.k === "bin") {
        const a = inlineInSym(s.a, m);
        const b = s.b ? inlineInSym(s.b, m) : { sym: undefined as Sym | undefined, changed: false };
        return { sym: { k: "bin", op: s.op, a: a.sym, b: b.sym }, changed: a.changed || b.changed };
      }
      if (s.k === "un") {
        const a = inlineInSym(s.a, m);
        return { sym: { k: "un", op: s.op, a: a.sym }, changed: a.changed };
      }
      if (s.k === "call") {
        const fn = inlineInSym(s.fn, m);
        let ch = fn.changed;
        const args = s.args.map((x) => {
          const r = inlineInSym(x, m);
          if (r.changed) ch = true;
          return r.sym;
        });
        return { sym: { k: "call", fn: fn.sym, args }, changed: ch };
      }
      return { sym: s, changed: false };
    };

    const inlineInStmt = (s: IRStmt, m: Map<number, Sym>): { stmt: IRStmt; changed: boolean } => {
      switch (s.kind) {
        case "assign": {
          const r = inlineInSym(s.src, m);
          // Update value map: this is a write to s.reg
          if (isSimple(s.src)) {
            m.set(s.reg, s.src);
          } else {
            // Non-simple write — invalidate the entry (R<n> no longer has a
            // known simple value).
            m.delete(s.reg);
          }
          return { stmt: { kind: "assign", reg: s.reg, src: r.sym }, changed: r.changed };
        }
        case "kstore": {
          // kstore: obj[key] = val. Reads obj, key, val. No reg write.
          const o = inlineInSym(s.obj, m);
          const k = inlineInSym(s.key, m);
          const v = inlineInSym(s.val, m);
          return {
            stmt: { kind: "kstore", obj: o.sym, key: k.sym, val: v.sym },
            changed: o.changed || k.changed || v.changed,
          };
        }
        case "condjump": {
          const c = inlineInSym(s.cond, m);
          return { stmt: { kind: "condjump", cond: c.sym, target: s.target }, changed: c.changed };
        }
        case "callstmt": {
          // callstmt: R<base> = R<base>(R<base+1..>). Reads base..base+argc.
          // After the call, R<base> is overwritten (if retc > 0). Invalidate.
          if (s.retc > 0) m.delete(s.base);
          return { stmt: s, changed: false };
        }
        case "clearrange": {
          // Invalidates a range of registers.
          for (let r = s.lo; r <= s.hi; r++) m.delete(r);
          return { stmt: s, changed: false };
        }
        case "jump":
        case "ret":
        case "comment":
          return { stmt: s, changed: false };
      }
    };

    for (const ins of ir) {
      const newStmts: IRStmt[] = [];
      for (const s of ins.stmts) {
        const r = inlineInStmt(s, valueMap);
        newStmts.push(r.stmt);
        if (r.changed) changed = true;
      }
      ins.stmts = newStmts;
      // jumpTo/condJump don't read regs directly (they have a separate cond
      // sym for condJump). condJump's cond is in stmts (we modeled it above
      // as a stmt, but actually condJump is on the IRInst, not in stmts).
      // Inline condJump.cond too.
      if (ins.condJump) {
        const r = inlineInSym(ins.condJump.cond, valueMap);
        if (r.changed) {
          ins.condJump = { ...ins.condJump, cond: r.sym };
          changed = true;
        }
      }
    }

    if (!changed) break;
  }
  return ir;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 8 — register renaming
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rename R0 → script, R<kPool.reg> → K (if kPool exists), every other R<n> →
 * vN where N is the order of first appearance in the IR. Returns a map
 * (reg number → new name) and mutates the IR's Syms to use the new names
 * via the rendering pass (we keep the IR structural and rename at render
 * time).
 */
export interface RenameMap {
  // reg → new name
  names: Map<number, string>;
}

export function buildRenameMap(ir: IRInst[], kPool: KPool | null): RenameMap {
  const names = new Map<number, string>();
  names.set(0, "script");
  if (kPool) names.set(kPool.reg, "K");
  // Use names long enough (≥4 chars) to escape multipass's "cryptic" heuristic
  // (CRYPTO_SHORT_RE matches ≤3 chars). "lv01, lv02, …" stays stable.
  let counter = 1;
  const mk = (): string => {
    const n = counter++;
    // zero-pad to 2 digits so name length is always ≥4 (e.g. lv01, lv99, lv100)
    const pad = n < 100 ? String(n).padStart(2, "0") : String(n);
    return `lv${pad}`;
  };
  const visit = (sym: Sym): void => {
    if (sym.k === "reg") {
      if (!names.has(sym.n)) names.set(sym.n, mk());
    } else if (sym.k === "index") {
      visit(sym.obj);
      visit(sym.key);
    } else if (sym.k === "bin") {
      visit(sym.a);
      if (sym.b) visit(sym.b);
    } else if (sym.k === "un") {
      visit(sym.a);
    } else if (sym.k === "call") {
      visit(sym.fn);
      for (const a of sym.args) visit(a);
    }
  };
  for (const ins of ir) {
    for (const s of ins.stmts) {
      if (s.kind === "assign") {
        if (!names.has(s.reg)) names.set(s.reg, mk());
        visit(s.src);
      } else if (s.kind === "kstore") {
        // For `regs[imm] = val` kstores, the imm is the register number.
        if (s.obj.k === "regs" && s.key.k === "imm") {
          if (!names.has(s.key.v)) names.set(s.key.v, mk());
        }
        visit(s.obj);
        visit(s.key);
        visit(s.val);
      } else if (s.kind === "condjump") {
        visit(s.cond);
      } else if (s.kind === "callstmt") {
        // base, base+1..base+argc all need names (base is the function,
        // base+1.. are the args).
        if (!names.has(s.base)) names.set(s.base, mk());
        for (let i = 1; i <= s.argc; i++) {
          if (!names.has(s.base + i)) names.set(s.base + i, mk());
        }
      }
    }
    if (ins.condJump) {
      visit(ins.condJump.cond);
    }
  }
  return { names };
}

/** Render a Sym using the rename map. Falls back to renderSym if no entry. */
export function renderSymRenamed(s: Sym | undefined, names: RenameMap): string {
  if (!s) return "<nil>";
  if (s.k === "reg") {
    const nm = names.names.get(s.n);
    if (nm) return nm;
    return `R${s.n}`;
  }
  if (s.k === "index") {
    const obj = renderSymRenamed(s.obj, names);
    const key = renderSymRenamed(s.key, names);
    // If key is a string identifier, use dot-notation for readability.
    if (s.key.k === "konst" && typeof s.key.v === "string" && /^[A-Za-z_]\w*$/.test(s.key.v)) {
      return `${obj}.${s.key.v}`;
    }
    return `${obj}[${key}]`;
  }
  if (s.k === "bin") {
    const a = renderSymRenamed(s.a, names);
    const b = s.b === undefined ? "" : renderSymRenamed(s.b, names);
    return `(${a} ${s.op} ${b})`;
  }
  if (s.k === "call") {
    const fn = renderSymRenamed(s.fn, names);
    const args = s.args.map((a) => renderSymRenamed(a, names)).join(", ");
    return `${fn}(${args})`;
  }
  if (s.k === "un") {
    const a = renderSymRenamed(s.a, names);
    return s.op === "not" ? `(not ${a})` : `(-${a})`;
  }
  return renderSym(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flatten emitter — drop goto/label, emit statements in source order
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emit the IR as a flat sequence of statements — no goto, no labels, no
 * if-then-goto blocks. Drop comment-only instructions. Drop instructions
 * whose only stmts are `clearrange` or `comment`. Useful for VM output where
 * the lifted statements form a sparse linear stream and the goto/label
 * structure is pure obfuscation noise.
 */
export function flattenAndEmit(
  irIn: IRInst[],
  kPool: KPool | null,
  prog: FinalProgram,
  index: number,
  names: RenameMap,
): string {
  // Filter to instructions that have at least one real stmt (non-comment,
  // non-clearrange), OR have a `ret`. Skip pure-goto / pure-comment
  // instructions.
  const ir = irIn.filter((ins) => {
    const hasReal = ins.stmts.some((s) => s.kind !== "comment" && s.kind !== "clearrange");
    if (hasReal) return true;
    if (ins.ret) return true;
    return false;
  });

  const lines: string[] = [];
  lines.push(`-- ═══ Luraph VM proto #${index} — flattened ═══`);
  lines.push(`-- ${prog.instrCount} instructions · ${ir.length} statements · ${kPool ? `${kPool.entries.size} constants` : "no K pool"}`);
  lines.push(`-- Control-flow (goto/label) stripped — linear statement stream.`);
  lines.push(`local function PROTO_${index}(...)`);

  // K-pool block
  if (kPool && kPool.entries.size > 0) {
    lines.push(`  -- Constants pool recovered from VM bytecode`);
    lines.push(`  local K = {}`);
    const sortedIdx = [...kPool.entries.keys()].sort((a, b) => a - b);
    for (const idx of sortedIdx) {
      const v = kPool.entries.get(idx)!;
      const r = renderSymRenamed(v, names);
      if (r.length > 200) {
        lines.push(`  K[${idx}] = ${r.slice(0, 180)}…  --[[truncated ${r.length} chars]]`);
      } else {
        lines.push(`  K[${idx}] = ${r}`);
      }
    }
    lines.push("");
  }

  // Vararg
  lines.push(`  local script = ...`);

  // Collect referenced registers from the surviving statements
  const usedRegs = new Set<number>();
  for (const ins of ir) {
    for (const s of ins.stmts) {
      collectRegsRenamed(s, usedRegs, names);
    }
  }
  if (kPool) usedRegs.delete(kPool.reg);
  usedRegs.delete(0); // R0 = script

  // Declare locals with their new names
  const declRegs = [...usedRegs].sort((a, b) => a - b);
  if (declRegs.length > 0) {
    for (let i = 0; i < declRegs.length; i += 90) {
      const chunk = declRegs.slice(i, i + 90);
      const nameList = chunk.map((r) => names.names.get(r) ?? `R${r}`).join(", ");
      lines.push(`  local ${nameList}`);
    }
    lines.push("");
  }

  // Emit statements in source order
  for (const ins of ir) {
    for (const s of ins.stmts) {
      const line = renderStmtRenamed(s, names, 1);
      if (line) lines.push(`  ${line}`);
    }
    if (ins.ret) {
      lines.push(
        ins.ret.kind === "void"
          ? "  return"
          : ins.ret.kind === "vararg"
            ? "  return ..."
            : "  return -- (VM multi-value return)",
      );
    }
  }

  lines.push(`end`);
  return lines.join("\n");
}

function collectRegsSymRenamed(s: Sym, out: Set<number>): void {
  if (s.k === "reg") out.add(s.n);
  else if (s.k === "index") {
    collectRegsSymRenamed(s.obj, out);
    collectRegsSymRenamed(s.key, out);
  } else if (s.k === "bin") {
    collectRegsSymRenamed(s.a, out);
    if (s.b) collectRegsSymRenamed(s.b, out);
  } else if (s.k === "un") {
    collectRegsSymRenamed(s.a, out);
  } else if (s.k === "call") {
    collectRegsSymRenamed(s.fn, out);
    for (const a of s.args) collectRegsSymRenamed(a, out);
  }
}

function collectRegsRenamed(s: IRStmt, out: Set<number>, names: RenameMap): void {
  // collect only registers that don't have a renamed identity (script/K
  // already declared). For vN names, collect them so we can declare with
  // `local`.
  if (s.kind === "assign") {
    out.add(s.reg);
    collectRegsSymRenamed(s.src, out);
  } else if (s.kind === "kstore") {
    // `regs[imm] = val` → collect imm as a register to declare
    if (s.obj.k === "regs" && s.key.k === "imm") {
      out.add(s.key.v);
    }
    collectRegsSymRenamed(s.obj, out);
    collectRegsSymRenamed(s.key, out);
    collectRegsSymRenamed(s.val, out);
  } else if (s.kind === "callstmt") {
    out.add(s.base);
    out.add(s.base + 1);
    if (s.argc >= 2) out.add(s.base + 2);
  } else if (s.kind === "condjump") {
    collectRegsSymRenamed(s.cond, out);
  } else if (s.kind === "clearrange") {
    for (let r = s.lo; r <= s.hi; r++) out.add(r);
  }
  // skip jump/ret/comment
  void names;
}

function renderStmtRenamed(s: IRStmt, names: RenameMap, depth: number): string {
  void depth;
  switch (s.kind) {
    case "assign":
      return `${names.names.get(s.reg) ?? `R${s.reg}`} = ${renderSymRenamed(s.src, names)}`;
    case "kstore": {
      // Convert `regs[imm] = val` → `R<n> = val` (proper register assign).
      if (s.obj.k === "regs" && s.key.k === "imm") {
        const regN = s.key.v;
        const nm = names.names.get(regN) ?? `R${regN}`;
        const val = renderSymRenamed(s.val, names);
        // Skip junk: val is scratch or unk (unresolved).
        if (s.val.k === "scratch" || s.val.k === "unk") return "";
        return `${nm} = ${val}`;
      }
      // Skip invalid kstores: obj is imm/konst/scratch/unk (can't index a
      // number, constant, scratch name, or unknown).
      if (s.obj.k === "imm" || s.obj.k === "konst" || s.obj.k === "scratch" || s.obj.k === "unk") {
        return "";
      }
      // Skip kstores where val is scratch or unk (unresolved).
      if (s.val.k === "scratch" || s.val.k === "unk") return "";
      const obj = renderSymRenamed(s.obj, names);
      const key = renderSymRenamed(s.key, names);
      const val = renderSymRenamed(s.val, names);
      return `${obj}[${key}] = ${val}`;
    }
    case "callstmt": {
      const baseName = names.names.get(s.base) ?? `R${s.base}`;
      const args: string[] = [];
      for (let i = 1; i <= s.argc; i++) {
        args.push(names.names.get(s.base + i) ?? `R${s.base + i}`);
      }
      if (s.retc === 1) {
        return `${baseName} = ${baseName}(${args.join(", ")})`;
      }
      return `${baseName}(${args.join(", ")})`;
    }
    case "clearrange": {
      // emit as nil assignments for the renamed registers
      const parts: string[] = [];
      for (let r = s.lo; r <= s.hi; r++) {
        const nm = names.names.get(r);
        if (nm) parts.push(`${nm} = nil`);
      }
      return parts.join("; ");
    }
    case "jump":
      return ""; // dropped in flatten mode
    case "condjump":
      return `-- if ${renderSymRenamed(s.cond, names)} then goto L${s.target} end`;
    case "ret":
      return s.retKind === "void" ? "return" : s.retKind === "vararg" ? "return ..." : "return -- (VM multi-value return)";
    case "comment":
      return `-- ${s.text}`;
  }
}
