// Shared types for the deobfuscation bot

export interface DeobfuscateResult {
  /** Whether this deobfuscator considers the run successful */
  success: boolean;
  /** Human-readable name of the deobfuscator that produced this result */
  deobfuscator: string;
  /** The deobfuscated / recovered source code */
  output: string;
  /** Optional notes shown to the user (what was recovered, caveats, etc.) */
  notes?: string[];
  /** Confidence score 0..1 — used to pick the best result across deobfuscators */
  confidence: number;
  /** List of embedded source strings / artifacts recovered (if any) */
  artifacts?: string[];
  /** Original obfuscator detected for this input */
  obfuscator: string;
}

export interface DeobfuscateContext {
  /** The raw input source as fetched from URL or file */
  input: string;
  /** Original filename (without extension) for naming outputs */
  baseName: string;
  /** Where the input came from */
  source: "url" | "attachment" | "text";
  /** Original URL if source === "url" */
  url?: string;
  /** Optional per-run logger */
  log: (msg: string) => void;
}

export type DetectionMatch = {
  obfuscator: ObfuscatorId;
  confidence: number; // 0..1
  evidence: string;
};

export type ObfuscatorId =
  | "luraph"
  | "moonsec"
  | "ironbrew"
  | "wearedevs"
  | "prometheus"
  | "moonveil"
  | "luauvmp"
  | "qmarker_vm"
  | "prometheusv2"
  | "astrotect"
  | "luaxor"
  | "baconguard"
  | "mcr4"
  | "tagtable_vm"
  | "heavyweightfishing"
  | "modern_vm"
  | "hercules"
  | "generic";

export interface Deobfuscator {
  /** Unique id, must match an ObfuscatorId */
  id: ObfuscatorId;
  /** Display name shown in Discord embeds */
  name: string;
  /** Short description of what this deobfuscator targets */
  description: string;
  /**
   * Quick check whether this deobfuscator can handle the given input.
   * Return a confidence in 0..1. The orchestrator runs the deobfuscator with
   * the highest confidence first, falling back to the next on failure.
   */
  detect(input: string): DetectionMatch | null;
  /** Run the deobfuscation pipeline. Never throws — return success:false on error. */
  deobfuscate(ctx: DeobfuscateContext): Promise<DeobfuscateResult>;
}

export interface BotConfig {
  token: string;
  prefix: string;
  maxFileSizeKB: number;
  deobfTimeoutMs: number;
  /** Optional external luauvmp binary path/name. */
  luauvmpBin?: string;
  maxPasses: number;
  minPassImprovement: number;
  /** Per-user cooldown in ms. */
  cooldownMs: number;
  /** Burst count inside the cooldown window. */
  burst: number;
  /** Hard cap on output bytes sent as a Discord attachment (8 MB default). */
  maxOutputBytes: number;
  /** Run deobfuscators in parallel. */
  parallel: boolean;
}
