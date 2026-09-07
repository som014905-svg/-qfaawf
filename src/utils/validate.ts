// Lightweight Lua/Luau syntax validator.
//
// Used by the orchestrator after deobfuscation to give the user a confidence
// signal about the recovered output. This is a STATIC check only — it does
// not execute any user code.
//
// The validator checks:
//   1. Bracket balance: (), [], {}.
//   2. Block-keyword balance: do/end, then/end, function/end, if/end,
//      for/end, while/end, repeat/until.
//   3. Token-level sanity: no stray `end`/`then`/`until` without an opener,
//      no unterminated string/long-bracket.
//   4. Cheap structural red-flags: `end end end` stacks without openers,
//      `(` count == `)` count, etc.
//
// It returns a list of issues (with line numbers when possible) and a
// boolean `ok`. `ok` does NOT mean the source is valid Lua — it means no
// obvious structural defect was found by this static pass.

import { tokenize, LuaToken } from "./lua-utils";

export interface ValidationIssue {
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Quick summary string for embedding. */
  summary: string;
  /** Counts used by quality scoring. */
  stats: {
    parenBalance: boolean;
    bracketBalance: boolean;
    braceBalance: boolean;
    blockBalance: boolean;
    unterminatedStrings: number;
    excessEnds: number;
  };
}

