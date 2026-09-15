/**
 * EXPERIMENTAL global Axis SQLite index helpers.
 * Kept for later production ingestion work; not imported by the profile API path.
 */
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbiItem,
  type Address,
  type Log,
} from "viem";
import { base } from "viem/chains";
import { getAxisStartBlock } from "@/lib/base";
import {
  countAxisRecords,
  getCachedBlockTimestamps,
  getIndexState,
  markInitialIndexComplete,
  openDatabase,
  setLastIndexedBlock,
  setLastSyncAt,
  upsertAxisRecords,
  upsertBlockTimestamps,
  type IndexedRecord,
} from "@/lib/db";

const AXIS_CONTRIBUTION_CONTRACT =
  "0xF91A90baA9E044Da084df369445A59D859d640dB" as const;

const RECORD_SUBMITTED_EVENT = parseAbiItem(
  "event RecordSubmitted(uint256 indexed dataId, uint256 indexed taskId, address indexed user, uint256 score, uint256 simulationTime)",
);

const DEFAULT_RPC = "https://mainnet.base.org";
const DEFAULT_LOG_CHUNK = 2_000;
const DEFAULT_LOG_CONCURRENCY = 2;
const DEFAULT_BLOCK_BATCH = 10;
const DEFAULT_BLOCK_CONCURRENCY = 1;
const MAX_RETRIES = 10;
const RETRY_BASE_MS = 900;
const REQUEST_GAP_MS = 150;
/** Leave a small confirmation buffer behind chain head. */
const SAFE_HEAD_LAG = 2;

export const DEFAULT_AXIS_INDEX_MAX_AGE_MS = 600_000;

export class RpcUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcUnavailableError";
  }
}

export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitedError";
  }
}

export interface IndexerStats {
  fromBlock: number;
  toBlock: number;
  newEvents: number;
  durationMs: number;
  rpcCalls: number;
  retries: number;
  ethGetLogs: number;
  ethGetBlockBatches: number;
  ethGetBlockByNumber: number;
}

export interface SyncResult extends IndexerStats {
  skipped: boolean;
  reason?: string;
}

declare global {
  var __axisIndexSyncInflight: Promise<SyncResult> | undefined;
  var __axisProviderMaxLogRange: number | null | undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getAxisIndexMaxAgeMs(): number {
  return parsePositiveInt(
    process.env.AXIS_INDEX_MAX_AGE_MS,
    DEFAULT_AXIS_INDEX_MAX_AGE_MS,
  );
}

function getRpcUrl(): string {
  return process.env.BASE_RPC_URL?.trim() || DEFAULT_RPC;
}

function getLogChunkFallback(): number {
  return parsePositiveInt(process.env.BASE_LOG_CHUNK_SIZE, DEFAULT_LOG_CHUNK);
}

function getLogConcurrency(): number {
  return parsePositiveInt(process.env.BASE_LOG_CONCURRENCY, DEFAULT_LOG_CONCURRENCY);
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

function createClient() {
  return createPublicClient({
    chain: base,
    transport: http(getRpcUrl(), { timeout: 60_000, retryCount: 0 }),
  });
}

type BaseClient = ReturnType<typeof createClient>;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isRateLimit(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("too many")
  );
}

function isTransient(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    isRateLimit(message) ||
    lower.includes("no backend") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("503") ||
    lower.includes("502") ||
    lower.includes("500") ||
    lower.includes("econnreset") ||
    lower.includes("fetch failed") ||
    lower.includes("socket hang up")
  );
}

function isRangeTooLarge(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("block range") ||
    lower.includes("limited to a") ||
    lower.includes("limited to") ||
    lower.includes("ranges over") ||
    lower.includes("query returned more than") ||
    lower.includes("response size") ||
    lower.includes("exceeds the max") ||
    lower.includes("log response size")
  );
}

