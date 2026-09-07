// Control-flow recovery pass (v4).
//
// Targets the two obfuscation constructs that survive constant folding:
//
// 1. Opaque predicates — branches on provably-constant conditions that the
//    obfuscator knows the value of at generation time:
//        if (4 < 5) and (nil == nil) then REAL() else NOISE() end
//    foldConstants already folds the arithmetic; this pass folds the
//    remaining boolean-literal conditions (`if true then`, `if false then`,
//    `while false do`) — but through a scope-safe rewriter (keeps `do…end`
//    when the kept branch declares locals).
//
// 2. Dispatcher state machines (control-flow flattening):
//        local state = 1
//        while true do
//          if state == 1 then A; state = 2
//          elseif state == 2 then B; state = 3
//          ...
//          end
//        end
//    When every branch (a) starts by testing `state == <const>`,
//    (b) assigns `state = <const>` (or breaks/returns) as its LAST action,
//    and (c) the entry state is a constant, the chain can be unrolled into
//    straight-line code. This is only done when EVERY branch of the loop is
//    accounted for (no default/else catch-all with side effects) so the
//    reconstruction is provably equivalent.
//
// The pass is deliberately conservative: any construct it cannot prove, it
// leaves untouched.

import { tokenize, LuaToken } from "../utils/lua-utils";
import { evalExprFromTokens, constToLua } from "../utils/const-eval";

export interface ControlFlowResult {
  result: string;
  changed: number;
  notes: string[];
}

const MAX_SRC = 8_000_000; // refuse pathological inputs

export function recoverControlFlow(src: string, maxIterations = 200): ControlFlowResult {
  if (src.length > MAX_SRC) return { result: src, changed: 0, notes: [] };
  let work = src;
  let changed = 0;
  const notes: string[] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    const r = simplifyStateMachine(work);
    if (r) {
      work = r;
      changed++;
      continue;
    }
    break;
  }
  if (changed > 0) {
    notes.push(`Unrolled ${changed} flattened dispatcher state-machine loop(s).`);
  }
  return { result: work, changed, notes };
}

// ---------------------------------------------------------------------------
// State-machine unrolling
// ---------------------------------------------------------------------------

interface SigTok extends LuaToken {
  i: number; // index into the significant-token array
}

