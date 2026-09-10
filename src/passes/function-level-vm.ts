/**
 * v6.0 Function-level VM dispatcher recovery.
 *
 * Conservative source-to-source pass for the common WeAreDevs/Luast pattern:
 *
 *   state = INITIAL
 *   while true do
 *     state = C - state
 *     if state < ... then ... end
 *   end
 *
 * The dispatcher tree is treated as a control-flow graph.  Leaf blocks whose
 * final state assignment is constant (or `if cond then A else B`) are
 * recursively inlined into structured `if` blocks.  Cycles, ambiguous
 * transitions, or oversized graphs are left untouched.
 *
 * This pass never executes Lua/Luau or external APIs.
 */

import { LuaToken, tokenize } from "../utils/lua-utils";

interface Tok extends LuaToken { i: number; }
interface Branches {
  thenStart: number;
  thenEnd: number;
  elseStart: number;
  elseEnd: number;
  close: number;
}
interface TreeNode {
  start: number;
  end: number;
  varName: string;
  op: string;
  value: number;
  thenStart: number;
  thenEnd: number;
  elseStart: number;
  elseEnd: number;
  thenNode?: TreeNode;
  elseNode?: TreeNode;
}
interface LeafRegion { start: number; end: number; }
interface Transition {
  kind: "const" | "branch" | "unknown" | "terminal";
  state?: number;
  thenState?: number;
  elseState?: number;
  condition?: string;
  body: string;
}

function sigTokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  for (const t of tokenize(src)) {
    if (["eof", "whitespace", "newline", "comment", "longcomment"].includes(t.kind)) continue;
    out.push(Object.assign(t, { i: i++ }) as Tok);
  }
  return out;
}

