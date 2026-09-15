/**
 * Per-wallet Base RPC scanner for RecordSubmitted logs.
 * Filters by indexed topic3 (user) from the start — never scans all users.
 */
import {
  createPublicClient,
  decodeEventLog,
  encodeEventTopics,
  getAddress,
  http,
  parseAbiItem,
  type Address,
  type Log,
} from "viem";
import { base } from "viem/chains";
import {
  AXIS_CONTRIBUTION_CONTRACT,
  getAxisStartBlock,
  RECORD_SUBMITTED_TOPIC,
} from "@/lib/base";
import type { IndexedRecord } from "@/lib/db";
import { attachBlockTimestamps } from "@/lib/block-timestamps";

const RECORD_SUBMITTED_EVENT = parseAbiItem(
  "event RecordSubmitted(uint256 indexed dataId, uint256 indexed taskId, address indexed user, uint256 score, uint256 simulationTime)",
);

const DEFAULT_RPC = "https://mainnet.base.org";
const DEFAULT_LOG_CHUNK = 2_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 400;
const REQUEST_GAP_MS = 50;
const SAFE_HEAD_LAG = 2;
const RPC_TIMEOUT_MS = 12_000;

/** Hard ceiling for a single profile request scan (first-time or refresh). */
export const DEFAULT_WALLET_SCAN_BUDGET_MS = 25_000;

export class WalletScanTimeoutError extends Error {
  scannedThroughBlock: number;
  constructor(message: string, scannedThroughBlock: number) {
    super(message);
    this.name = "WalletScanTimeoutError";
    this.scannedThroughBlock = scannedThroughBlock;
  }
}

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

export interface WalletScanStats {
  fromBlock: number;
  toBlock: number;
  newEvents: number;
  durationMs: number;
  rpcCalls: number;
  retries: number;
  ethGetLogs: number;
}

export interface WalletScanResult {
  records: IndexedRecord[];
  /** True only if the full [from,to] range was scanned contiguously. */
  completed: boolean;
  /** Highest block fully covered without gaps. */
  scannedThroughBlock: number;
  stats: WalletScanStats;
}

export type GetLogsFn = (args: {
  fromBlock: bigint;
  toBlock: bigint;
  user: Address;
}) => Promise<Log[]>;

export type GetBlockNumberFn = () => Promise<bigint>;

declare global {
  var __axisWalletMaxLogRange: number | null | undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getRpcUrl(): string {
  return process.env.BASE_RPC_URL?.trim() || DEFAULT_RPC;
}

function getLogChunkFallback(): number {
  return parsePositiveInt(process.env.BASE_LOG_CHUNK_SIZE, DEFAULT_LOG_CHUNK);
}

export function getWalletScanBudgetMs(): number {
  return parsePositiveInt(
    process.env.AXIS_WALLET_SCAN_BUDGET_MS,
    DEFAULT_WALLET_SCAN_BUDGET_MS,
  );
}

function createClient() {
  return createPublicClient({
    chain: base,
    transport: http(getRpcUrl(), {
      timeout: RPC_TIMEOUT_MS,
      retryCount: 0,
    }),
  });
}

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
        await sleep(RETRY_BASE_MS * 2 ** attempt + 100);
        continue;
      }
      if (attempt === MAX_RETRIES - 1) break;
      stats.retries += 1;
      await sleep(RETRY_BASE_MS * 2 ** attempt);
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new RpcUnavailableError(
    `Base RPC unavailable during ${label}: ${message}`,
  );
}

function getDiscoveredMaxRange(): number | null {
  return globalThis.__axisWalletMaxLogRange ?? null;
}

function setDiscoveredMaxRange(n: number) {
  const prev = getDiscoveredMaxRange();
  if (prev == null || n < prev) {
    globalThis.__axisWalletMaxLogRange = n;
  }
}

export function decodeRecordSubmittedLog(log: Log): IndexedRecord | null {
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
      transactionHash: (log.transactionHash as string).toLowerCase(),
      logIndex: Number(log.logIndex ?? 0),
      timestamp: null,
    };
  } catch {
    return null;
  }
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

function emptyStats(from: number, to: number): WalletScanStats {
  return {
    fromBlock: from,
    toBlock: to,
    newEvents: 0,
    durationMs: 0,
    rpcCalls: 0,
    retries: 0,
    ethGetLogs: 0,
  };
}