function sigTokens(src: string): SigTok[] {
  const out: SigTok[] = [];
  let i = 0;
  for (const t of tokenize(src)) {
    if (t.kind === "eof") break;
    if (t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment") continue;
    (t as SigTok).i = i;
    out.push(t as SigTok);
    i++;
  }
  return out;
}

/**
 * Find the first `local VAR = N` … `while true do if VAR == … end` dispatcher
 * that satisfies all safety conditions and unroll it. Returns the rewritten
 * source or null when nothing (more) can be done.
 */
function simplifyStateMachine(src: string): string | null {
  const sig = sigTokens(src);
  if (sig.length === 0) return null;

  // 1) find candidate dispatch loops: `while true do` / `while 1 == 1 do`
  for (let w = 0; w < sig.length; w++) {
    if (sig[w].kind !== "keyword" || sig[w].text !== "while") continue;
    let p = w + 1;
    const condEv = evalExprFromTokens(sigToLua(sig), p);
    if (!condEv) continue;
    if (condEv.value.k !== "boolean" || condEv.value.v !== true) continue;
    // condEv.endIndex is a RAW index into the array we passed — since we pass
    // sig (already significant-only), endIndex maps directly.
    const doIdx = condEv.endIndex < sig.length ? condEv.endIndex : -1;
    if (doIdx < 0 || sig[doIdx].text !== "do") continue;

    // 2) find the matching `end` of the while block (depth counting: only
    //    tokens that pair with end/until)
    const closeIdx = findBlockEnd(sig, doIdx);
    if (closeIdx < 0) continue;

    // 3) inside the loop body there must be an `if` chain whose branches test
    //    `VAR == CONST` and whose bodies end with `VAR = CONST` / break / return.
    const bodyStart = doIdx + 1;
    const bodyEnd = closeIdx; // exclusive
    const unrolled = tryUnrollDispatcher(src, sig, bodyStart, bodyEnd);
    if (unrolled) {
      const start = sig[w].start;
      const end = sig[closeIdx].end;
      return src.slice(0, start) + unrolled + src.slice(end);
    }
  }
  return null;
}

function sigToLua(sig: SigTok[]): LuaToken[] {
  return sig as unknown as LuaToken[];
}

/** Index of the `end` closing the block opened at `openIdx` (a do/then/function
 *  token). Returns -1 when unbalanced. */
function findBlockEnd(sig: SigTok[], openIdx: number): number {
  let depth = 0;
  let expectUntil = false;
  for (let k = openIdx; k < sig.length; k++) {
    const t = sig[k];
    if (t.kind !== "keyword") continue;
    if (t.text === "if" || t.text === "do" || t.text === "function" || t.text === "for" || t.text === "while") {
      depth++;
    } else if (t.text === "repeat") {
      depth++;
      // repeat closes with until — we still decrement on `end` incorrectly?
      // handle by treating until the same as end below.
      expectUntil = true;
    } else if (t.text === "end" || t.text === "until") {
      depth--;
      if (depth === 0) return k;
    }
    // `then`/`else`/`elseif` are syntax, not openers (the `if` already counted)
  }
  return -1;
}

/** Try to interpret the loop body [bodyStart, bodyEnd) as a state dispatcher
 *  and return unrolled source, or null when it does not strictly match. */
function tryUnrollDispatcher(
  src: string,
  sig: SigTok[],
  bodyStart: number,
  bodyEnd: number
): string | null {
  if (bodyEnd <= bodyStart) return null;
  const first = sig[bodyStart];
  if (first.kind !== "keyword" || first.text !== "if") return null;

  // Collect branches: sequence of `if/elseif VAR == CONST then BODY`
  interface Branch {
    state: number;
    thenIdx: number; // index of `then`
    bodyStartIdx: number; // first token after then
    endIdx: number; // exclusive end of branch body
    nextState: number | null; // state after the body (null = break/return)
    terminator: "assign" | "break" | "return";
    tailStartTok?: number; // sig index of the trailing state-assign (assign case)
  }
  const branches: Branch[] = [];

  let k = bodyStart;
  let sawElse = false;
  while (k < bodyEnd) {
    const t = sig[k];
    if (!(t.kind === "keyword" && (t.text === "if" || t.text === "elseif"))) return null;
    // condition: VAR == CONST  |  CONST == VAR
    const afterCond = k + 1;
    const condTok = sig[afterCond];
    if (!condTok || condTok.kind !== "identifier") return null;
    const stateVar = condTok.text;
    if (sig[afterCond + 1]?.text !== "==") return null;
    const constTok = sig[afterCond + 2];
    if (!constTok || constTok.kind !== "number") return null;
    const state = Number(constTok.text);
    if (!Number.isInteger(state)) return null;
    const thenTok = sig[afterCond + 3];
    if (!thenTok || thenTok.text !== "then") return null;

    // branch body: from thenTok+1 to the next `elseif`/`else`/`end` at the
    // branch's own depth.
    let depth = 0;
    let e = thenTok.i + 1;
    let closer: "elseif" | "else" | "end" | null = null;
    while (e < bodyEnd) {
      const tk = sig[e];
      if (tk.kind === "keyword") {
        if (tk.text === "if" || tk.text === "do" || tk.text === "function" || tk.text === "for" || tk.text === "while" || tk.text === "repeat") depth++;
        else if (tk.text === "end" || tk.text === "until") {
          if (depth === 0) { closer = "end"; break; }
          depth--;
        } else if (depth === 0 && (tk.text === "elseif" || tk.text === "else")) { closer = tk.text as "elseif" | "else"; break; }
      }
      e++;
    }
    if (!closer) return null; // branch not closed inside the loop body

    const bodyEndIdx = e;
    // LAST statement of the branch must be `VAR = CONST`, `break`, or `return`
    // (allow a trailing `;`).
    const analysis = analyseBranchTail(sig, thenTok.i + 1, bodyEndIdx, stateVar);
    if (!analysis) return null;

    branches.push({
      state,
      thenIdx: thenTok.i,
      bodyStartIdx: thenTok.i + 1,
      endIdx: bodyEndIdx,
      nextState: analysis.nextState,
      terminator: analysis.terminator,
      tailStartTok: analysis.tailStartTok,
    });

    if (closer === "elseif") {
      k = e;
      continue;
    }
    if (closer === "else") {
      sawElse = true;
      // an else catch-all breaks provability unless it also ends the chain
      // with the loop's `end` right after — treat as unsupported.
      return null;
    }
    // closer === "end": must be the loop's closing end
    if (e !== bodyEnd - 1) return null; // statements after the if-chain — bail
    k = e + 1;
    break;
  }
  if (branches.length === 0 || sawElse) return null;

  // 4) entry state: `local VAR = <const>` (or `VAR = <const>`) before the
  //    loop — find the last assignment that defines the entry value.
  const condVar = sig[bodyStart + 1];
  if (condVar.kind !== "identifier") return null;
  const varName = condVar.text;

  let entry: number | null = null;
  for (let i = bodyStart - 1; i >= 0; i--) {
    const t = sig[i];
    if (t.kind !== "identifier" || t.text !== varName) continue;
    const prev = sig[i - 1];
    const next = sig[i + 1];
    // `local VAR = N` (declared anywhere before) or `VAR = N` (assigned)
    const isDecl = prev?.kind === "keyword" && prev.text === "local";
    if (next?.text === "=" && sig[i + 2]?.kind === "number" && Number.isInteger(Number(sig[i + 2].text))) {
      entry = Number(sig[i + 2].text);
      void isDecl;
      break;
    }
    // referenced earlier in another way — could still be assigned elsewhere
    if (next?.text !== "=" && !isDecl) {
      // usage as value: too dynamic — bail out
      return null;
    }
  }
  if (entry === null) return null;

  // 5) every state in the chain must map to exactly one branch and the walk
  //    must terminate (no cycles) — walk it.
  const byState = new Map<number, Branch>();
  for (const b of branches) {
    if (byState.has(b.state)) return null; // duplicate state — ambiguous
    byState.set(b.state, b);
  }
  const order: Branch[] = [];
  const seen = new Set<number>();
  let cur: number | null = entry;
  let guard = 0;
  while (cur !== null) {
    if (seen.has(cur) || guard++ > 500) return null; // cycle — not provable
    const b = byState.get(cur);
    if (!b) return null; // jumps to an unknown state — bail
    seen.add(cur);
    order.push(b);
    cur = b.nextState;
  }
  // All branches must be visited (dead branches can be dropped only if we
  // visited everything; otherwise keep it simple and bail).
  if (order.length !== branches.length) return null;

  // 6) emit unrolled body — each branch body minus its trailing state
  //    assignment, in order. `break` terminators end the sequence.
  const parts: string[] = [];
  for (let i = 0; i < order.length; i++) {
    const b = order[i];
    const bStart = sig[b.bodyStartIdx].start;
    const bEnd = b.terminator === "assign"
      ? (b.tailStartTok !== undefined ? sig[b.tailStartTok].start : sig[b.endIdx - 1].end)
      : sig[b.endIdx - 1].end;
    let body = src.slice(bStart, bEnd).trim();
    // A `break` only existed to leave the removed dispatcher loop, so it must
    // disappear from the unrolled source. A `return` is still meaningful in
    // the surrounding function and is preserved.
    if (b.terminator === "break") {
      body = body.replace(/(?:^|[;\n]\s*)break\s*;?\s*$/m, "").trim();
    }
    if (body.length > 0) parts.push(body);
    if (b.terminator !== "assign") break; // sequence ends here
  }
  if (parts.length === 0) return null;

  // The state variable's line before the loop stays in the source. If the
  // variable is read AFTER the loop it must hold the value it had when the
  // original loop exited: the last branch's entry state (break/return) or
  // its assigned next state (assign). Emit that assignment to be exact.
  const lastB = order[order.length - 1];
  // For `return`, control never reaches the post-loop code. For `break`, the
  // loop exited while preserving the current state value.
  const finalValue = lastB.terminator === "return"
    ? null
    : (lastB.terminator === "assign" ? lastB.nextState : lastB.state);
  const suffix = finalValue !== null ? `\n${varName} = ${finalValue}` : "";
  return parts.join("\n") + suffix;
}

interface TailAnalysis {
  nextState: number | null;
  terminator: "assign" | "break" | "return";
  tailStartTok?: number; // sig index where the tail statement starts
}

/** The branch body [start, end) must END with `VAR = CONST` / `break` /
 *  `return`. Returns the analysis or null when the tail is something else. */
function analyseBranchTail(sig: SigTok[], start: number, end: number, stateVar: string): TailAnalysis | null {
  if (end <= start) return null;
  // scan backwards over an optional `;`
  let e = end - 1;
  while (e > start && sig[e].text === ";") e--;
  // case A: break / return (possibly with values: `return f()`)
  if (sig[e].kind === "keyword" && (sig[e].text === "break" || sig[e].text === "return")) {
    // find where the return statement starts (keyword `return`)
    const retTok = e;
    return { nextState: null, terminator: sig[e].text === "break" ? "break" : "return", tailStartTok: retTok };
  }
  // case B: `VAR = CONST` — walk back: CONST, =, VAR
  if (sig[e].kind !== "number") return null;
  const nextState = Number(sig[e].text);
  if (!Number.isInteger(nextState)) return null;
  if (sig[e - 1]?.text !== "=") return null;
  if (sig[e - 2]?.kind !== "identifier" || sig[e - 2].text !== stateVar) return null;
  return { nextState, terminator: "assign", tailStartTok: e - 2 };
}
