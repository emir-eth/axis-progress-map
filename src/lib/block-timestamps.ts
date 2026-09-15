/**
 * Batched Base block-timestamp resolution for wallet events.
 * Uses eth_getBlockByNumber(..., false) + optional SQLite block_timestamps cache.
 * Failures are non-fatal for callers that catch/ignore.
 */
import {
  getCachedBlockTimestamps,
  upsertBlockTimestamps,
} from "@/lib/db";
import type { IndexedRecord } from "@/lib/db";

const DEFAULT_RPC = "https://mainnet.base.org";
const DEFAULT_BLOCK_BATCH = 10;
const DEFAULT_BLOCK_CONCURRENCY = 2;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 400;

export interface BlockTimestampStats {
  uniqueBlocks: number;
  cacheHits: number;
  blocksFetched: number;
  ethGetBlockBatches: number;
  ethGetBlockByNumber: number;
  failures: number;
}

export type FetchBlockTimestampBatchFn = (
  blockNumbers: number[],
) => Promise<Map<number, number>>;

function getRpcUrl(): string {
  return process.env.BASE_RPC_URL?.trim() || DEFAULT_RPC;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getBlockBatchSize(): number {
  return parsePositiveInt(process.env.BASE_BLOCK_BATCH_SIZE, DEFAULT_BLOCK_BATCH);
}

function getBlockBatchConcurrency(): number {
  return parsePositiveInt(
    process.env.BASE_BLOCK_BATCH_CONCURRENCY,
    DEFAULT_BLOCK_CONCURRENCY,
  );
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt === MAX_RETRIES) break;
      await sleep(RETRY_BASE_MS * 2 ** attempt);
    }
  }
  throw last instanceof Error
    ? last
    : new Error(`${label} failed: ${String(last)}`);
}

interface JsonRpcResponse {
  id: number;
  result?: { timestamp?: string } | null;
  error?: { message?: string };
}

export async function fetchBlockTimestampBatch(
  blockNumbers: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, number>> {
  if (blockNumbers.length === 0) return new Map();

  const rpcUrl = getRpcUrl();
  const body = blockNumbers.map((bn, idx) => ({
    jsonrpc: "2.0",
    id: idx + 1,
    method: "eth_getBlockByNumber",
    params: [`0x${bn.toString(16)}`, false],
  }));

  const parsed = await withRetry(async () => {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = (await response.json()) as JsonRpcResponse | JsonRpcResponse[];
    if (!Array.isArray(json)) {
      const err = (json as JsonRpcResponse).error?.message;
      throw new Error(err || "RPC batch response was not an array");
    }
    return json;
  }, `batch eth_getBlockByNumber x${blockNumbers.length}`);

  const out = new Map<number, number>();
  for (const item of parsed) {
    if (item.error) throw new Error(item.error.message || "batch item error");
    const bn = blockNumbers[item.id - 1];
    const tsHex = item.result?.timestamp;
    if (bn == null || !tsHex) throw new Error("missing batch block timestamp");
    out.set(bn, Number.parseInt(tsHex, 16));
  }
  return out;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      results[idx] = await worker(items[idx]!);
    }
  }
  const n = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

/**
 * Resolve Unix-second timestamps for unique block numbers.
 * Uses SQLite block_timestamps cache; fetches only misses.
 */
export async function resolveBlockTimestamps(
  blockNumbers: number[],
  options?: {
    fetchBatch?: FetchBlockTimestampBatchFn;
    useCache?: boolean;
    stats?: BlockTimestampStats;
  },
): Promise<Map<number, number>> {
  const unique = [...new Set(blockNumbers.filter((n) => Number.isFinite(n) && n > 0))];
  const stats = options?.stats ?? emptyBlockTimestampStats();
  stats.uniqueBlocks = unique.length;
  if (unique.length === 0) return new Map();

  const useCache = options?.useCache !== false;
  const cached = useCache ? getCachedBlockTimestamps(unique) : new Map();
  stats.cacheHits = cached.size;
  const missing = unique.filter((bn) => !cached.has(bn));
  const out = new Map(cached);

  if (missing.length === 0) return out;

  const fetchBatch = options?.fetchBatch ?? fetchBlockTimestampBatch;
  const batchSize = getBlockBatchSize();
  const concurrency = getBlockBatchConcurrency();
  const batches: number[][] = [];
  for (let i = 0; i < missing.length; i += batchSize) {
    batches.push(missing.slice(i, i + batchSize));
  }

  const fresh: Array<{ blockNumber: number; timestamp: number }> = [];

  await mapPool(batches, concurrency, async (batch) => {
    try {
      const result = await fetchBatch(batch);
      stats.ethGetBlockBatches += 1;
      stats.blocksFetched += result.size;
      for (const [bn, ts] of result) {
        out.set(bn, ts);
        fresh.push({ blockNumber: bn, timestamp: ts });
      }
    } catch {
      stats.failures += 1;
      // Per-block fallback (still non-fatal at caller level if this throws)
      for (const bn of batch) {
        try {
          const single = await fetchBatch([bn]);
          stats.ethGetBlockByNumber += 1;
          const ts = single.get(bn);
          if (ts != null) {
            out.set(bn, ts);
            fresh.push({ blockNumber: bn, timestamp: ts });
            stats.blocksFetched += 1;
          } else {
            stats.failures += 1;
          }
        } catch {
          stats.failures += 1;
        }
      }
    }
    return null;
  });

  if (useCache && fresh.length > 0) {
    upsertBlockTimestamps(fresh);
  }

  return out;
}

export function emptyBlockTimestampStats(): BlockTimestampStats {
  return {
    uniqueBlocks: 0,
    cacheHits: 0,
    blocksFetched: 0,
    ethGetBlockBatches: 0,
    ethGetBlockByNumber: 0,
    failures: 0,
  };
}

/**
 * Attach timestamps to records. Never throws — missing blocks stay null.
 */
export async function attachBlockTimestamps(
  records: IndexedRecord[],
  options?: {
    fetchBatch?: FetchBlockTimestampBatchFn;
    useCache?: boolean;
    stats?: BlockTimestampStats;
  },
): Promise<IndexedRecord[]> {
  if (records.length === 0) return records;
  try {
    const needing = records.filter((r) => r.timestamp == null);
    if (needing.length === 0) return records;
    const map = await resolveBlockTimestamps(
      needing.map((r) => r.blockNumber),
      options,
    );
    return records.map((r) => {
      if (r.timestamp != null) return r;
      const ts = map.get(r.blockNumber);
      return ts != null ? { ...r, timestamp: ts } : r;
    });
  } catch {
    if (options?.stats) options.stats.failures += 1;
    return records;
  }
}
