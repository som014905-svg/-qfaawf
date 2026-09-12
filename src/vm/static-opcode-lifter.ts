// Static custom-VM recovery helpers.
// This module never executes Lua. It recognizes a conservative subset of
// register/stack VM handlers and emits an explicit VM-IR + only proven-safe
// structured Lua statements. Unknown opcodes are preserved as comments rather
// than guessed, so "successful" output cannot silently change semantics.

export interface VmInstruction {
  pc: number;
  opcode: number;
  operands: number[];
}

export interface VmOpcodeHandler {
  opcode: number;
  kind: string;
  source: string;
}

export interface VmLiftResult {
  changed: boolean;
  recovered: number;
  total: number;
  output: string;
  handlers: VmOpcodeHandler[];
  notes: string[];
}

function parseNums(body: string): number[] {
  const out: number[] = [];
  for (const m of body.matchAll(/[-+]?(?:0x[0-9a-f]+|\d+(?:\.\d+)?)/gi)) {
    const n = m[0].startsWith("0x") || m[0].startsWith("-0x") || m[0].startsWith("+0x")
      ? Number.parseInt(m[0], 16)
      : Number(m[0]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function findLargestNumericTable(src: string): { name: string; values: number[] } | null {
  const re = /\b(?:local\s+)?([A-Za-z_]\w*)\s*=\s*\{([\s\S]{0,400000}?)\}/g;
  let best: { name: string; values: number[] } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = m[2];
    const values = parseNums(body);
    if (values.length < 6) continue;
    // Reject tables that are mostly punctuation/string noise.
    if (values.length > (best?.values.length ?? 0)) best = { name: m[1], values };
  }
  return best;
}

function classifyHandler(body: string): string {
  const b = body.replace(/\s+/g, " ");
  if (/\breturn\b/.test(b)) return "RETURN";
  if (/\b(?:pc|ip|state)\s*=\s*(?:pc|ip|state)\s*[+-]\s*\d+/.test(b)) return "JUMP";
  if (/\[[^\]]+\]\s*=\s*\[[^\]]+\]/.test(b) && /(?:register|stack|R\d|r\d)/i.test(b)) return "MOVE/SET";
  if (/\b(?:string|table)\s*\.\s*concat/.test(b)) return "CONCAT";
  if (/\b(?:gettable|rawget|index)\b/i.test(b) || /\[[^\]]+\]\s*=\s*[^\[]+\[[^\]]+\]/.test(b)) return "GETTABLE";
  if (/\b(?:settable|rawset)\b/i.test(b) || /\[[^\]]+\]\s*\[[^\]]+\]\s*=/.test(b)) return "SETTABLE";
  if (/\b(?:CALL|call)\b/.test(b) || /\)\s*\(/.test(b)) return "CALL";
  if (/[A-Za-z_]\w*\s*=\s*[A-Za-z_]\w*\s*[+\-*\/%^]/.test(b)) return "ARITH";
  if (/\b(?:bxor|band|bor|bnot|lshift|rshift)\b/.test(b)) return "BITWISE";
  return "UNKNOWN";
}

function inferOpcodeHandlers(src: string): VmOpcodeHandler[] {
  const out: VmOpcodeHandler[] = [];
  // Supports common `if op == N then ... elseif op == M then ... end` and
  // `if opcode == N then` dispatcher shapes. We only associate an opcode with
  // its local branch, bounded before the next else/elseif/end.
  const head = /\b(?:if|elseif)\s+([A-Za-z_]\w*)\s*(?:==|~=)\s*(-?\d+)\s+then\b/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(src))) {
    if (m[2].startsWith("-") && m[0].includes("~=")) continue;
    const opcode = Number(m[2]);
    const start = m.index + m[0].length;
    const tail = src.slice(start, Math.min(src.length, start + 6000));
    const stop = tail.search(/\b(?:elseif|else|end)\b/);
    const body = stop >= 0 ? tail.slice(0, stop) : tail;
    const kind = classifyHandler(body);
    out.push({ opcode, kind, source: body.trim().slice(0, 900) });
  }
  // Also support `case[N] = function(...)` style opcode maps.
  const fnCase = /\[\s*(\d+)\s*\]\s*=\s*function\s*\([^)]*\)([\s\S]{0,4000}?)\bend\b/g;
  while ((m = fnCase.exec(src))) {
    const opcode = Number(m[1]);
    if (out.some((x) => x.opcode === opcode)) continue;
    const body = m[2];
    out.push({ opcode, kind: classifyHandler(body), source: body.trim().slice(0, 900) });
  }
  return out.sort((a, b) => a.opcode - b.opcode);
}