function createDefaultGetLogs(): GetLogsFn {
  const client = createClient();
  return async ({ fromBlock, toBlock, user }) => {
    if (REQUEST_GAP_MS > 0) await sleep(REQUEST_GAP_MS);
    // Filter topic0 + topic3 (indexed user) via eth_getLogs — wallet-specific only.
    const encoded = encodeEventTopics({
      abi: [RECORD_SUBMITTED_EVENT],
      eventName: "RecordSubmitted",
      args: { user },
    });
    const topic0 = (encoded[0] ?? RECORD_SUBMITTED_TOPIC) as `0x${string}`;
    const topic3 = encoded[3] as `0x${string}` | undefined;
    if (!topic3) {
      throw new Error("Failed to encode wallet topic3 for RecordSubmitted");
    }

    const raw = await client.request({
      method: "eth_getLogs",
      params: [
        {
          address: AXIS_CONTRIBUTION_CONTRACT,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
          topics: [topic0, null, null, topic3],
        },
      ],
    });

    return (raw as Log[]).map((log) => ({
      ...log,
      blockNumber:
        typeof log.blockNumber === "string"
          ? BigInt(log.blockNumber)
          : log.blockNumber,
      logIndex:
        typeof log.logIndex === "string"
          ? Number.parseInt(log.logIndex, 16)
          : log.logIndex,
      transactionIndex:
        typeof log.transactionIndex === "string"
          ? Number.parseInt(log.transactionIndex as string, 16)
          : log.transactionIndex,
    })) as Log[];
  };
}

function createDefaultGetBlockNumber(): GetBlockNumberFn {
  const client = createClient();
  return () => client.getBlockNumber();
}

/**
 * Scan RecordSubmitted logs for one wallet over [fromBlock, toBlock].
 * Adaptive range splitting; aborts cleanly when deadline is reached.
 *
 * When `onRangeComplete` is provided, it is invoked after each successful
 * contiguous range is decoded and MUST persist before the scanner advances.
 * If the callback throws, the checkpoint is not advanced past that range.
 */
