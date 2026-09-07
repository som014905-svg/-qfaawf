// Simple LRU cache for deobfuscation results, keyed by input hash.
//
// PERF UPGRADES vs v5.0:
//   - evictIfNeeded() no longer does O(n) linear scan for oldest entry.
//     JS Map maintains insertion order; because we `delete + set` on every
//     access (promoting the key to "most recent"), the Map iterator always
//     yields the LRU entry first — so eviction is O(1) per step.
//   - No change to the public API or cache semantics.

import { createHash } from "node:crypto";

export interface CacheEntry<V> {
  key: string;
  value: V;
  size: number;
  lastAccess: number;
  hits: number;
}

export class DeobfCache<V> {
  private map = new Map<string, CacheEntry<V>>();
  private totalSize = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(maxEntries = 64, maxBytes = 64 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.maxBytes   = maxBytes;
  }

  static key(input: string): string {
    return createHash("sha256").update(input).digest("hex").slice(0, 32);
  }

  get(input: string): V | undefined {
    const key   = DeobfCache.key(input);
    const entry = this.map.get(key);
    if (!entry) return undefined;
    entry.lastAccess = Date.now();
    entry.hits++;
    // Promote to MRU position (delete + re-insert = end of Map iteration order)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(input: string, value: V, size?: number): void {
    const key   = DeobfCache.key(input);
    const bytes = size ?? approxSize(value);
    const existing = this.map.get(key);
    if (existing) {
      this.totalSize -= existing.size;
      this.map.delete(key); // remove so re-insert puts it at end
    }
    const entry: CacheEntry<V> = { key, value, size: bytes, lastAccess: Date.now(), hits: 0 };
    this.map.set(key, entry);
    this.totalSize += bytes;
    this.evictIfNeeded();
  }

  // ── PERF: O(1) per eviction — Map.entries() yields LRU (insertion order) first ──
  private evictIfNeeded(): void {
    while (this.map.size > this.maxEntries || this.totalSize > this.maxBytes) {
      const first = this.map.entries().next().value;
      if (!first) break;
      const [k, ev] = first;
      this.totalSize -= ev.size;
      this.map.delete(k);
    }
  }

  clear(): void {
    this.map.clear();
    this.totalSize = 0;
  }

  stats(): { entries: number; bytes: number; hits: number } {
    let hits = 0;
    for (const e of this.map.values()) hits += e.hits;
    return { entries: this.map.size, bytes: this.totalSize, hits };
  }
}

function approxSize(v: unknown): number {
  if (typeof v === "string") return Buffer.byteLength(v);
  if (v && typeof v === "object") {
    try { return Buffer.byteLength(JSON.stringify(v)); } catch { return 1024; }
  }
  return 64;
}
