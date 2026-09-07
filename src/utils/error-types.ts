// Error classification for engine failures (v4).
//
// The orchestrator needs to distinguish *why* an engine failed so it can
// log precisely, avoid retrying hopeless paths, and report honestly.

export type EngineErrorKind =
  | "timeout"
  | "parse"          // tokenizer/parser failed on the input
  | "unsupported"    // engine does not handle this obfuscator/layout
  | "malformed"      // input looks corrupted / truncated
  | "runtime"        // unexpected internal error (bug)
  | "resource";      // memory/size limits hit

export class EngineError extends Error {
  readonly kind: EngineErrorKind;
  constructor(kind: EngineErrorKind, message: string) {
    super(message);
    this.name = "EngineError";
    this.kind = kind;
  }
}

/** Classify an unknown error by message heuristics. */
export function classifyEngineError(e: unknown): { kind: EngineErrorKind; message: string } {
  if (e instanceof EngineError) return { kind: e.kind, message: e.message };
  const message = e instanceof Error ? e.message : String(e);
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) return { kind: "timeout", message };
  if (lower.includes("out of memory") || lower.includes("invalid string length") || lower.includes("too large"))
    return { kind: "resource", message };
  if (lower.includes("lexer") || lower.includes("unexpected eof") || lower.includes("tokenize"))
    return { kind: "parse", message };
  if (lower.includes("truncated")) return { kind: "malformed", message };
  return { kind: "runtime", message };
}