function numberValue(t?: Tok): number | null {
  if (!t || t.kind !== "number") return null;
  const n = Number(t.text.replaceAll("_", ""));
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function isIfExpression(sig: Tok[], index: number): boolean {
  const prev = sig[index - 1]?.text;
  return prev === "=" || prev === "," || prev === "(" || prev === "[" || prev === "{" ||
    prev === "return" || prev === "and" || prev === "or" || prev === "not";
}

function depthDelta(stack: string[], sig: Tok[], index: number): void {
  const text = sig[index].text;
  if (text === "if") {
    if (!isIfExpression(sig, index)) stack.push("if");
  } else if (text === "for" || text === "while" || text === "function" || text === "repeat") {
    stack.push(text);
  } else if (text === "do") {
    // `for ... do` / `while ... do` do not create a second block level.
    const top = stack[stack.length - 1];
    if (top !== "for" && top !== "while") stack.push("do");
  } else if (text === "end") {
    if (stack.length) stack.pop();
  } else if (text === "until") {
    if (stack[stack.length - 1] === "repeat") stack.pop();
  }
}

function findMatchingBlock(sig: Tok[], start: number): number {
  const stack: string[] = [];
  for (let i = start; i < sig.length; i++) {
    depthDelta(stack, sig, i);
    if (stack.length === 0 && i > start) return i;
  }
  return -1;
}

interface CondPart {
  ifIndex: number;
  varName: string;
  op: string;
  value: number;
  thenStart: number;
  thenEnd: number;
  nextIndex: number | null;
  finalEnd: number;
  elseStart: number;
  elseEnd: number;
}

function parseCondition(sig: Tok[], ifIndex: number): { varName: string; op: string; value: number } | null {
  const v = sig[ifIndex + 1];
  const op = sig[ifIndex + 2]?.text;
  const n = numberValue(sig[ifIndex + 3]);
  if (!v || v.kind !== "identifier" || !["<", "<=", ">", ">=", "=="].includes(op ?? "") || n == null) return null;
  return { varName: v.text, op: op!, value: n };
}

/**
 * Parse an if/elseif/else chain at one nesting level.  `elseif` is converted
 * into a virtual right child so binary-search-style dispatchers can be
 * treated uniformly with nested `if ... else if ... end` trees.
 */
function parseIfChain(sig: Tok[], ifIndex: number): CondPart[] | null {
  const first = parseCondition(sig, ifIndex);
  if (!first) return null;
  const overallEnd = findMatchingBlock(sig, ifIndex);
  if (overallEnd < 0) return null;
  const parts: CondPart[] = [];
  let condIndex = ifIndex;
  let guard = 0;
  while (guard++ < 128) {
    const c = parseCondition(sig, condIndex);
    if (!c) return null;
    const stack: string[] = [];
    let thenStart = -1;
    let thenEnd = -1;
    let nextIndex: number | null = null;
    let elseStart = overallEnd;
    let elseEnd = overallEnd;

    for (let i = condIndex + 4; i < overallEnd; i++) {
      const x = sig[i].text;
      if (x === "then" && stack.length === 0 && thenStart < 0) {
        thenStart = i + 1;
        continue;
      }
      if (stack.length === 0 && x === "elseif" && thenEnd < 0) {
        thenEnd = i;
        nextIndex = i;
        break;
      }
      if (stack.length === 0 && x === "else" && thenEnd < 0) {
        thenEnd = i;
        elseStart = i + 1;
        elseEnd = overallEnd;
        break;
      }
      depthDelta(stack, sig, i);
    }

    // No top-level elseif/else: the then arm reaches the enclosing end.
    if (thenStart < 0) return null;
    if (thenEnd < 0) thenEnd = overallEnd;
    parts.push({
      ifIndex: condIndex,
      ...c,
      thenStart,
      thenEnd,
      nextIndex,
      finalEnd: overallEnd,
      elseStart,
      elseEnd,
    });
    if (nextIndex == null) break;
    condIndex = nextIndex;
  }
  return parts.length ? parts : null;
}

function parseTree(sig: Tok[], ifIndex: number, maxDepth = 64): TreeNode | null {
  if (maxDepth <= 0) return null;
  const parts = parseIfChain(sig, ifIndex);
  if (!parts || !parts.length) return null;
  const first = parts[0];
  const root: TreeNode = {
    start: ifIndex,
    end: first.finalEnd,
    varName: first.varName,
    op: first.op,
    value: first.value,
    thenStart: first.thenStart,
    thenEnd: first.thenEnd,
    elseStart: first.elseStart,
    elseEnd: first.elseEnd,
  };
  // The `elseif` chain is represented as a right-associated virtual tree.
  let cursor = root;
  for (let p = 1; p < parts.length; p++) {
    const part = parts[p];
    const child: TreeNode = {
      start: part.ifIndex,
      end: first.finalEnd,
      varName: part.varName,
      op: part.op,
      value: part.value,
      thenStart: part.thenStart,
      thenEnd: part.thenEnd,
      elseStart: part.elseStart,
      elseEnd: part.elseEnd,
    };
    cursor.elseNode = child;
    cursor = child;
  }
  // Parse nested `if` nodes that occupy an entire then/else region.
  const attach = (node: TreeNode, depth: number) => {
    if (depth <= 0) return;
    if (sig[node.thenStart]?.text === "if") {
      const child = parseTree(sig, node.thenStart, depth - 1);
      if (child && child.end === node.thenEnd - 1 && child.varName === node.varName) node.thenNode = child;
    }
    if (!node.elseNode && sig[node.elseStart]?.text === "if") {
      const child = parseTree(sig, node.elseStart, depth - 1);
      if (child && child.end === node.elseEnd - 1 && child.varName === node.varName) node.elseNode = child;
    }
    if (node.elseNode) attach(node.elseNode, depth - 1);
    if (node.thenNode) attach(node.thenNode, depth - 1);
  };
  attach(root, maxDepth);
  return root;
}

function evaluateNode(node: TreeNode, value: number): LeafRegion | null {
  const test = node.op === "<" ? value < node.value :
    node.op === "<=" ? value <= node.value :
    node.op === ">" ? value > node.value :
    node.op === ">=" ? value >= node.value : value === node.value;
  const s = test ? node.thenStart : node.elseStart;
  const e = test ? node.thenEnd : node.elseEnd;
  const child = test ? node.thenNode : node.elseNode;
  if (child) return evaluateNode(child, value);
  return e >= s ? { start: s, end: e } : null;
}

function applyEdits(src: string, edits: Array<{ start: number; end: number; text: string }>): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let p = 0;
  const out: string[] = [];
  for (const e of sorted) {
    if (e.start < p) continue;
    out.push(src.slice(p, e.start), e.text);
    p = e.end;
  }
  out.push(src.slice(p));
  return out.join("");
}

