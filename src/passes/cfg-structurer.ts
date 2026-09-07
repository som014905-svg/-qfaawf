// ═══════════════════════════════════════════════════════════════
// Advanced CFG Structurer v5.1 — "Demonology X10-FAST"
//
// PERF UPGRADES vs v5.0:
//   - vipToIdx Map built once, O(1) jump target lookup (was findIndex O(n))
//   - leaderSet (Set<number>) for O(1) leader checks (was findIndex O(n))
//   - leaderToBlock Map<number,number> for O(1) block id lookup
//   - findLoopEnd / findMergeBlock use iterative BFS with Set (no recursion stack)
//   - DFS in detectLoops is iterative (no stack overflow on deep IR)
// ═══════════════════════════════════════════════════════════════

import { IRInst, IRStmt } from "../vm/luraph-structure";
import { Sym } from "../vm/luraph-lifter";
import { detectOpaquePredicate } from "../vm/symbolic-exec";

export interface BasicBlock {
  id: number;
  startIdx: number;
  endIdx: number;
  stmts: IRStmt[];
  successors: number[];
  predecessors: number[];
  isLoopHeader: boolean;
  loopType?: "while" | "repeat" | "for" | "generic_for";
  dominator: number | null;
  isIrreducible: boolean;
}

export interface StructuredRegion {
  type: "seq" | "if" | "while" | "repeat" | "for" | "block" | "goto";
  blocks: number[];
  children: StructuredRegion[];
  condition?: Sym;
  header?: number;
  footer?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build Basic Blocks
// ─────────────────────────────────────────────────────────────────────────────

export function buildBasicBlocks(ir: IRInst[]): BasicBlock[] {
  if (ir.length === 0) return [];

  // ── PERF: O(1) vip→idx ──
  const vipToIdx = new Map<number, number>();
  for (let i = 0; i < ir.length; i++) vipToIdx.set(ir[i].vip, i);

  const leaderSet = new Set<number>();
  leaderSet.add(0);

  for (let i = 0; i < ir.length; i++) {
    const inst = ir[i];
    if (inst.jumpTo !== null) {
      const ti = vipToIdx.get(inst.jumpTo);
      if (ti !== undefined) leaderSet.add(ti);
    }
    if (inst.condJump !== null || inst.jumpTo !== null || inst.ret !== null) {
      if (i + 1 < ir.length) leaderSet.add(i + 1);
    }
  }

  const sortedLeaders = Array.from(leaderSet).sort((a, b) => a - b);
  // ── PERF: O(1) leader→block-id ──
  const leaderToBlock = new Map<number, number>();
  sortedLeaders.forEach((l, i) => leaderToBlock.set(l, i));

  const blocks: BasicBlock[] = [];
  for (let i = 0; i < sortedLeaders.length; i++) {
    const start = sortedLeaders[i];
    const end   = i + 1 < sortedLeaders.length ? sortedLeaders[i + 1] - 1 : ir.length - 1;

    const stmts: IRStmt[] = [];
    for (let j = start; j <= end; j++) stmts.push(...ir[j].stmts);

    const block: BasicBlock = {
      id: i,
      startIdx: start,
      endIdx: end,
      stmts,
      successors: [],
      predecessors: [],
      isLoopHeader: false,
      dominator: null,
      isIrreducible: false,
    };

    const lastInst = ir[end];
    if (lastInst.jumpTo !== null) {
      const ti = vipToIdx.get(lastInst.jumpTo);
      if (ti !== undefined) {
        const tb = leaderToBlock.get(ti);
        if (tb !== undefined) block.successors.push(tb);
      }
    }
    if (lastInst.condJump !== null) {
      const nb = leaderToBlock.get(end + 1);
      if (nb !== undefined) block.successors.push(nb);
    } else if (lastInst.jumpTo === null && lastInst.ret === null && end + 1 < ir.length) {
      const nb = leaderToBlock.get(end + 1);
      if (nb !== undefined) block.successors.push(nb);
    }

    blocks.push(block);
  }

  for (const block of blocks) {
    for (const succ of block.successors) blocks[succ].predecessors.push(block.id);
  }

  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop Detection  (iterative DFS — no recursion stack overflow)
// ─────────────────────────────────────────────────────────────────────────────

export function detectLoops(blocks: BasicBlock[]): void {
  const visited  = new Set<number>();
  const onStack  = new Set<number>();

  // Iterative DFS with explicit stack of [node, childIndex]
  const stack: Array<[number, number]> = [[0, 0]];
  visited.add(0);
  onStack.add(0);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const [node, ci] = frame;
    const succs = blocks[node].successors;

    if (ci >= succs.length) {
      // Done with this node
      onStack.delete(node);
      stack.pop();
      continue;
    }

    frame[1]++; // advance child index before recursing
    const succ = succs[ci];

    if (!visited.has(succ)) {
      visited.add(succ);
      onStack.add(succ);
      stack.push([succ, 0]);
    } else if (onStack.has(succ)) {
      // Back edge node → succ
      const header = blocks[succ];
      header.isLoopHeader = true;

      // Determine loop type from terminator statement
      const lastStmts = blocks[node].stmts;
      if (lastStmts.length > 0) {
        const last = lastStmts[lastStmts.length - 1];
        if (last.kind === "condjump" && !detectOpaquePredicate(last.cond).isOpaque) {
          header.loopType = last.target === (blocks[node + 1]?.startIdx ?? -1)
            ? "while"
            : "repeat";
        }
      }
      // Numeric for detection
      if (!header.loopType) {
        const assigns   = header.stmts.filter(s => s.kind === "assign");
        const condJumps = header.stmts.filter(s => s.kind === "condjump");
        if (assigns.length >= 3 && condJumps.length === 1) header.loopType = "for";
      }
    }
  }

  // Mark irreducible
  for (const block of blocks) {
    if (block.isLoopHeader && block.predecessors.length > 2) {
      let outside = 0;
      for (const pred of block.predecessors) {
        if (!blocks[pred].successors.includes(block.id)) outside++;
      }
      if (outside > 1) block.isIrreducible = true;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Structure CFG
// ─────────────────────────────────────────────────────────────────────────────

export function structureCFG(blocks: BasicBlock[]): StructuredRegion {
  if (blocks.length === 0) return { type: "seq", blocks: [], children: [] };
  detectLoops(blocks);

  const visited = new Set<number>();

  function structureFrom(start: number, end: number): StructuredRegion {
    const region: StructuredRegion = { type: "seq", blocks: [], children: [] };

    let i = start;
    while (i <= end) {
      if (visited.has(i)) { i++; continue; }

      const block = blocks[i];

      if (block.isLoopHeader) {
        const loopEnd = findLoopEnd(blocks, i);
        const loopRegion: StructuredRegion = {
          type: block.loopType || "while",
          blocks: [],
          children: [],
          header: i,
          footer: loopEnd,
        };
        for (const stmt of block.stmts) {
          if (stmt.kind === "condjump") { loopRegion.condition = stmt.cond; break; }
        }
        const bodyStart = i + 1;
        if (bodyStart <= loopEnd) loopRegion.children.push(structureFrom(bodyStart, loopEnd));
        region.children.push(loopRegion);
        for (let j = i; j <= loopEnd; j++) visited.add(j);
        i = loopEnd + 1;
        continue;
      }

      if (block.successors.length === 2) {
        const condStmt = block.stmts.find(s => s.kind === "condjump");
        if (condStmt && condStmt.kind === "condjump") {
          const thenBlock  = block.successors[0];
          const elseBlock  = block.successors[1];
          const mergeBlock = findMergeBlock(blocks, thenBlock, elseBlock);
          const ifEnd      = mergeBlock !== null ? mergeBlock - 1 : Math.max(thenBlock, elseBlock);
          const ifRegion: StructuredRegion = {
            type: "if",
            blocks: [i],
            children: [],
            condition: condStmt.cond,
          };
          if (thenBlock <= ifEnd && !visited.has(thenBlock)) {
            ifRegion.children.push(structureFrom(thenBlock, mergeBlock !== null ? mergeBlock - 1 : ifEnd));
          }
          if (elseBlock !== thenBlock && elseBlock <= ifEnd && !visited.has(elseBlock)) {
            ifRegion.children.push(structureFrom(elseBlock, mergeBlock !== null ? mergeBlock - 1 : ifEnd));
          }
          region.children.push(ifRegion);
          visited.add(i);
          i = mergeBlock !== null ? mergeBlock : ifEnd + 1;
          continue;
        }
      }

      region.blocks.push(i);
      visited.add(i);
      i++;
    }

    return region;
  }

  return structureFrom(0, blocks.length - 1);
}

// ── PERF: iterative BFS, no recursion ──

function findLoopEnd(blocks: BasicBlock[], headerIdx: number): number {
  let maxReach = headerIdx;
  const visited = new Set<number>();
  const queue = [... blocks[headerIdx].successors];
  visited.add(headerIdx);

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    if (node > maxReach) maxReach = node;
    for (const succ of blocks[node].successors) {
      if (succ !== headerIdx) queue.push(succ);
    }
  }
  return maxReach;
}

function findMergeBlock(blocks: BasicBlock[], thenBlock: number, elseBlock: number): number | null {
  // BFS from thenBlock, collect all reachable
  const thenReach = new Set<number>();
  const q1 = [thenBlock];
  while (q1.length > 0) {
    const n = q1.shift()!;
    if (thenReach.has(n)) continue;
    thenReach.add(n);
    for (const s of blocks[n]?.successors ?? []) q1.push(s);
  }

  // BFS from elseBlock, first common successor
  const q2 = [elseBlock];
  const vis = new Set<number>();
  while (q2.length > 0) {
    const n = q2.shift()!;
    if (vis.has(n)) continue;
    vis.add(n);
    if (thenReach.has(n) && n !== thenBlock && n !== elseBlock) return n;
    for (const s of blocks[n]?.successors ?? []) q2.push(s);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Emit Structured Luau
// ─────────────────────────────────────────────────────────────────────────────

export function emitStructured(region: StructuredRegion, blocks: BasicBlock[], indent = 0): string {
  const ind = "  ".repeat(indent);
  let out = "";

  switch (region.type) {
    case "seq": {
      for (const blockId of region.blocks) {
        for (const stmt of blocks[blockId].stmts) out += ind + emitStmt(stmt) + "\n";
      }
      for (const child of region.children) out += emitStructured(child, blocks, indent);
      break;
    }
    case "if": {
      const cond = region.condition ? renderCond(region.condition) : "true";
      out += `${ind}if ${cond} then\n`;
      for (let i = 0; i < region.children.length; i++) {
        if (i === 1) out += `${ind}else\n`;
        out += emitStructured(region.children[i], blocks, indent + 1);
      }
      out += `${ind}end\n`;
      break;
    }
    case "while": {
      const cond = region.condition ? renderCond(region.condition) : "true";
      out += `${ind}while ${cond} do\n`;
      for (const child of region.children) out += emitStructured(child, blocks, indent + 1);
      out += `${ind}end\n`;
      break;
    }
    case "repeat": {
      out += `${ind}repeat\n`;
      for (const child of region.children) out += emitStructured(child, blocks, indent + 1);
      const cond = region.condition ? renderCond(region.condition) : "true";
      out += `${ind}until ${cond}\n`;
      break;
    }
    case "for": {
      out += `${ind}-- for-loop (numeric)\n`;
      for (const child of region.children) out += emitStructured(child, blocks, indent + 1);
      break;
    }
    case "block": {
      out += `${ind}do\n`;
      for (const child of region.children) out += emitStructured(child, blocks, indent + 1);
      out += `${ind}end\n`;
      break;
    }
    case "goto": {
      out += `${ind}-- irreducible region (goto preserved)\n`;
      for (const blockId of region.blocks) {
        for (const stmt of blocks[blockId].stmts) out += ind + emitStmt(stmt) + "\n";
      }
      break;
    }
  }

  return out;
}

function emitStmt(stmt: IRStmt): string {
  switch (stmt.kind) {
    case "assign":    return `R${stmt.reg} = ${renderSym(stmt.src)}`;
    case "kstore":    return `${renderSym(stmt.obj)}[${renderSym(stmt.key)}] = ${renderSym(stmt.val)}`;
    case "callstmt":  return `R${stmt.base}(...)`;
    case "clearrange":return `-- clear R${stmt.lo}..R${stmt.hi}`;
    case "jump":      return `goto ::L${stmt.target}::`;
    case "condjump":  return `-- if ${renderCond(stmt.cond)} then goto ::L${stmt.target}::`;
    case "ret":       return stmt.retKind === "void" ? "return" : "return ...";
    case "comment":   return `-- ${stmt.text}`;
    default:          return `-- unknown stmt`;
  }
}

function renderCond(cond: Sym): string { return JSON.stringify(cond); }

import { renderSym } from "../vm/luraph-lifter";

export { buildBasicBlocks, detectLoops, structureCFG, emitStructured };
