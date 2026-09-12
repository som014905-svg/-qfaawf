/**
 * Universal static dispatcher flattener (v6.1).
 *
 * Targets VM/control-flow flattening that stores an integer program counter in
 * a local and then dispatches through a deeply nested numeric decision tree.
 * It supports both direct states and simple affine normalisation such as
 * `state = C - state`, `state = C + state`, `state = state + C` and
 * `state = state - C`.
 *
 * The pass never executes Lua/Luau. It only follows state values that are
 * explicitly assigned as integer constants or selected by a ternary-style
 * `if cond then A else B` expression.
 *
 * Instead of guessing the original source, it rewrites the nested tree into
 * an equivalent flat `if/elseif state == N` dispatcher. Cycles are preserved.
 */

import { LuaToken, tokenize } from "../utils/lua-utils";

interface Tok extends LuaToken { i: number; }
interface Region { start: number; end: number; }
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
interface Transition {
  kind: "const" | "branch" | "terminal" | "unknown";
  state?: number;
  thenState?: number;
  elseState?: number;
  condition?: string;
  body: string;
}
interface Normalizer {
  state: string;
  constant: number | null;
  mode: "identity" | "sub" | "add" | "revsub";
  ifIndex: number;
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

function num(t?: Tok): number | null {
  if (!t || t.kind !== "number") return null;
  const n = Number(t.text.replaceAll("_", ""));
  return Number.isInteger(n) && Number.isFinite(n) ? n : null;
}

function isBlockIf(sig: Tok[], i: number): boolean {
  const prev = sig[i - 1]?.text;
  return !["=", ",", "(", "[", "{", "return", "and", "or", "not"].includes(prev ?? "");
}

function delta(stack: string[], sig: Tok[], i: number): void {
  const x = sig[i].text;
  if (x === "if" && isBlockIf(sig, i)) stack.push("if");
  else if (x === "for" || x === "while" || x === "function" || x === "repeat") stack.push(x);
  else if (x === "do") {
    // A `do` immediately after a `for`/`while` header opens that loop's block;
    // any other `do` opens a standalone block. Converting the pending loop
    // marker (instead of ignoring it) keeps standalone `do ... end` blocks
    // balanced, which matters for dispatchers wrapped in `do ... end`.
    const top = stack[stack.length - 1];
    if (top === "for" || top === "while") stack[stack.length - 1] = "do";
    else stack.push("do");
  } else if (x === "end") {
    if (stack.length) stack.pop();
  } else if (x === "until" && stack[stack.length - 1] === "repeat") stack.pop();
}

function matching(sig: Tok[], start: number): number {
  const stack: string[] = [];
  for (let i = start; i < sig.length; i++) {
    delta(stack, sig, i);
    if (i > start && stack.length === 0) return i;
  }
  return -1;
}

function parseCondition(sig: Tok[], i: number): { varName: string; op: string; value: number } | null {
  const v = sig[i + 1];
  const op = sig[i + 2]?.text;
  const n = num(sig[i + 3]);
  if (!v || v.kind !== "identifier" || n == null) return null;
  if (!["<", "<=", ">", ">=", "==", "~="].includes(op ?? "")) return null;
  return { varName: v.text, op: op!, value: n };
}

function parseIfChain(sig: Tok[], ifIndex: number, overallEnd: number): Array<{ ifIndex: number; varName: string; op: string; value: number; thenStart: number; thenEnd: number; elseStart: number; elseEnd: number; next: number | null }> | null {
  const parts: Array<{ ifIndex: number; varName: string; op: string; value: number; thenStart: number; thenEnd: number; elseStart: number; elseEnd: number; next: number | null }> = [];
  let current = ifIndex;
  for (let guard = 0; guard < 128; guard++) {
    const c = parseCondition(sig, current);
    if (!c) return null;
    let stack: string[] = [];
    let thenStart = -1;
    let thenEnd = -1;
    let elseStart = overallEnd;
    let elseEnd = overallEnd;
    let next: number | null = null;
    // Luau if-EXPRESSIONS (`x = if c then A else B`) are not blocks, but their
    // `then`/`else` tokens sit at stack depth 0 and would otherwise be mistaken
    // for the dispatcher chain's own `then`/`else`. Track their nesting so we
    // only treat the chain's real `then`/`elseif`/`else` as boundaries.
    let exprIf = 0;
    for (let i = current + 4; i < overallEnd; i++) {
      const x = sig[i].text;
      if (x === "if" && !isBlockIf(sig, i)) { exprIf++; continue; }
      if (x === "then" && stack.length === 0 && exprIf === 0 && thenStart < 0) { thenStart = i + 1; continue; }
      if (x === "elseif" && stack.length === 0 && exprIf === 0 && thenEnd < 0) { thenEnd = i; next = i; break; }
      if (x === "else" && stack.length === 0 && exprIf === 0 && thenEnd < 0) { thenEnd = i; elseStart = i + 1; break; }
      if (x === "else" && exprIf > 0) { exprIf--; continue; }
      delta(stack, sig, i);
    }
    if (thenStart < 0) return null;
    if (thenEnd < 0) thenEnd = overallEnd;
    parts.push({ ifIndex: current, ...c, thenStart, thenEnd, elseStart, elseEnd, next });
    if (next == null) break;
    current = next;
  }
  return parts.length ? parts : null;
}

function parseTree(sig: Tok[], ifIndex: number, depth = 64): TreeNode | null {
  if (depth <= 0 || sig[ifIndex]?.text !== "if") return null;
  const overallEnd = matching(sig, ifIndex);
  if (overallEnd < 0) return null;
  const parts = parseIfChain(sig, ifIndex, overallEnd);
  if (!parts?.length) return null;
  const first = parts[0];
  const root: TreeNode = {
    start: ifIndex,
    end: overallEnd,
    varName: first.varName,
    op: first.op,
    value: first.value,
    thenStart: first.thenStart,
    thenEnd: first.thenEnd,
    elseStart: first.elseStart,
    elseEnd: first.elseEnd,
  };
  let cursor = root;
  for (let j = 1; j < parts.length; j++) {
    const p = parts[j];
    const child: TreeNode = {
      start: p.ifIndex,
      end: overallEnd,
      varName: p.varName,
      op: p.op,
      value: p.value,
      thenStart: p.thenStart,
      thenEnd: p.thenEnd,
      elseStart: p.elseStart,
      elseEnd: p.elseEnd,
    };
    cursor.elseNode = child;
    cursor = child;
  }
  const attach = (node: TreeNode, d: number) => {
    if (d <= 0) return;
    if (sig[node.thenStart]?.text === "if") {
      const child = parseTree(sig, node.thenStart, d - 1);
      if (child && child.end === node.thenEnd - 1 && child.varName === node.varName) node.thenNode = child;
    }
    // For a final else arm, parse a nested dispatcher tree if it consumes the
    // complete arm. `elseNode` already represents elseif chains.
    if (!node.elseNode && sig[node.elseStart]?.text === "if") {
      const child = parseTree(sig, node.elseStart, d - 1);
      if (child && child.end === node.elseEnd - 1 && child.varName === node.varName) node.elseNode = child;
    }
    if (node.thenNode) attach(node.thenNode, d - 1);
    if (node.elseNode) attach(node.elseNode, d - 1);
  };
  attach(root, depth);
  return root;
}

function evalTree(node: TreeNode, value: number): Region | null {
  const ok = node.op === "<" ? value < node.value :
    node.op === "<=" ? value <= node.value :
    node.op === ">" ? value > node.value :
    node.op === ">=" ? value >= node.value :
    node.op === "~=" ? value !== node.value : value === node.value;
  const s = ok ? node.thenStart : node.elseStart;
  const e = ok ? node.thenEnd : node.elseEnd;
  const child = ok ? node.thenNode : node.elseNode;
  if (child) return evalTree(child, value);
  return e > s ? { start: s, end: e } : null;
}

function sourceOf(sig: Tok[], src: string, region: Region): string {
  if (region.end <= region.start) return "";
  return src.slice(sig[region.start].start, sig[region.end - 1].end);
}

function parseTransition(body: string, state: string): Transition {
  let text = body.trim().replace(/(?:;\s*)?continue\s*$/i, "").trim();
  const re = new RegExp(`(?:^|[;\\n])\\s*${escapeRe(state)}\\s*=\\s*`, "g");
  let hit: RegExpExecArray | null = null;
  for (let m; (m = re.exec(text)); ) hit = m;
  if (!hit) {
    if (!text || /(?:^|[;\n])\s*(?:break|return(?:\s+[^;\n]+)?)\s*$/i.test(text)) return { kind: "terminal", body: text };
    return { kind: "unknown", body: text };
  }
  const stateStart = hit.index + hit[0].lastIndexOf(state);
  const lhsEnd = stateStart + state.length;
  let rhs = text.slice(lhsEnd).replace(/^\s*=\s*/, "").trim();
  rhs = rhs.replace(/(-?\d+(?:\.\d*)?)\.else\b/g, "$1 else");
  const mConst = rhs.match(/^(-?\d+)\s*$/);
  if (mConst) return { kind: "const", state: Number(mConst[1]), body: text.slice(0, stateStart).trim() };
  const mBranch = rhs.match(/^if\s+([\s\S]*?)\s+then\s+(-?\d+)\s+else\s+(-?\d+)\s*$/);
  if (mBranch) return { kind: "branch", condition: mBranch[1].trim(), thenState: Number(mBranch[2]), elseState: Number(mBranch[3]), body: text.slice(0, stateStart).trim() };
  return { kind: "unknown", body: text.slice(0, stateStart).trim() };
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function detectNormalizer(sig: Tok[], whileStart: number, whileEnd: number): Normalizer | null {
  // Direct dispatcher: `while true do if state < N then ... end`.
  if (sig[whileStart + 3]?.text === "if") {
    const c = parseCondition(sig, whileStart + 3);
    if (c) return { state: c.varName, constant: null, mode: "identity", ifIndex: whileStart + 3 };
  }
  for (let i = whileStart + 1; i + 4 < Math.min(whileEnd, whileStart + 40); i++) {
    const s = sig[i];
    if (s.kind !== "identifier" || sig[i + 1]?.text !== "=") continue;
    const left = sig[i + 2];
    const op = sig[i + 3]?.text;
    const right = sig[i + 4];
    const leftN = num(left);
    const rightN = num(right);
    let mode: Normalizer["mode"] | null = null;
    let constant: number | null = null;
    if (leftN != null && right?.kind === "identifier" && right.text === s.text && op === "-") { mode = "revsub"; constant = leftN; }
    else if (leftN != null && right?.kind === "identifier" && right.text === s.text && op === "+") { mode = "add"; constant = leftN; }
    else if (left?.kind === "identifier" && left.text === s.text && rightN != null && op === "+") { mode = "add"; constant = rightN; }
    else if (left?.kind === "identifier" && left.text === s.text && rightN != null && op === "-") { mode = "sub"; constant = rightN; }
    if (!mode) continue;
    let j = i + 5;
    if (sig[j]?.text === ";") j++;
    while (sig[j]?.text === "do") j++;
    if (sig[j]?.text === "if") return { state: s.text, constant, mode, ifIndex: j };
  }
  return null;
}

function normalize(raw: number, n: Normalizer): number {
  if (n.mode === "identity") return raw;
  if (n.mode === "revsub") return (n.constant ?? 0) - raw;
  if (n.mode === "add") return raw + (n.constant ?? 0);
  if (n.mode === "sub") return raw - (n.constant ?? 0);
  return raw;
}

function denormalize(normalized: number, n: Normalizer): number {
  if (n.mode === "identity") return normalized;
  if (n.mode === "revsub") return (n.constant ?? 0) - normalized;
  if (n.mode === "add") return normalized - (n.constant ?? 0);
  if (n.mode === "sub") return normalized + (n.constant ?? 0);
  return normalized;
}

function findInitialState(sig: Tok[], whileStart: number, state: string): number | null {
  for (let i = whileStart - 1; i >= 2; i--) {
    if (sig[i].text === "function") break;
    if (sig[i].kind === "identifier" && sig[i].text === state && sig[i + 1]?.text === "=") {
      const n = num(sig[i + 2]);
      if (n != null) return n;
    }
  }
  return null;
}

function collectDirectStates(sig: Tok[], src: string, start: number, end: number, state: string): number[] {
  const out = new Set<number>();
  for (let i = start; i + 2 < end; i++) {
    if (sig[i].kind !== "identifier" || sig[i].text !== state || sig[i + 1]?.text !== "=") continue;
    const n = num(sig[i + 2]);
    if (n != null) out.add(n);
    if (sig[i + 2]?.text === "if") {
      const e = matching(sig, i + 2);
      if (e > 0) {
        const inner = src.slice(sig[i + 2].start, sig[e].end);
        const matches = inner.match(/\b(-?\d+)\b/g) ?? [];
        // Only add small-integer-ish literals as potential state targets.
        for (const m of matches) {
          const v = Number(m);
          if (Number.isSafeInteger(v) && Math.abs(v) < 1_000_000_000) out.add(v);
        }
      }
    }
  }
  return [...out];
}

function indent(code: string, pad = "  "): string {
  return code.split(/\r?\n/).map(l => l ? pad + l : l).join("\n");
}

function applyEdit(src: string, start: number, end: number, text: string): string {
  return src.slice(0, start) + text + src.slice(end);
}

export interface StateDispatcherFlattenResult {
  result: string;
  changed: number;
  loops: number;
  states: number;
  notes: string[];
}

export function flattenStateDispatchers(src: string, opts: { maxLoops?: number; maxStates?: number; maxOutput?: number } = {}): StateDispatcherFlattenResult {
  const maxLoops = Math.max(1, Math.min(96, opts.maxLoops ?? 48));
  const maxStates = Math.max(8, Math.min(512, opts.maxStates ?? 192));
  const maxOutput = Math.max(32_000, Math.min(1_500_000, opts.maxOutput ?? 900_000));
  const sig = sigTokens(src);
  const edits: Array<{ start: number; end: number; text: string; states: number }> = [];
  let scanned = 0;

  for (let i = 0; i < sig.length && scanned < maxLoops; i++) {
    if (sig[i].text !== "while" || sig[i + 1]?.text !== "true" || sig[i + 2]?.text !== "do") continue;
    // Do not recursively process a dispatcher already produced by this pass.
    const preview = src.slice(sig[i].start, Math.min(src.length, sig[i].start + 100));
    if (preview.includes("[v6.1-flat]")) continue;
    const end = matching(sig, i);
    if (end < 0) continue;
    const norm = detectNormalizer(sig, i, end);
    if (!norm) continue;
    const tree = parseTree(sig, norm.ifIndex, 64);
    if (!tree || tree.varName !== norm.state) continue;
    const initialRaw = findInitialState(sig, i, norm.state);
    const seed = initialRaw == null ? null : normalize(initialRaw, norm);
    const candidates = new Set<number>();
    if (seed != null) candidates.add(seed);
    for (const raw of collectDirectStates(sig, src, i, end, norm.state)) candidates.add(normalize(raw, norm));
    if (!candidates.size) continue;

    const queue = [...candidates];
    const seen = new Set<number>();
    const cases: Array<{ state: number; body: string; transition: Transition }> = [];
    while (queue.length && seen.size < maxStates) {
      const stateValue = queue.shift()!;
      if (seen.has(stateValue)) continue;
      seen.add(stateValue);
      const region = evalTree(tree, stateValue);
      if (!region) continue;
      const body = sourceOf(sig, src, region).trim();
      if (!body) continue;
      const tr = parseTransition(body, norm.state);
      cases.push({ state: stateValue, body, transition: tr });
      if (tr.kind === "const" && tr.state != null) queue.push(normalize(tr.state, norm));
      else if (tr.kind === "branch" && tr.thenState != null && tr.elseState != null) queue.push(normalize(tr.thenState, norm), normalize(tr.elseState, norm));
    }
    if (cases.length < 2) continue;

    const sorted = [...cases].sort((a, b) => a.state - b.state);
    const arms: string[] = [];
    for (let k = 0; k < sorted.length; k++) {
      const c = sorted[k];
      let body = c.body.replace(/(?:;\s*)?continue\s*$/i, "").trim();
      const head = k === 0 ? `if ${norm.state} == ${c.state}` : `elseif ${norm.state} == ${c.state}`;
      arms.push(`${head} then\n${indent(body, "  ")}`);
    }
    arms.push("end");
    const pieces = ["while true do", "  -- [v6.1-flat] statically recovered dispatcher", ...(norm.mode === "identity" ? [] : [`  ${norm.state} = ${formatNormalizer(norm)}`]), indent(arms.join("\n  "), "  "), "end"];
    const replacement = pieces.join("\n");
    if (replacement.length > maxOutput) continue;
    edits.push({ start: sig[i].start, end: sig[end].end, text: replacement, states: cases.length });
    scanned++;
  }

  // Drop nested edits; an outer dispatcher replacement already contains its
  // inner loops verbatim and therefore subsumes those offsets.
  edits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof edits = [];
  let cursor = -1;
  for (const e of edits) {
    if (e.start < cursor) continue;
    kept.push(e);
    cursor = e.end;
  }
  let work = src;
  for (let j = kept.length - 1; j >= 0; j--) work = applyEdit(work, kept[j].start, kept[j].end, kept[j].text);
  if (work.length > maxOutput && src.length <= maxOutput) return { result: src, changed: 0, loops: 0, states: 0, notes: ["dispatcher flattening rejected because output exceeded size guard."] };
  const statesTotal = kept.reduce((n, e) => n + e.states, 0);
  const notes = kept.length ? [`universal state-dispatch flattening changed ${kept.length} loop(s) and analysed ${statesTotal} state(s).`] : [];
  return { result: work, changed: kept.length, loops: kept.length, states: statesTotal, notes };
}

function formatNormalizer(n: Normalizer): string {
  // The exact expression must preserve the original state transformation.
  if (n.mode === "identity") return n.state;
  if (n.mode === "revsub") return `${n.constant} - ${n.state}`;
  if (n.mode === "add") return `${n.state} + ${n.constant}`;
  if (n.mode === "sub") return `${n.state} - ${n.constant}`;
  return n.state;
}