function previousNumericAssignment(sig: Tok[], start: number, variable: string): number | null {
  for (let i = start - 1; i >= 3; i--) {
    if (sig[i].kind === "identifier" && sig[i].text === variable && sig[i + 1]?.text === "=") {
      const n = numberValue(sig[i + 2]);
      if (n != null) return n;
    }
    if (sig[i].text === "function" || sig[i].text === "end") break;
  }
  return null;
}

function findNormalization(sig: Tok[], whileStart: number, whileEnd: number): { state: string; constant: number; ifIndex: number; assignmentEnd: number } | null {
  for (let i = whileStart + 1; i < Math.min(whileEnd, whileStart + 40); i++) {
    const state = sig[i];
    if (state.kind !== "identifier" || sig[i + 1]?.text !== "=" || sig[i + 2]?.text === undefined) continue;
    const c = numberValue(sig[i + 2]);
    if (c == null) continue;
    if (sig[i + 3]?.text === "-" && sig[i + 4]?.kind === "identifier" && sig[i + 4]?.text === state.text) {
      let j = i + 5;
      if (sig[j]?.text === ";") j++;
      while (j < whileEnd && sig[j].text === "do") j++;
      if (sig[j]?.text === "if") return { state: state.text, constant: c, ifIndex: j, assignmentEnd: j };
    }
  }
  return null;
}

function sourceOf(sig: Tok[], src: string, start: number, end: number): string {
  if (end <= start) return "";
  return src.slice(sig[start].start, sig[end - 1].end);
}