export function validateLuaSource(src: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const stats = {
    parenBalance: true,
    bracketBalance: true,
    braceBalance: true,
    blockBalance: true,
    unterminatedStrings: 0,
    excessEnds: 0,
  };

  // Pre-compute line offsets for line/column conversion.
  const lineStarts: number[] = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\n") lineStarts.push(i + 1);
  }
  const posToLineCol = (pos: number): { line: number; column: number } => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: pos - lineStarts[lo] + 1 };
  };

  let tokens: LuaToken[];
  try {
    tokens = [...tokenize(src)];
  } catch (e: unknown) {
    return {
      ok: false,
      issues: [{ line: 1, column: 1, severity: "error", message: `lexer failure: ${e instanceof Error ? e.message : String(e)}` }],
      summary: "lexer failure",
      stats,
    };
  }

  // 1) Bracket balance (per kind).
  const stack: Array<{ tok: LuaToken; kind: "paren" | "bracket" | "brace" }> = [];
  for (const t of tokens) {
    if (t.kind !== "punct") continue;
    if (t.text === "(" || t.text === "[" || t.text === "{") {
      stack.push({ tok: t, kind: t.text === "(" ? "paren" : t.text === "[" ? "bracket" : "brace" });
    } else if (t.text === ")" || t.text === "]" || t.text === "}") {
      const expected = t.text === ")" ? "paren" : t.text === "]" ? "bracket" : "brace";
      const top = stack.pop();
      if (!top) {
        const { line, column } = posToLineCol(t.start);
        issues.push({ line, column, severity: "error", message: `unmatched closing '${t.text}'` });
      } else if (top.kind !== expected) {
        const { line, column } = posToLineCol(t.start);
        issues.push({
          line,
          column,
          severity: "error",
          message: `mismatched bracket: '${top.tok.text}' opened but '${t.text}' closes`,
        });
      }
    }
  }
  for (const unc of stack) {
    const { line, column } = posToLineCol(unc.tok.start);
    issues.push({ line, column, severity: "error", message: `unclosed '${unc.tok.text}'` });
  }
  stats.parenBalance = true;
  stats.bracketBalance = true;
  stats.braceBalance = true;
  for (const issue of issues) {
    if (issue.message.includes("'('") || issue.message.includes("')'")) stats.parenBalance = false;
    if (issue.message.includes("'['") || issue.message.includes("']'")) stats.bracketBalance = false;
    if (issue.message.includes("'{'") || issue.message.includes("'}'")) stats.braceBalance = false;
  }

  // 2) Block-keyword balance. In Lua:
  //    - `if`, `function`, `do` open a block that closes with `end`.
  //    - `repeat` opens a block that closes with `until`.
  //    - `for`/`while` are NOT openers on their own — their block is opened
  //      by the trailing `do`. `then`/`else`/`elseif` are syntax, not openers.
  //    - Luau if-EXPRESSIONS (`x = if c then a else b`) open no block: an
  //      `if` preceded by an operator / `=` / `,` / `return` / `(` etc. is
  //      an expression, not a statement.
  const blockStack: Array<{ tok: LuaToken; kind: string }> = [];
  const EXPR_PREV = new Set([
    "=", ",", "(", "{", "[", "return", "or", "and", "not", "..",
    "+", "-", "*", "/", "%", "^", "==", "~=", "<", ">", "<=", ">=", "#",
  ]);
  let prevSig: LuaToken | null = null;
  for (const t of tokens) {
    if (t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment" || t.kind === "eof") {
      continue;
    }
    if (t.kind === "keyword") {
      if (t.text === "if") {
        const prevText = prevSig?.text ?? "";
        if (!EXPR_PREV.has(prevText)) {
          blockStack.push({ tok: t, kind: "if" });
        }
      } else if (t.text === "function" || t.text === "do" || t.text === "repeat") {
        blockStack.push({ tok: t, kind: t.text });
      } else if (t.text === "end") {
        const top = blockStack.pop();
        if (!top) {
          stats.excessEnds++;
          const { line, column } = posToLineCol(t.start);
          issues.push({ line, column, severity: "error", message: "`end` without matching block opener" });
        }
      } else if (t.text === "until") {
        // pop until we find a repeat
        let found = false;
        while (blockStack.length > 0) {
          const top = blockStack.pop()!;
          if (top.kind === "repeat") { found = true; break; }
          const { line, column } = posToLineCol(top.tok.start);
          issues.push({ line, column, severity: "error", message: `block '${top.kind}' not closed before 'until'` });
        }
        if (!found) {
          const { line, column } = posToLineCol(t.start);
          issues.push({ line, column, severity: "error", message: "`until` without matching `repeat`" });
        }
      }
    }
    prevSig = t;
  }
  for (const unc of blockStack) {
    const { line, column } = posToLineCol(unc.tok.start);
    issues.push({ line, column, severity: "error", message: `unclosed block '${unc.kind}'` });
  }
  stats.blockBalance = !issues.some((i) =>
    i.message.includes("without matching") ||
    i.message.includes("unclosed block") ||
    i.message.includes("not closed before")
  );

  // 3) Unterminated strings / long strings. The lexer emits these as
  //    string/longstring tokens that run to EOF — we detect them by
  //    checking whether the raw text actually ends with a closing quote/bracket.
  for (const t of tokens) {
    if (t.kind === "string") {
      if (t.text.length < 2 || (t.text[0] !== '"' && t.text[0] !== "'") ||
          t.text[t.text.length - 1] !== t.text[0]) {
        stats.unterminatedStrings++;
        const { line, column } = posToLineCol(t.start);
        issues.push({ line, column, severity: "error", message: "unterminated string literal" });
      }
    }
    if (t.kind === "longstring") {
      // The lexer runs to EOF on unterminated long strings.
      const openEq = t.text.match(/^\[(=*)\[/);
      const close = "]" + (openEq ? openEq[1] : "") + "]";
      if (!t.text.endsWith(close)) {
        stats.unterminatedStrings++;
        const { line, column } = posToLineCol(t.start);
        issues.push({ line, column, severity: "error", message: "unterminated long-bracket string" });
      }
    }
  }

  // 4) v4: truncated-output heuristic — the source ends right after an
  //    incomplete statement (open string / open long bracket already caught
  //    above; here: ends with a binary operator or a comma).
  if (tokens.length > 1) {
    let lastSig: LuaToken | null = null;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (t.kind === "eof" || t.kind === "whitespace" || t.kind === "newline" || t.kind === "comment" || t.kind === "longcomment") continue;
      lastSig = t;
      break;
    }
    const TRAILING_JUNK = new Set([
      "+", "-", "*", "/", "%", "^", "..", "==", "~=", "<", ">", "<=", ">=",
      "//", "<<", ">>", "&", "|", "~", ",", ".", "=", "and", "or",
    ]);
    if (lastSig && TRAILING_JUNK.has(lastSig.text)) {
      issues.push({
        line: 1,
        column: 1,
        severity: "warning",
        message: `output appears truncated (ends with '${lastSig.text}')`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const ok = errors.length === 0;

  let summary: string;
  if (ok) {
    summary = warnings.length > 0
      ? `static check passed (${warnings.length} warning(s))`
      : "static check passed";
  } else {
    summary = `${errors.length} error(s), ${warnings.length} warning(s)`;
  }

  return { ok, issues, summary, stats };
}

/** Convenience: return only the first N issues (for compact embeds). */
export function summarizeIssues(issues: ValidationIssue[], max = 8): string {
  if (issues.length === 0) return "(no issues)";
  const shown = issues.slice(0, max);
  const lines = shown.map((i) =>
    `L${i.line}:${i.column} [${i.severity}] ${i.message}`
  );
  if (issues.length > max) lines.push(`... and ${issues.length - max} more`);
  return lines.join("\n");
}
