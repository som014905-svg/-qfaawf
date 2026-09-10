import { tokenize, LuaToken } from "../utils/lua-utils";

export interface DispatcherAnalysis {
  comparisons: number;
  leaves: number;
  variables: string[];
  stateAssignments: number;
  candidate: boolean;
  confidence: number;
  notes: string[];
}

export interface BinaryTreeDispatchResult {
  result: string;
  changed: number;
  flattenedLeaves: number;
  analyses: DispatcherAnalysis[];
  notes: string[];
}

interface Tok extends LuaToken { i: number; }
interface Leaf { start: number; end: number; depth: number; path: string[] }
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
  leaves: Leaf[];
}

function sigTokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  for (const t of tokenize(src)) {
    if (t.kind === "eof" || t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment") continue;
    out.push(Object.assign(t, { i: i++ }));
  }
  return out as Tok[];
}

function numberValue(t?: Tok): number | null {
  if (!t || t.kind !== "number") return null;
  const n = Number(t.text.replaceAll("_", ""));
  return Number.isFinite(n) && Number.isSafeInteger(n) ? n : null;
}

function findMatchingBlock(sig: Tok[], openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < sig.length; i++) {
    const x = sig[i];
    if (x.text === "if" || x.text === "function" || x.text === "do" || x.text === "for" || x.text === "while" || x.text === "repeat") depth++;
    else if (x.text === "end" || x.text === "until") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findIfBranches(sig: Tok[], ifIndex: number): { thenStart: number; thenEnd: number; elseStart: number; elseEnd: number; close: number } | null {
  let depth = 0;
  let thenStart = -1;
  let thenEnd = -1;
  let elseStart = -1;
  let elseEnd = -1;
  for (let i = ifIndex + 1; i < sig.length; i++) {
    const x = sig[i];
    if (x.text === "then" && depth === 0 && thenStart < 0) { thenStart = i + 1; continue; }
    if (x.text === "if" || x.text === "function" || x.text === "do" || x.text === "for" || x.text === "while" || x.text === "repeat") depth++;
    else if (x.text === "end" || x.text === "until") {
      if (depth === 0) {
        if (thenEnd < 0) thenEnd = i;
        else if (elseStart >= 0 && elseEnd < 0) elseEnd = i;
        return { thenStart, thenEnd, elseStart, elseEnd: elseEnd >= 0 ? elseEnd : i, close: i };
      }
      depth--;
    } else if (depth === 0 && x.text === "else" && thenEnd < 0) {
      thenEnd = i;
      elseStart = i + 1;
    } else if (depth === 0 && x.text === "elseif") {
      // A binary dispatcher requires a strict if/else shape. Stop here.
      return null;
    }
  }
  return null;
}

function parseTree(sig: Tok[], ifIndex: number, maxLeaves: number): TreeNode | null {
  const v = sig[ifIndex + 1];
  const op = sig[ifIndex + 2]?.text;
  const n = numberValue(sig[ifIndex + 3]);
  if (!v || v.kind !== "identifier" || !op || !["<", "<=", ">", ">=", "=="].includes(op) || n == null) return null;
  const b = findIfBranches(sig, ifIndex);
  if (!b || b.thenStart < 0 || b.thenEnd <= b.thenStart || b.elseStart < 0 || b.elseEnd <= b.elseStart) return null;
  const node: TreeNode = {
    start: ifIndex,
    end: b.close,
    varName: v.text,
    op,
    value: n,
    thenStart: b.thenStart,
    thenEnd: b.thenEnd,
    elseStart: b.elseStart,
    elseEnd: b.elseEnd,
    leaves: [],
  };
  if (sig[b.thenStart]?.text === "if") {
    const child = parseTree(sig, b.thenStart, maxLeaves);
    if (child && child.end === b.thenEnd - 1) node.thenNode = child;
  }
  if (sig[b.elseStart]?.text === "if") {
    const child = parseTree(sig, b.elseStart, maxLeaves);
    if (child && child.end === b.elseEnd - 1) node.elseNode = child;
  }
  const collect = (start: number, end: number, depth: number, path: string[]) => {
    if (node.leaves.length > maxLeaves) return;
    if (sig[start]?.text === "if") {
      const child = parseTree(sig, start, maxLeaves - node.leaves.length);
      if (!child || child.end !== end - 1) {
        node.leaves.push({ start, end, depth, path });
        return;
      }
      if (child) {
        for (const l of child.leaves) node.leaves.push({ ...l, depth: l.depth + depth, path: [...path, ...l.path] });
        return;
      }
    }
    node.leaves.push({ start, end, depth, path });
  };
  collect(b.thenStart, b.thenEnd, 1, [`${node.varName}${node.op}${node.value}:T`]);
  collect(b.elseStart, b.elseEnd, 1, [`${node.varName}${node.op}${node.value}:F`]);
  return node;
}

function gatherNestedCandidate(sig: Tok[], startAt: number, maxLeaves = 96): { node: TreeNode; confidence: number } | null {
  const root = parseTree(sig, startAt, maxLeaves);
  if (!root) return null;
  const allLeaves = root.leaves.length;
  if (allLeaves < 4 || allLeaves > maxLeaves) return null;
  const vars = new Set<string>();
  let comparisons = 0;
  const walk = (n: TreeNode) => {
    vars.add(n.varName); comparisons++;
    if (n.thenNode) walk(n.thenNode);
    if (n.elseNode) walk(n.elseNode);
  };
  walk(root);
  if (vars.size !== 1) return null;
  const confidence = Math.min(0.99, 0.58 + comparisons / 180);
  return { node: root, confidence };
}

function flattenSmallTree(src: string, sig: Tok[], node: TreeNode): string | null {
  if (!node.leaves.length || node.leaves.length > 96) return null;
  const varName = node.varName;
  const leaves: Array<{ start:number; end:number; lower:number|null; upper:number|null }> = [];

  const collect = (n: TreeNode, lower: number|null, upper: number|null): boolean => {
    if (n.op !== "<" || n.varName !== varName) return false;
    const thenLower = lower;
    const thenUpper = upper == null ? n.value : Math.min(upper, n.value);
    const elseLower = lower == null ? n.value : Math.max(lower, n.value);
    const elseUpper = upper;
    const thenIsChild = !!n.thenNode && sig[n.thenStart]?.text === "if" && n.thenNode.end === n.thenEnd - 1;
    const elseIsChild = !!n.elseNode && sig[n.elseStart]?.text === "if" && n.elseNode.end === n.elseEnd - 1;
    if (thenIsChild) { if (!collect(n.thenNode!, thenLower, thenUpper)) return false; }
    else leaves.push({ start:n.thenStart, end:n.thenEnd, lower:thenLower, upper:thenUpper });
    if (elseIsChild) { if (!collect(n.elseNode!, elseLower, elseUpper)) return false; }
    else leaves.push({ start:n.elseStart, end:n.elseEnd, lower:elseLower, upper:elseUpper });
    return true;
  };
  if (!collect(node, null, null)) return null;
  if (leaves.length < 4 || leaves.length > 96) return null;
  leaves.sort((a,b) => (a.lower ?? Number.NEGATIVE_INFINITY) - (b.lower ?? Number.NEGATIVE_INFINITY));
  // Exact partition proof: first interval must start at -inf, adjacent bounds
  // must meet, and the final interval must end at +inf.
  if (leaves[0].lower !== null) return null;
  for (let i=1;i<leaves.length;i++) if (leaves[i].lower !== leaves[i-1].upper) return null;
  if (leaves[leaves.length-1].upper !== null) return null;

  const lines: string[] = [];
  for (let i=0;i<leaves.length;i++) {
    const l=leaves[i];
    if (i===0) lines.push(`if ${varName} < ${l.upper} then`);
    else if (i===leaves.length-1) lines.push("else");
    else lines.push(`elseif ${varName} < ${l.upper} then`);
    const body = src.slice(sig[l.start].start, sig[l.end-1].end).trim();
    if (!body) return null;
    for (const line of body.split(/\r?\n/)) lines.push(`  ${line}`);
  }
  lines.push("end");
  return applyEdits(src, [{ start:sig[node.start].start, end:sig[node.end].end, text:lines.join("\n") }]);
}

function maxDepth(n: TreeNode, d = 1): number {
  return Math.max(d, n.thenNode ? maxDepth(n.thenNode, d + 1) : d, n.elseNode ? maxDepth(n.elseNode, d + 1) : d);
}

function applyEdits(src: string, edits: Array<{ start: number; end: number; text: string }>): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let p = 0; const out: string[] = [];
  for (const e of sorted) { if (e.start < p) continue; out.push(src.slice(p, e.start), e.text); p = e.end; }
  out.push(src.slice(p)); return out.join("");
}

