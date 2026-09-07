// Per-user rate limiter (cooldown) for the deobfuscation command.
//
// Deobfuscation is CPU-heavy (regex scanning, XOR brute-force, tokenising).
// A single abusive user could starve the event loop. This limiter enforces a
// per-user cooldown with a small bursting allowance.
//
// Backed by a Map that auto-prunes expired entries on read.

export interface RateLimitOptions {
  /** Cooldown in milliseconds per user. */
  cooldownMs: number;
  /** Number of requests allowed inside the cooldown window (burst). Default 1. */
  burst: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Retry-after in ms (0 when allowed). */
  retryAfterMs: number;
  /** Remaining tokens in the current window. */
  remaining: number;
}

interface UserState {
  windowStart: number;
  count: number;
}

export class RateLimiter {
  private states = new Map<string, UserState>();
  private readonly opts: RateLimitOptions;

  constructor(opts: Partial<RateLimitOptions> = {}) {
    this.opts = {
      cooldownMs: opts.cooldownMs ?? 15_000,
      burst: opts.burst ?? 1,
    };
  }

  /** Check whether `userId` may proceed. If yes, consume a token. */
  check(userId: string): RateLimitResult {
    this.prune();
    const now = Date.now();
    const state = this.states.get(userId);
    if (!state) {
      this.states.set(userId, { windowStart: now, count: 1 });
      return { allowed: true, retryAfterMs: 0, remaining: this.opts.burst - 1 };
    }
    const elapsed = now - state.windowStart;
    if (elapsed >= this.opts.cooldownMs) {
      // Window expired — start fresh.
      this.states.set(userId, { windowStart: now, count: 1 });
      return { allowed: true, retryAfterMs: 0, remaining: this.opts.burst - 1 };
    }
    if (state.count < this.opts.burst) {
      state.count++;
      return { allowed: true, retryAfterMs: 0, remaining: this.opts.burst - state.count };
    }
    const retryAfter = this.opts.cooldownMs - elapsed;
    return { allowed: false, retryAfterMs: retryAfter, remaining: 0 };
  }

  /** Update cooldown/burst at runtime. */
  configure(opts: Partial<RateLimitOptions>): void {
    if (opts.cooldownMs !== undefined) this.opts.cooldownMs = opts.cooldownMs;
    if (opts.burst !== undefined) this.opts.burst = opts.burst;
  }

  private prune(): void {
    const cutoff = Date.now() - this.opts.cooldownMs * 4;
    for (const [k, v] of this.states) {
      if (v.windowStart < cutoff) this.states.delete(k);
    }
  }

  stats(): { users: number } {
    return { users: this.states.size };
  }
}
