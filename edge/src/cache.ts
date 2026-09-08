import { LRUCache } from 'lru-cache';

export interface CacheEntry {
  body: Buffer;
  contentType: string;
  etag: string;
  lastModified: string;
  storedAt: number; // epoch ms
  ttlSeconds: number;
}

/**
 * Edge cache: LRU with a configurable max entry count, simulating a
 * storage-constrained edge node (Section 4.2). TTL expiry is checked
 * separately from LRU eviction — an entry can be evicted early by the LRU
 * policy under memory pressure, or expire on its own via TTL, whichever
 * comes first. Purge messages delete regardless of either.
 */
export class EdgeCache {
  private store: LRUCache<string, CacheEntry>;

  constructor(maxEntries: number) {
    this.store = new LRUCache<string, CacheEntry>({ max: maxEntries });
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    const ageSeconds = (Date.now() - entry.storedAt) / 1000;
    if (ageSeconds > entry.ttlSeconds) {
      // Expired — treat as a miss but leave eviction to LRU/overwrite.
      return undefined;
    }
    return entry;
  }

  /** Peek without applying TTL expiry — used for conditional revalidation. */
  peek(key: string): CacheEntry | undefined {
    return this.store.get(key);
  }

  set(key: string, entry: CacheEntry) {
    this.store.set(key, entry);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }

  get maxSize(): number {
    return this.store.max as number;
  }
}
