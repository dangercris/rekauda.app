export const HIT_TTL_MS = 60_000;
export const MISS_TTL_MS = 15_000;
export const MAX_ENTRIES = 500;
export const MAX_MISSES = 100;

interface Entry<V> {
  value: V | null;
  expiresAt: number;
}

export interface TtlCacheOptions {
  now?: () => number;
  maxEntries?: number;
  maxMisses?: number;
}

/**
 * Per-isolate bounded LRU cache for public tenant data. Hits (up to 500, 60 s) and misses (null, up to 100, 15 s) live
 * in separate maps, so a flood of unknown hostnames can only evict other misses, never real tenants. Reading an entry
 * makes it the most recent but never extends its expiry. Not shared across isolates, so a suspension can take up to the
 * hit TTL to show up on another isolate.
 */
export class TtlCache<V> {
  private readonly hits = new Map<string, Entry<V>>();
  private readonly misses = new Map<string, Entry<V>>();
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly maxMisses: number;

  constructor(options: TtlCacheOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? MAX_ENTRIES;
    this.maxMisses = options.maxMisses ?? MAX_MISSES;
  }

  get size(): number {
    return this.hits.size + this.misses.size;
  }

  /** `undefined` means not cached; `{ value: null }` is a cached miss. */
  get(key: string): { value: V | null } | undefined {
    for (const map of [this.hits, this.misses]) {
      const entry = map.get(key);
      if (!entry) continue;
      map.delete(key);
      if (entry.expiresAt <= this.now()) return undefined;
      map.set(key, entry);
      return { value: entry.value };
    }
    return undefined;
  }

  set(key: string, value: V | null): void {
    this.hits.delete(key);
    this.misses.delete(key);
    const isMiss = value === null;
    const map = isMiss ? this.misses : this.hits;
    map.set(key, { value, expiresAt: this.now() + (isMiss ? MISS_TTL_MS : HIT_TTL_MS) });
    const max = isMiss ? this.maxMisses : this.maxEntries;
    while (map.size > max) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
  }
}
