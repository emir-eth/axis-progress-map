/**
 * Server-side cache abstraction.
 * In-memory now; swap the store implementation for Redis/KV later.
 */

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

interface MemoryEntry {
  value: unknown;
  expiresAt: number | null;
}

export class MemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, MemoryEntry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt != null && Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.map.set(key, {
      value,
      expiresAt: ttlMs != null ? Date.now() + ttlMs : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

declare global {
  var __axisCacheStore: CacheStore | undefined;
}

/** Process-wide cache store (replaceable for Redis/KV). */
export function getCacheStore(): CacheStore {
  if (!globalThis.__axisCacheStore) {
    globalThis.__axisCacheStore = new MemoryCacheStore();
  }
  return globalThis.__axisCacheStore;
}

/** Test/ops helper — clears the in-memory store if that backend is active. */
export async function clearCacheStore(): Promise<void> {
  const store = getCacheStore();
  if (store instanceof MemoryCacheStore) {
    globalThis.__axisCacheStore = new MemoryCacheStore();
  }
}