function parseTransition(body: string, stateName: string): Transition {
  let text = body.trim();
  // Strip an optional trailing continue; it is implicit in the dispatcher.
  text = text.replace(/(?:;\s*)?continue\s*$/i, "").trim();

  const assignRe = new RegExp(`(?:^|[;\\n])\\s*${escapeRegex(stateName)}\\s*=\\s*`, "g");
  let last: RegExpExecArray | null = null;
  for (let m; (m = assignRe.exec(text)); ) last = m;
  if (!last) {
    if (!text || /(?:^|[;\n])\s*(?:break|return(?:\s+[^;\n]+)?)\s*$/i.test(text)) {
      return { kind: "terminal", body: text };
    }
    return { kind: "unknown", body: text };
  }
  const start = last.index + (last[0].lastIndexOf(stateName));
  const lhsEnd = start + stateName.length;
  let rhs = text.slice(lhsEnd).replace(/^\s*=\s*/, "").trim();
  // Luast/pretty-printers sometimes glue a numeric literal to `else`, e.g.
  // `if cond then 3.else 9.`. Normalize that lexical artifact for analysis.
  rhs = rhs.replace(/(-?\d+)\.else\b/g, "$1 else");

  const constM = rhs.match(/^(-?\d+(?:\.\d*)?)\s*$/);
  if (constM) {
    const state = Number(constM[1]);
    if (Number.isFinite(state) && Number.isInteger(state)) {
      return { kind: "const", state, body: text.slice(0, start).trim() };
    }
  }

  const branchM = rhs.match(/^if\s+([\s\S]*?)\s+then\s+(-?\d+(?:\.\d*)?)\s+else\s+(-?\d+(?:\.\d*)?)\s*$/);
  if (branchM) {
    const a = Number(branchM[2]);
    const b = Number(branchM[3]);
    if (Number.isInteger(a) && Number.isInteger(b)) {
      return {
        kind: "branch", thenState: a, elseState: b,
        condition: branchM[1].trim(), body: text.slice(0, start).trim(),
      };
    }
  }
  return { kind: "unknown", body: text.slice(0, start).trim() };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function indentBlock(code: string, pad: string): string {
  const t = code.trim();
  if (!t) return "";
  return t.split(/\r?\n/).map((l) => `${pad}${l}`).join("\n");
}

function recoverFunction(src: string, sig: Tok[], whileIndex: number, opts: { maxStates: number; maxOutput: number }): { start: number; end: number; text: string; states: number; initial: number; constant: number } | null {
  const whileEnd = findMatchingBlock(sig, whileIndex);
  if (whileEnd < 0 || sig[whileIndex + 1]?.text !== "true" || sig[whileIndex + 2]?.text !== "do") return null;
  const norm = findNormalization(sig, whileIndex, whileEnd);
  if (!norm) return null;
  const tree = parseTree(sig, norm.ifIndex, 64);
  if (!tree || tree.varName !== norm.state) return null;

  const initialRaw = previousNumericAssignment(sig, whileIndex, norm.state);
  if (initialRaw == null) return null;
  const initial = norm.constant - initialRaw;
  if (!Number.isSafeInteger(initial)) return null;

  const memo = new Map<number, LeafRegion | null>();
  const leafFor = (normalized: number): LeafRegion | null => {
    if (memo.has(normalized)) return memo.get(normalized)!;
    const leaf = evaluateNode(tree, normalized);
    memo.set(normalized, leaf);
    return leaf;
  };

  const active = new Set<number>();
  let stateCount = 0;
  const build = (normalized: number, depth: number): string | null => {
    if (depth > opts.maxStates || active.has(normalized)) return null;
    if (stateCount++ > opts.maxStates) return null;
    active.add(normalized);
    try {
      const leaf = leafFor(normalized);
      if (!leaf) return null;
      const body = sourceOf(sig, src, leaf.start, leaf.end).trim();
      if (!body) return null;
      const tr = parseTransition(body, norm.state);
      if (tr.kind === "terminal") return body;
      if (tr.kind === "unknown") return null;
      const cleaned = tr.body.trim();
      if (tr.kind === "const") {
        const nextNorm = norm.constant - (tr.state ?? 0);
        const next = build(nextNorm, depth + 1);
        if (next == null) return null;
        return cleaned ? `${cleaned}\n${next}` : next;
      }
      const a = norm.constant - (tr.thenState ?? 0);
      const b = norm.constant - (tr.elseState ?? 0);
      const left = build(a, depth + 1);
      const right = build(b, depth + 1);
      if (left == null || right == null) return null;
      const cond = tr.condition?.trim();
      if (!cond) return null;
      const branch = [
        cleaned,
        `if ${cond} then`,
        indentBlock(left, "  "),
        "else",
        indentBlock(right, "  "),
        "end",
      ].filter(Boolean).join("\n");
      return branch;
    } finally {
      active.delete(normalized);
    }
  };

  const recovered = build(initial, 0);
  if (!recovered) return null;
  if (recovered.length > opts.maxOutput) return null;

  // Ensure we actually removed the dispatcher tree from this loop.
  if (/\bwhile\s+true\s+do\b/i.test(recovered)) return null;
  return {
    start: sig[whileIndex].start,
    end: sig[whileEnd].end,
    text: recovered,
    states: stateCount,
    initial,
    constant: norm.constant,
  };
}

export interface FunctionLevelVmResult {
  result: string;
  changed: number;
  functions: number;
  states: number;
  notes: string[];
}

export function recoverFunctionLevelVm(src: string, opts: { maxFunctions?: number; maxStates?: number; maxOutput?: number } = {}): FunctionLevelVmResult {
  const maxFunctions = Math.max(1, Math.min(64, opts.maxFunctions ?? 24));
  const maxStates = Math.max(8, Math.min(512, opts.maxStates ?? 96));
  const maxOutput = Math.max(4096, Math.min(300_000, opts.maxOutput ?? 120_000));
  let work = src;
  let functions = 0;
  let states = 0;
  const notes: string[] = [];

  for (let round = 0; round < 3 && functions < maxFunctions; round++) {
    const sig = sigTokens(work);
    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (let i = 0; i < sig.length && functions < maxFunctions; i++) {
      if (sig[i].text !== "while") continue;
      const r = recoverFunction(work, sig, i, { maxStates, maxOutput });
      if (!r) continue;
      edits.push(r);
      functions++;
      states += r.states;
      i = sig.findIndex((t) => t.i === i) + 1;
    }
    if (!edits.length) break;
    const next = applyEdits(work, edits);
    if (next === work) break;
    work = next;
  }

  if (functions) {
    notes.push(`function-level VM recovery: structurally inlined ${functions} dispatcher loop(s) / ${states} recovered state visits`);
  }
  return { result: work, changed: functions, functions, states, notes };
}