function parseMaxRangeFromError(message: string): number | null {
  const patterns = [
    /limited to (?:a )?([\d,_]+)\s*(?:blocks?)?\s*range/i,
    /limited to 0\s*-\s*([\d,_]+)\s*blocks?/i,
    /ranges over ([\d,_]+) blocks/i,
    /max(?:imum)?(?: block)? range(?: is| of|:)?\s*([\d,_]+)/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m?.[1]) {
      const n = Number.parseInt(m[1].replace(/,/g, ""), 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  stats: { rpcCalls: number; retries: number },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      stats.rpcCalls += 1;
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (isRangeTooLarge(message)) throw error;
      if (isTransient(message)) {
        stats.retries += 1;
        if (attempt === MAX_RETRIES - 1) {
          if (isRateLimit(message)) {
            throw new RateLimitedError(`Base RPC rate limited during ${label}`);
          }
          break;
        }
        await sleep(RETRY_BASE_MS * 2 ** attempt + 200);
        continue;
      }
      if (attempt === MAX_RETRIES - 1) break;
      stats.retries += 1;
      await sleep(RETRY_BASE_MS * 2 ** attempt);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new RpcUnavailableError(`Base RPC unavailable during ${label}: ${message}`);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
  return results;
}

function getDiscoveredMaxRange(): number | null {
  return globalThis.__axisProviderMaxLogRange ?? null;
}

function setDiscoveredMaxRange(n: number) {
  const prev = getDiscoveredMaxRange();
  if (prev == null || n < prev) {
    globalThis.__axisProviderMaxLogRange = n;
  }
}

function decodeLog(log: Log): IndexedRecord | null {
  try {
    const decoded = decodeEventLog({
      abi: [RECORD_SUBMITTED_EVENT],
      data: log.data,
      topics: log.topics,
    });
    if (decoded.eventName !== "RecordSubmitted") return null;
    const args = decoded.args as {
      dataId: bigint;
      taskId: bigint;
      user: Address;
      score: bigint;
      simulationTime: bigint;
    };
    return {
      dataId: args.dataId.toString(),
      taskId: args.taskId.toString(),
      userAddress: getAddress(args.user).toLowerCase(),
      score: Number(args.score),
      simulationTime: Number(args.simulationTime),
      blockNumber: Number(log.blockNumber ?? 0),
      transactionHash: log.transactionHash as string,
      logIndex: Number(log.logIndex ?? 0),
      timestamp: null,
    };
  } catch {
    return null;
  }
}

async function getLogsOnce(
  client: BaseClient,
  fromBlock: bigint,
  toBlock: bigint,
  stats: IndexerStats,
): Promise<Log[]> {
  if (REQUEST_GAP_MS > 0) await sleep(REQUEST_GAP_MS);
  stats.ethGetLogs += 1;
  return withRetry(
    () =>
      client.getLogs({
        address: AXIS_CONTRIBUTION_CONTRACT,
        event: RECORD_SUBMITTED_EVENT,
        fromBlock,
        toBlock,
      }),
    `getLogs ${fromBlock}-${toBlock}`,
    stats,
  );
}

function buildChunkRanges(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
): Array<{ from: bigint; to: bigint }> {
  const ranges: Array<{ from: bigint; to: bigint }> = [];
  for (let cursor = fromBlock; cursor <= toBlock; cursor += chunkSize) {
    const end =
      cursor + chunkSize - 1n > toBlock ? toBlock : cursor + chunkSize - 1n;
    ranges.push({ from: cursor, to: end });
  }
  return ranges;
}

async function collectLogsAdaptive(
  client: BaseClient,
  fromBlock: bigint,
  toBlock: bigint,
  stats: IndexerStats,
  onChunk?: (info: {
    from: number;
    to: number;
    logs: number;
  }) => void,
): Promise<Log[]> {
  if (fromBlock > toBlock) return [];

  const concurrency = getLogConcurrency();
  const fallbackChunk = BigInt(getLogChunkFallback());
  const queue: Array<{ from: bigint; to: bigint }> = [
    { from: fromBlock, to: toBlock },
  ];
  const results: Log[] = [];

  async function processRange(range: {
    from: bigint;
    to: bigint;
  }): Promise<Array<{ from: bigint; to: bigint }>> {
    const span = range.to - range.from + 1n;
    const known = getDiscoveredMaxRange();
    if (known != null && span > BigInt(known)) {
      return buildChunkRanges(range.from, range.to, BigInt(known));
    }

    try {
      const logs = await getLogsOnce(client, range.from, range.to, stats);
      results.push(...logs);
      onChunk?.({
        from: Number(range.from),
        to: Number(range.to),
        logs: logs.length,
      });
      return [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rangeProblem =
        isRangeTooLarge(message) ||
        message.toLowerCase().includes("timeout") ||
        message.toLowerCase().includes("timed out");
      if (!rangeProblem || range.to <= range.from) throw error;

      const parsed = parseMaxRangeFromError(message);
      if (parsed) {
        setDiscoveredMaxRange(parsed);
      } else {
        // Response-size / timeout without advertised limit: remember a safer window
        // so later segments do not keep retrying the same oversized range.
        const safer = Number(span / 2n);
        if (safer >= 1) setDiscoveredMaxRange(Math.max(100, safer));
      }

      const limit = BigInt(getDiscoveredMaxRange() ?? Number(fallbackChunk));
      if (span > limit) {
        return buildChunkRanges(range.from, range.to, limit);
      }
      const mid = range.from + (range.to - range.from) / 2n;
      return [
        { from: range.from, to: mid },
        { from: mid + 1n, to: range.to },
      ];
    }
  }

  while (queue.length > 0) {
    const batch = queue.splice(0, Math.max(concurrency, 1));
    const nested = await mapPool(batch, concurrency, processRange);
    for (const more of nested) queue.push(...more);
  }

  return results;
}

interface JsonRpcResponse {
  id: number;
  result?: { timestamp?: string } | null;
  error?: { message?: string };
}

async function fetchBlockTimestampBatch(
  blockNumbers: number[],
  stats: IndexerStats,
): Promise<Map<number, number>> {
  const rpcUrl = getRpcUrl();
  const body = blockNumbers.map((bn, idx) => ({
    jsonrpc: "2.0",
    id: idx + 1,
    method: "eth_getBlockByNumber",
    params: [`0x${bn.toString(16)}`, false],
  }));

  const json = await withRetry(async () => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = (await response.json()) as JsonRpcResponse | JsonRpcResponse[];
    if (!Array.isArray(parsed)) {
      const err = (parsed as JsonRpcResponse).error?.message;
      throw new Error(err || "RPC batch response was not an array");
    }
    return parsed;
  }, `batch eth_getBlockByNumber x${blockNumbers.length}`, stats);

  stats.ethGetBlockBatches += 1;
  const out = new Map<number, number>();
  for (const item of json) {
    if (item.error) throw new Error(item.error.message || "batch item error");
    const bn = blockNumbers[item.id - 1];
    const tsHex = item.result?.timestamp;
    if (bn == null || !tsHex) throw new Error("missing batch block timestamp");
    out.set(bn, Number.parseInt(tsHex, 16));
  }
  return out;
}

async function resolveTimestamps(
  client: BaseClient,
  records: IndexedRecord[],
  stats: IndexerStats,
): Promise<IndexedRecord[]> {
  const uniqueBlocks = [...new Set(records.map((r) => r.blockNumber))];
  const cached = await getCachedBlockTimestamps(uniqueBlocks);
  const missing = uniqueBlocks.filter((bn) => !cached.has(bn));
  const timestamps = new Map(cached);

  if (missing.length > 0) {
    const batchSize = getBlockBatchSize();
    const concurrency = getBlockBatchConcurrency();
    const batches: number[][] = [];
    for (let i = 0; i < missing.length; i += batchSize) {
      batches.push(missing.slice(i, i + batchSize));
    }

    const fresh: Array<{ blockNumber: number; timestamp: number }> = [];

    await mapPool(batches, concurrency, async (batch) => {
      try {
        const result = await fetchBlockTimestampBatch(batch, stats);
        for (const [bn, ts] of result) {
          timestamps.set(bn, ts);
          fresh.push({ blockNumber: bn, timestamp: ts });
        }
      } catch {
        for (const blockNumber of batch) {
          stats.ethGetBlockByNumber += 1;
          const block = await withRetry(
            () => client.getBlock({ blockNumber: BigInt(blockNumber) }),
            `getBlock(${blockNumber})`,
            stats,
          );
          const ts = Number(block.timestamp);
          timestamps.set(blockNumber, ts);
          fresh.push({ blockNumber, timestamp: ts });
        }
      }
      return null;
    });

    await upsertBlockTimestamps(fresh);
  }

  return records.map((r) => ({
    ...r,
    timestamp: timestamps.get(r.blockNumber) ?? r.timestamp,
  }));
}

export async function ensureRecordTimestamps(
  records: IndexedRecord[],
): Promise<IndexedRecord[]> {
  const needing = records.filter((r) => r.timestamp == null);
  if (needing.length === 0) return records;

  const client = createClient();
  const stats = emptyStats(0, 0);
  const hydrated = await resolveTimestamps(client, needing, stats);
  await upsertAxisRecords(hydrated);

  const byKey = new Map<string, IndexedRecord>(
    hydrated.map((r) => [`${r.transactionHash}-${r.logIndex}`, r]),
  );
  return records.map((r) => {
    const key = `${r.transactionHash}-${r.logIndex}`;
    return byKey.get(key) ?? r;
  });
}

export async function getSafeChainHead(): Promise<number> {
  const client = createClient();
  const stats = emptyStats(0, 0);
  const latest = await withRetry(
    () => client.getBlockNumber(),
    "getBlockNumber",
    stats,
  );
  return Math.max(0, Number(latest) - SAFE_HEAD_LAG);
}

function emptyStats(from: number, to: number): IndexerStats {
  return {
    fromBlock: from,
    toBlock: to,
    newEvents: 0,
    durationMs: 0,
    rpcCalls: 0,
    retries: 0,
    ethGetLogs: 0,
    ethGetBlockBatches: 0,
    ethGetBlockByNumber: 0,
  };
}

/**
 * Index a contiguous block range of ALL RecordSubmitted events.
 * Advances last_indexed_block only after each successful chunk is persisted.
 */
export async function indexBlockRange(
  fromBlock: number,
  toBlock: number,
  options?: {
    onProgress?: (p: {
      currentBlock: number;
      endBlock: number;
      eventsStored: number;
      pct: number;
      rpcCalls: number;
      retries: number;
    }) => void;
    markComplete?: boolean;
  },
): Promise<IndexerStats> {
  await openDatabase();
  const started = Date.now();
  const stats = emptyStats(fromBlock, toBlock);
  if (fromBlock > toBlock) {
    stats.durationMs = Date.now() - started;
    return stats;
  }

  const client = createClient();

  // Advance contiguously; chunk size adapts to provider limits and event density.
  let cursor = fromBlock;
  let eventsStored = await countAxisRecords();
  let densityChunk = getDiscoveredMaxRange() ?? getLogChunkFallback();

  while (cursor <= toBlock) {
    const providerCap = getDiscoveredMaxRange() ?? 10_000;
    const step = Math.min(densityChunk, providerCap);
    const end = Math.min(cursor + step - 1, toBlock);

    const logs = await collectLogsAdaptive(
      client,
      BigInt(cursor),
      BigInt(end),
      stats,
    );
    const decoded = logs
      .map(decodeLog)
      .filter((r): r is IndexedRecord => r !== null);

    await upsertAxisRecords(decoded);

    // Best-effort timestamps — never block contiguous log progress on public RPC.
    if (decoded.length > 0 && decoded.length <= 200) {
      try {
        const withTs = await resolveTimestamps(client, decoded, stats);
        await upsertAxisRecords(withTs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `\n[warn] timestamp hydration skipped @${cursor}-${end}: ${message.slice(0, 120)}`,
        );
      }
    }

    await setLastIndexedBlock(end);
    eventsStored += decoded.length;
    stats.newEvents += decoded.length;

    // Grow through empty history; shrink when dense.
    if (decoded.length === 0) {
      densityChunk = Math.min(providerCap, Math.max(step * 2, step + 1));
    } else if (decoded.length > 400) {
      densityChunk = Math.max(200, Math.floor(step / 2));
    } else {
      densityChunk = step;
    }

    const pct = ((end - fromBlock + 1) / (toBlock - fromBlock + 1)) * 100;
    options?.onProgress?.({
      currentBlock: end,
      endBlock: toBlock,
      eventsStored,
      pct,
      rpcCalls: stats.rpcCalls,
      retries: stats.retries,
    });

    cursor = end + 1;
  }

  await setLastIndexedBlock(toBlock);

  if (options?.markComplete) {
    await markInitialIndexComplete(Date.now());
  } else {
    await setLastSyncAt(Date.now());
  }

  stats.durationMs = Date.now() - started;
  return stats;
}

/**
 * Incremental sync: last_indexed_block+1 → safe head.
 * Single-flight per process.
 */
export async function syncAxisIndex(options?: {
  force?: boolean;
}): Promise<SyncResult> {
  if (globalThis.__axisIndexSyncInflight) {
    return globalThis.__axisIndexSyncInflight;
  }

  const promise = (async (): Promise<SyncResult> => {
    await openDatabase();
    const state = await getIndexState();
    if (!state.initialIndexComplete && !options?.force) {
      return {
        ...emptyStats(0, 0),
        skipped: true,
        reason: "initial_index_incomplete",
      };
    }

    const safeHead = await getSafeChainHead();
    const from = state.lastIndexedBlock + 1;
    if (from > safeHead) {
      await setLastSyncAt(Date.now());
      return {
        ...emptyStats(from, safeHead),
        skipped: true,
        reason: "already_up_to_date",
        durationMs: 0,
      };
    }

    const stats = await indexBlockRange(from, safeHead, { markComplete: false });
    await setLastSyncAt(Date.now());
    return { ...stats, skipped: false };
  })().finally(() => {
    globalThis.__axisIndexSyncInflight = undefined;
  });

  globalThis.__axisIndexSyncInflight = promise;
  return promise;
}

export async function runFullIndex(options?: {
  onProgress?: Parameters<typeof indexBlockRange>[2] extends infer O
    ? O extends { onProgress?: infer P }
      ? P
      : never
    : never;
}): Promise<IndexerStats> {
  await openDatabase();
  const state = await getIndexState();
  const start = getAxisStartBlock();
  const safeHead = await getSafeChainHead();

  // Resume: if we have progress but incomplete, continue from last_indexed+1
  // unless last_indexed is 0 (never started) — then start from deployment.
  let from = start;
  if (state.lastIndexedBlock >= start) {
    from = state.lastIndexedBlock + 1;
  } else if (state.lastIndexedBlock > 0 && state.lastIndexedBlock < start) {
    from = start;
  }

  if (from > safeHead) {
    await markInitialIndexComplete(Date.now());
    const stats = emptyStats(from, safeHead);
    stats.durationMs = 0;
    return stats;
  }

  // Seed last_indexed to start-1 before first write so resume semantics are clear
  if (state.lastIndexedBlock < start - 1) {
    await setLastIndexedBlock(start - 1);
  }

  return indexBlockRange(from, safeHead, {
    onProgress: options?.onProgress,
    markComplete: true,
  });
}