export function analyzeBinaryTreeDispatch(src: string, maxLeaves = 96): DispatcherAnalysis[] {
  const sig = sigTokens(src);
  const out: DispatcherAnalysis[] = [];
  for (let i = 0; i < sig.length; i++) {
    if (sig[i].text !== "if") continue;
    const c = gatherNestedCandidate(sig, i, maxLeaves);
    if (!c) continue;
    const comparisons = countComparisons(c.node);
    const leaves = c.node.leaves.length;
    const assignments = countStateAssignments(src, sig, c.node);
    out.push({
      comparisons,
      leaves,
      variables: [c.node.varName],
      stateAssignments: assignments,
      candidate: true,
      confidence: c.confidence,
      notes: [
        `nested numeric dispatcher candidate: ${comparisons} comparison node(s), ${leaves} leaf region(s)`,
        `state-like assignments detected: ${assignments}`,
      ],
    });
    i = Math.max(i, c.node.end);
  }
  return out;
}

function countComparisons(n: TreeNode): number { return 1 + (n.thenNode ? countComparisons(n.thenNode) : 0) + (n.elseNode ? countComparisons(n.elseNode) : 0); }
function countStateAssignments(src: string, sig: Tok[], n: TreeNode): number {
  const a = sig[n.start]?.start ?? 0; const b = sig[n.end]?.end ?? 0;
  const chunk = src.slice(a, b);
  return (chunk.match(new RegExp(`\\b${escapeRegex(n.varName)}\\s*=\\s*-?\\d+\\b`, "g")) || []).length;
}
function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function recoverBinaryTreeDispatch(src: string, opts: { maxLeaves?: number; maxRewrites?: number } = {}): BinaryTreeDispatchResult {
  const maxLeaves = Math.max(8, Math.min(96, opts.maxLeaves ?? 64));
  const maxRewrites = Math.max(0, Math.min(8, opts.maxRewrites ?? 3));
  let work = src; let changed = 0; let flattenedLeaves = 0; const notes: string[] = [];
  const analyses = analyzeBinaryTreeDispatch(work, maxLeaves);
  for (let pass = 0; pass < maxRewrites; pass++) {
    const sig = sigTokens(work);
    let did = false;
    for (let i = 0; i < sig.length; i++) {
      if (sig[i].text !== "if") continue;
      const c = gatherNestedCandidate(sig, i, maxLeaves);
      if (!c) continue;
      const beforeDepth = maxDepth(c.node);
      const candidate = flattenSmallTree(work, sig, c.node);
      if (!candidate || candidate === work) continue;
      work = candidate; changed++; flattenedLeaves += c.node.leaves.length; did = true;
      notes.push(`flattened one numeric decision tree (${c.node.leaves.length} leaf regions, depth ${beforeDepth}).`);
      break;
    }
    if (!did) break;
  }
  if (analyses.length) notes.push(`analyzed ${analyses.length} numeric dispatcher candidate(s).`);
  return { result: work, changed, flattenedLeaves, analyses, notes };
}