export async function scanWalletBlockRange(options: {
  user: Address;
  fromBlock: number;
  toBlock: number;
  deadlineMs: number;
  getLogs?: GetLogsFn;
  /** Optional: inject timestamp batch fetch (tests). */
  fetchBlockTimestamps?: (
    blockNumbers: number[],
  ) => Promise<Map<number, number>>;
  /** When false, skip block timestamp hydration (tests). Default true. */
  resolveTimestamps?: boolean;
  onRangeComplete?: (info: {
    fromBlock: number;
    toBlock: number;
    records: IndexedRecord[];
  }) => void | Promise<void>;
}): Promise<WalletScanResult> {
  const { user, fromBlock, toBlock, deadlineMs } = options;
  const getLogs = options.getLogs ?? createDefaultGetLogs();
  const started = Date.now();
  const stats = emptyStats(fromBlock, toBlock);
  const userChecksum = getAddress(user);
  const shouldResolveTimestamps = options.resolveTimestamps !== false;

  if (fromBlock > toBlock) {
    return {
      records: [],
      completed: true,
      scannedThroughBlock: toBlock,
      stats: { ...stats, durationMs: Date.now() - started },
    };
  }

  const fallbackChunk = BigInt(getLogChunkFallback());
  // Process ranges in ascending order so scannedThroughBlock stays contiguous.
  const pending = buildChunkRanges(
    BigInt(fromBlock),
    BigInt(toBlock),
    BigInt(getDiscoveredMaxRange() ?? Number(fallbackChunk)),
  );
  const records: IndexedRecord[] = [];
  let scannedThroughBlock = fromBlock - 1;
  let completed = true;

  async function fetchRange(range: {
    from: bigint;
    to: bigint;
  }): Promise<{ logs: Log[]; splits: Array<{ from: bigint; to: bigint }> }> {
    if (Date.now() >= deadlineMs) {
      throw new WalletScanTimeoutError(
        "Wallet scan budget exhausted",
        scannedThroughBlock,
      );
    }

    const span = range.to - range.from + 1n;
    const known = getDiscoveredMaxRange();
    if (known != null && span > BigInt(known)) {
      return {
        logs: [],
        splits: buildChunkRanges(range.from, range.to, BigInt(known)),
      };
    }

    try {
      stats.ethGetLogs += 1;
      const logs = await withRetry(
        () =>
          getLogs({
            fromBlock: range.from,
            toBlock: range.to,
            user: userChecksum,
          }),
        `wallet getLogs ${range.from}-${range.to}`,
        stats,
      );
      return { logs, splits: [] };
    } catch (error) {
      if (error instanceof WalletScanTimeoutError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const rangeProblem =
        isRangeTooLarge(message) ||
        message.toLowerCase().includes("timeout") ||
        message.toLowerCase().includes("timed out");
      if (!rangeProblem || range.to <= range.from) throw error;

      const parsed = parseMaxRangeFromError(message);
      if (parsed) setDiscoveredMaxRange(parsed);
      else {
        const safer = Number(span / 2n);
        if (safer >= 1) setDiscoveredMaxRange(Math.max(100, safer));
      }

      const limit = BigInt(getDiscoveredMaxRange() ?? Number(fallbackChunk));
      if (span > limit) {
        return {
          logs: [],
          splits: buildChunkRanges(range.from, range.to, limit),
        };
      }
      const mid = range.from + (range.to - range.from) / 2n;
      return {
        logs: [],
        splits: [
          { from: range.from, to: mid },
          { from: mid + 1n, to: range.to },
        ],
      };
    }
  }

  try {
    while (pending.length > 0) {
      if (Date.now() >= deadlineMs) {
        completed = false;
        break;
      }

      const range = pending.shift()!;
      if (Number(range.from) !== scannedThroughBlock + 1) {
        completed = false;
        pending.unshift(range);
        break;
      }

      const outcome = await fetchRange(range);
      if (outcome.splits.length > 0) {
        pending.unshift(...outcome.splits);
        continue;
      }

      const rangeRecords: IndexedRecord[] = [];
      for (const log of outcome.logs) {
        if (
          log.topics[0] &&
          log.topics[0].toLowerCase() !== RECORD_SUBMITTED_TOPIC.toLowerCase()
        ) {
          continue;
        }
        const decoded = decodeRecordSubmittedLog(log);
        if (!decoded) continue;
        if (decoded.userAddress !== userChecksum.toLowerCase()) continue;
        rangeRecords.push(decoded);
      }

      const hydrated = shouldResolveTimestamps
        ? await attachBlockTimestamps(rangeRecords, {
            fetchBatch: options.fetchBlockTimestamps,
          })
        : rangeRecords;

      const to = Number(range.to);
      const from = Number(range.from);
      if (options.onRangeComplete) {
        await options.onRangeComplete({
          fromBlock: from,
          toBlock: to,
          records: hydrated,
        });
      }

      records.push(...hydrated);
      scannedThroughBlock = to;
    }
  } catch (error) {
    if (error instanceof WalletScanTimeoutError) {
      completed = false;
      scannedThroughBlock = Math.max(
        scannedThroughBlock,
        error.scannedThroughBlock,
      );
    } else {
      // Failed range: do not advance; rethrow so caller can keep prior checkpoint.
      completed = false;
      throw error;
    }
  }

  if (pending.length > 0) completed = false;
  if (scannedThroughBlock < toBlock) completed = false;
  if (scannedThroughBlock < fromBlock - 1) scannedThroughBlock = fromBlock - 1;

  stats.newEvents = records.length;
  stats.durationMs = Date.now() - started;

  return {
    records,
    completed: completed && scannedThroughBlock >= toBlock,
    scannedThroughBlock: Math.min(
      Math.max(scannedThroughBlock, fromBlock - 1),
      toBlock,
    ),
    stats,
  };
}

export async function getSafeChainHead(
  getBlockNumber?: GetBlockNumberFn,
): Promise<number> {
  const fn = getBlockNumber ?? createDefaultGetBlockNumber();
  const stats = { rpcCalls: 0, retries: 0 };
  const latest = await withRetry(() => fn(), "getBlockNumber", stats);
  return Math.max(0, Number(latest) - SAFE_HEAD_LAG);
}

export function getWalletScanStartBlock(): number {
  return getAxisStartBlock();
}