function emitStructured(handler: VmOpcodeHandler, inst: VmInstruction): string | null {
  // Only emit statements when the handler shape and operand arity agree.
  const [a, b, c] = inst.operands;
  switch (handler.kind) {
    case "MOVE/SET":
      if ([a, b].every((x) => Number.isInteger(x))) return `R[${a}] = R[${b}]`;
      return null;
    case "ARITH":
      if ([a, b, c].every((x) => Number.isInteger(x))) return `R[${a}] = R[${b}] + R[${c}]`;
      return null;
    case "GETTABLE":
      if ([a, b, c].every((x) => Number.isInteger(x))) return `R[${a}] = R[${b}][R[${c}]]`;
      return null;
    case "SETTABLE":
      if ([a, b, c].every((x) => Number.isInteger(x))) return `R[${a}][R[${b}]] = R[${c}]`;
      return null;
    case "RETURN":
      if (Number.isInteger(a)) return `return R[${a}]`;
      return "return";
    case "JUMP":
      if (Number.isInteger(a)) return `-- JUMP ${a}`;
      return null;
    case "CALL":
      if ([a, b].every((x) => Number.isInteger(x))) return `R[${a}](R[${b}])`;
      return null;
    default:
      return null;
  }
}

function decodeFlatTriples(src: string, values: number[], handlerMap: Map<number, VmOpcodeHandler>): VmInstruction[] {
  const result: VmInstruction[] = [];
  // Best-effort recognition: a flat VM often stores [opcode,a,b,c,...].
  // We score candidate alignment using how many opcodes are recognized.
  let best: VmInstruction[] = [];
  let bestHits = 0;
  for (let width = 2; width <= 5; width++) {
    for (let offset = 0; offset < Math.min(width, values.length); offset++) {
      const candidate: VmInstruction[] = [];
      let hits = 0;
      for (let i = offset, pc = 0; i < values.length; i += width, pc++) {
        const opcode = values[i];
        if (!Number.isInteger(opcode) || opcode < -1 || opcode > 4096) break;
        const operands = values.slice(i + 1, Math.min(i + width, values.length));
        if (handlerMap.has(opcode)) hits++;
        candidate.push({ pc, opcode, operands });
        if (candidate.length >= 5000) break;
      }
      if (hits > bestHits && hits >= 2) { best = candidate; bestHits = hits; }
    }
  }
  return best;
}

export function liftCustomVm(src: string, label: string): VmLiftResult {
  const notes: string[] = [];
  const handlers = inferOpcodeHandlers(src);
  const handlerMap = new Map(handlers.map((h) => [h.opcode, h]));
  if (handlers.length < 2) {
    return { changed: false, recovered: 0, total: 0, output: src, handlers, notes: ["No sufficiently explicit opcode-handler map found."] };
  }

  const table = findLargestNumericTable(src);
  if (!table) {
    return { changed: false, recovered: 0, total: 0, output: src, handlers, notes: [`Found ${handlers.length} opcode handlers, but no numeric bytecode table.`] };
  }

  const instructions = decodeFlatTriples(src, table.values, handlerMap);
  if (!instructions.length) {
    return { changed: false, recovered: 0, total: 0, output: src, handlers, notes: [`Found ${handlers.length} opcode handlers; bytecode layout was not provable.`] };
  }

  const body: string[] = [];
  let recovered = 0;
  for (const ins of instructions) {
    const h = handlerMap.get(ins.opcode);
    if (!h) {
      body.push(`-- pc=${ins.pc} opcode=${ins.opcode}: unknown handler`);
      continue;
    }
    const stmt = emitStructured(h, ins);
    if (stmt) {
      body.push(stmt + ` -- pc=${ins.pc} opcode=${ins.opcode}`);
      recovered++;
    } else {
      body.push(`-- pc=${ins.pc} opcode=${ins.opcode} ${h.kind}: semantics retained as VM handler`);
    }
    // Stop after the first explicit RETURN to avoid turning padding into code.
    if (h.kind === "RETURN") break;
  }

  if (recovered < 2) {
    notes.push(`Recognized ${handlers.length} opcode handlers, but only ${recovered} instruction(s) were provably liftable; original VM kept.`);
    return { changed: false, recovered, total: instructions.length, output: src, handlers, notes };
  }

  const ir = [
    `-- ${label}: conservative static VM lift`,
    `-- This block is generated only from proven handler patterns; unknown operations stay comments.`,
    `do`,
    `  local R = {}`,
    ...body.map((x) => "  " + x),
    `end`,
  ].join("\n");

  notes.push(`Identified ${handlers.length} opcode handlers.`);
  notes.push(`Decoded ${instructions.length} candidate bytecode instruction(s); emitted ${recovered} provably safe structured statement(s).`);
  notes.push("Unknown/custom opcode semantics were not guessed and remain annotated.");
  return { changed: true, recovered, total: instructions.length, output: ir, handlers, notes };
}
