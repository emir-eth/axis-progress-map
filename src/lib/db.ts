/**
 * libSQL / Turso store for Axis Progress Map.
 *
 * Production: remote Turso via TURSO_DATABASE_URL + TURSO_AUTH_TOKEN.
 * Local/test: file: SQLite via AXIS_INDEX_DB_PATH (or data/axis-index.db)
 * when Turso env is unset — never as a silent production fallback.
 *
 * All query APIs are async (libSQL client is async).
 */
import type { InArgs, InStatement } from "@libsql/client";
import type { OnChainContribution } from "@/types";
import { ensureSchema } from "@/lib/db-client";

export {
  closeDatabase,
  getDbPath,
  openDatabase,
  ensureSchema,
  DatabaseConfigError,
  getResolvedDbTarget,
  isRemoteTursoConfigured,
} from "@/lib/db-client";

export interface IndexState {
  lastIndexedBlock: number;
  lastSyncAt: number | null;
  initialIndexComplete: boolean;
}

export interface IndexedRecord {
  dataId: string;
  taskId: string;
  userAddress: string;
  score: number;
  simulationTime: number;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  timestamp: number | null;
}

export type WalletCacheStatus = "complete" | "incomplete";

export interface WalletCacheRow {
  address: string;
  lastScannedBlock: number;
  /** Frozen historical target for incomplete first-time scans; null when complete. */
  targetBlock: number | null;
  status: WalletCacheStatus;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
}

export type HubWalletCacheStatus = "complete" | "incomplete";

export interface HubWalletCacheRow {
  address: string;
  totalAttempts: number;
  status: HubWalletCacheStatus;
  lastCompletedPage: number;
  totalPages: number;
  perPage: number;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
}

export interface HubAttemptRecord {
  attemptId: number;
  taskId: string;
  taskName: string | null;
  /** Hub may return null score; never coerce to 0. */
  score: number | null;
  completedAt: string | null;
  createdAt: string | null;
  simulationTimeSeconds: number | null;
  txhash: string | null;
  theme: string | null;
  userId: number | null;
  username: string | null;
  operatorShort: string | null;
  qualityRating: string | null;
  modelId: string | null;
  dataId: string | null;
  chainTaskId: string | null;
  chainScore: number | null;
  chainId: number | null;
  simulationTime: number | null;
  contractAddress: string | null;
  serverSignature: string | null;
  chainDataJson: string | null;
  rawJson: string | null;
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}

function rowVal(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

async function db() {
  return ensureSchema();
}

function stmt(sql: string, args: InArgs = []): InStatement {
  return { sql, args };
}

export async function getIndexState(): Promise<IndexState> {
  const client = await db();
  const rs = await client.execute(
    `SELECT last_indexed_block, last_sync_at, initial_index_complete
     FROM index_state WHERE id = 1`,
  );
  const row = rs.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return {
      lastIndexedBlock: 0,
      lastSyncAt: null,
      initialIndexComplete: false,
    };
  }
  return {
    lastIndexedBlock: asNumber(rowVal(row, "last_indexed_block")),
    lastSyncAt: asNumberOrNull(rowVal(row, "last_sync_at")),
    initialIndexComplete: asNumber(rowVal(row, "initial_index_complete")) === 1,
  };
}

export async function isInitialIndexComplete(): Promise<boolean> {
  const state = await getIndexState();
  return state.initialIndexComplete;
}

export async function setLastIndexedBlock(blockNumber: number): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `UPDATE index_state
     SET last_indexed_block = ?
     WHERE id = 1 AND last_indexed_block < ?`,
    args: [blockNumber, blockNumber],
  });
}

export async function markInitialIndexComplete(
  atMs: number = Date.now(),
): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `UPDATE index_state
     SET initial_index_complete = 1,
         last_sync_at = ?
     WHERE id = 1`,
    args: [atMs],
  });
}

export async function setLastSyncAt(atMs: number): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `UPDATE index_state SET last_sync_at = ? WHERE id = 1`,
    args: [atMs],
  });
}

export async function getCachedBlockTimestamps(
  blockNumbers: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (blockNumbers.length === 0) return out;
  const client = await db();
  // Batch lookup — one query with IN when small/medium lists
  const CHUNK = 200;
  for (let i = 0; i < blockNumbers.length; i += CHUNK) {
    const chunk = blockNumbers.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rs = await client.execute({
      sql: `SELECT block_number, timestamp FROM block_timestamps
            WHERE block_number IN (${placeholders})`,
      args: chunk,
    });
    for (const row of rs.rows) {
      const r = row as Record<string, unknown>;
      out.set(
        asNumber(rowVal(r, "block_number")),
        asNumber(rowVal(r, "timestamp")),
      );
    }
  }
  return out;
}

export async function upsertBlockTimestamps(
  entries: Array<{ blockNumber: number; timestamp: number }>,
): Promise<void> {
  if (entries.length === 0) return;
  const client = await db();
  await client.batch(
    entries.map((row) =>
      stmt(
        `INSERT INTO block_timestamps (block_number, timestamp)
         VALUES (?, ?)
         ON CONFLICT(block_number) DO NOTHING`,
        [row.blockNumber, row.timestamp],
      ),
    ),
    "write",
  );
}

export async function upsertAxisRecords(
  records: IndexedRecord[],
): Promise<number> {
  if (records.length === 0) return 0;
  const client = await db();
  const results = await client.batch(
    records.map((r) =>
      stmt(
        `INSERT INTO axis_records (
      data_id, task_id, user_address, score, simulation_time,
      block_number, transaction_hash, log_index, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(transaction_hash, log_index) DO UPDATE SET
      data_id = excluded.data_id,
      task_id = excluded.task_id,
      user_address = excluded.user_address,
      score = excluded.score,
      simulation_time = excluded.simulation_time,
      block_number = excluded.block_number,
      timestamp = COALESCE(excluded.timestamp, axis_records.timestamp)`,
        [
          r.dataId,
          r.taskId,
          r.userAddress,
          r.score,
          r.simulationTime,
          r.blockNumber,
          r.transactionHash,
          r.logIndex,
          r.timestamp,
        ],
      ),
    ),
    "write",
  );
  return results.reduce((n, rs) => n + (rs.rowsAffected > 0 ? 1 : 0), 0);
}

export async function countAxisRecords(): Promise<number> {
  const client = await db();
  const rs = await client.execute(`SELECT COUNT(*) AS c FROM axis_records`);
  return asNumber(rs.rows[0]?.c);
}

export async function getWalletRecords(
  walletLower: string,
): Promise<OnChainContribution[]> {
  const client = await db();
  const rs = await client.execute({
    sql: `SELECT data_id, task_id, user_address, score, simulation_time,
              block_number, transaction_hash, log_index, timestamp
       FROM axis_records
       WHERE user_address = ?
       ORDER BY block_number ASC, log_index ASC`,
    args: [walletLower],
  });

  return rs.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      dataId: String(rowVal(r, "data_id")),
      taskId: String(rowVal(r, "task_id")),
      user: String(rowVal(r, "user_address")) as `0x${string}`,
      score: asNumber(rowVal(r, "score")),
      simulationTime: asNumber(rowVal(r, "simulation_time")),
      blockNumber: asNumber(rowVal(r, "block_number")),
      transactionHash: String(
        rowVal(r, "transaction_hash"),
      ) as `0x${string}`,
      logIndex: asNumber(rowVal(r, "log_index")),
      timestamp: asNumberOrNull(rowVal(r, "timestamp")),
    };
  });
}

export async function forceLastSyncAt(atMs: number | null): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `UPDATE index_state SET last_sync_at = ? WHERE id = 1`,
    args: [atMs],
  });
}

export async function getWalletCache(
  addressLower: string,
): Promise<WalletCacheRow | null> {
  const client = await db();
  const rs = await client.execute({
    sql: `SELECT address, last_scanned_block, target_block, status,
              created_at, updated_at, last_error
       FROM wallet_cache WHERE address = ?`,
    args: [addressLower],
  });
  const row = rs.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    address: String(rowVal(row, "address")),
    lastScannedBlock: asNumber(rowVal(row, "last_scanned_block")),
    targetBlock: asNumberOrNull(rowVal(row, "target_block")),
    status: rowVal(row, "status") === "complete" ? "complete" : "incomplete",
    createdAt: asNumber(rowVal(row, "created_at")),
    updatedAt: asNumber(rowVal(row, "updated_at")),
    lastError: asStringOrNull(rowVal(row, "last_error")),
  };
}

export async function upsertWalletEvents(
  addressLower: string,
  records: IndexedRecord[],
): Promise<number> {
  if (records.length === 0) return 0;
  const client = await db();
  const results = await client.batch(
    records.map((r) =>
      stmt(
        `INSERT INTO wallet_events (
      address, transaction_hash, log_index, block_number,
      data_id, task_id, score, simulation_time, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(address, transaction_hash, log_index) DO UPDATE SET
      block_number = excluded.block_number,
      data_id = excluded.data_id,
      task_id = excluded.task_id,
      score = excluded.score,
      simulation_time = excluded.simulation_time,
      timestamp = COALESCE(excluded.timestamp, wallet_events.timestamp)`,
        [
          addressLower,
          r.transactionHash,
          r.logIndex,
          r.blockNumber,
          r.dataId,
          r.taskId,
          r.score,
          r.simulationTime,
          r.timestamp,
        ],
      ),
    ),
    "write",
  );
  return results.reduce((n, rs) => n + (rs.rowsAffected > 0 ? 1 : 0), 0);
}

export async function saveCompleteWalletCache(
  addressLower: string,
  lastScannedBlock: number,
  nowMs: number = Date.now(),
): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `INSERT INTO wallet_cache (
      address, last_scanned_block, target_block, status,
      created_at, updated_at, last_error
    ) VALUES (?, ?, NULL, 'complete', ?, ?, NULL)
    ON CONFLICT(address) DO UPDATE SET
      last_scanned_block = MAX(wallet_cache.last_scanned_block, excluded.last_scanned_block),
      target_block = NULL,
      status = 'complete',
      updated_at = excluded.updated_at,
      last_error = NULL`,
    args: [addressLower, lastScannedBlock, nowMs, nowMs],
  });
}

export async function persistIncompleteRangeProgress(
  addressLower: string,
  records: IndexedRecord[],
  lastScannedBlock: number,
  targetBlock: number,
  nowMs: number = Date.now(),
): Promise<void> {
  const client = await db();
  const statements: InStatement[] = records.map((r) =>
    stmt(
      `INSERT INTO wallet_events (
      address, transaction_hash, log_index, block_number,
      data_id, task_id, score, simulation_time, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(address, transaction_hash, log_index) DO UPDATE SET
      block_number = excluded.block_number,
      data_id = excluded.data_id,
      task_id = excluded.task_id,
      score = excluded.score,
      simulation_time = excluded.simulation_time,
      timestamp = COALESCE(excluded.timestamp, wallet_events.timestamp)`,
      [
        addressLower,
        r.transactionHash,
        r.logIndex,
        r.blockNumber,
        r.dataId,
        r.taskId,
        r.score,
        r.simulationTime,
        r.timestamp,
      ],
    ),
  );
  statements.push(
    stmt(
      `INSERT INTO wallet_cache (
      address, last_scanned_block, target_block, status,
      created_at, updated_at, last_error
    ) VALUES (?, ?, ?, 'incomplete', ?, ?, NULL)
    ON CONFLICT(address) DO UPDATE SET
      last_scanned_block = MAX(wallet_cache.last_scanned_block, excluded.last_scanned_block),
      target_block = COALESCE(wallet_cache.target_block, excluded.target_block),
      status = CASE
        WHEN wallet_cache.status = 'complete' THEN wallet_cache.status
        ELSE 'incomplete'
      END,
      updated_at = excluded.updated_at,
      last_error = CASE
        WHEN wallet_cache.status = 'complete' THEN wallet_cache.last_error
        ELSE NULL
      END`,
      [addressLower, lastScannedBlock, targetBlock, nowMs, nowMs],
    ),
  );
  await client.batch(statements, "write");
}

export async function ensureIncompleteWalletScan(
  addressLower: string,
  lastScannedBlock: number,
  targetBlock: number,
  nowMs: number = Date.now(),
): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `INSERT INTO wallet_cache (
      address, last_scanned_block, target_block, status,
      created_at, updated_at, last_error
    ) VALUES (?, ?, ?, 'incomplete', ?, ?, NULL)
    ON CONFLICT(address) DO UPDATE SET
      target_block = COALESCE(wallet_cache.target_block, excluded.target_block),
      status = CASE
        WHEN wallet_cache.status = 'complete' THEN wallet_cache.status
        ELSE 'incomplete'
      END,
      updated_at = excluded.updated_at`,
    args: [addressLower, lastScannedBlock, targetBlock, nowMs, nowMs],
  });
}

export async function markIncompleteScanError(
  addressLower: string,
  error: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `UPDATE wallet_cache
     SET last_error = ?, updated_at = ?
     WHERE address = ? AND status = 'incomplete'`,
    args: [error.slice(0, 500), nowMs, addressLower],
  });
}

export async function markWalletCacheRefreshFailed(
  addressLower: string,
  error: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `UPDATE wallet_cache
     SET last_error = ?, updated_at = ?
     WHERE address = ? AND status = 'complete'`,
    args: [error.slice(0, 500), nowMs, addressLower],
  });
}

export async function clearWalletCacheRefreshError(
  addressLower: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `UPDATE wallet_cache
     SET last_error = NULL, updated_at = ?
     WHERE address = ?`,
    args: [nowMs, addressLower],
  });
}

export async function getCachedWalletEvents(
  addressLower: string,
): Promise<OnChainContribution[]> {
  const client = await db();
  const rs = await client.execute({
    sql: `SELECT data_id, task_id, score, simulation_time,
              block_number, transaction_hash, log_index, timestamp
       FROM wallet_events
       WHERE address = ?
       ORDER BY block_number ASC, log_index ASC`,
    args: [addressLower],
  });

  return rs.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      dataId: String(rowVal(r, "data_id")),
      taskId: String(rowVal(r, "task_id")),
      user: addressLower as `0x${string}`,
      score: asNumber(rowVal(r, "score")),
      simulationTime: asNumber(rowVal(r, "simulation_time")),
      blockNumber: asNumber(rowVal(r, "block_number")),
      transactionHash: String(
        rowVal(r, "transaction_hash"),
      ) as `0x${string}`,
      logIndex: asNumber(rowVal(r, "log_index")),
      timestamp: asNumberOrNull(rowVal(r, "timestamp")),
    };
  });
}

export async function countCachedWalletEvents(
  addressLower: string,
): Promise<number> {
  const client = await db();
  const rs = await client.execute({
    sql: `SELECT COUNT(*) AS c FROM wallet_events WHERE address = ?`,
    args: [addressLower],
  });
  return asNumber(rs.rows[0]?.c);
}

export async function countWalletEventsMissingTimestamps(
  addressLower: string,
): Promise<number> {
  const client = await db();
  const rs = await client.execute({
    sql: `SELECT COUNT(*) AS c FROM wallet_events
       WHERE address = ? AND timestamp IS NULL`,
    args: [addressLower],
  });
  return asNumber(rs.rows[0]?.c);
}

export async function listDistinctBlocksMissingTimestamps(
  addressLower: string,
): Promise<number[]> {
  const client = await db();
  const rs = await client.execute({
    sql: `SELECT DISTINCT block_number AS block_number
       FROM wallet_events
       WHERE address = ? AND timestamp IS NULL
       ORDER BY block_number ASC`,
    args: [addressLower],
  });
  return rs.rows.map((row) =>
    asNumber((row as Record<string, unknown>).block_number),
  );
}

export async function applyBlockTimestampToWalletEvents(
  blockNumber: number,
  timestamp: number,
  addressLower?: string,
): Promise<number> {
  const client = await db();
  if (addressLower) {
    const rs = await client.execute({
      sql: `UPDATE wallet_events
         SET timestamp = ?
         WHERE address = ? AND block_number = ? AND timestamp IS NULL`,
      args: [timestamp, addressLower, blockNumber],
    });
    return rs.rowsAffected;
  }
  const rs = await client.execute({
    sql: `UPDATE wallet_events
       SET timestamp = ?
       WHERE block_number = ? AND timestamp IS NULL`,
    args: [timestamp, blockNumber],
  });
  return rs.rowsAffected;
}

export async function getWalletEventByTx(
  addressLower: string,
  transactionHash: string,
): Promise<{
  blockNumber: number;
  timestamp: number | null;
  taskId: string;
  score: number;
  dataId: string;
} | null> {
  const client = await db();
  const rs = await client.execute({
    sql: `SELECT block_number, timestamp, task_id, score, data_id
       FROM wallet_events
       WHERE address = ? AND lower(transaction_hash) = lower(?)
       LIMIT 1`,
    args: [addressLower, transactionHash],
  });
  const row = rs.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    blockNumber: asNumber(rowVal(row, "block_number")),
    timestamp: asNumberOrNull(rowVal(row, "timestamp")),
    taskId: String(rowVal(row, "task_id")),
    score: asNumber(rowVal(row, "score")),
    dataId: String(rowVal(row, "data_id")),
  };
}

/** Pure helper — merge + dedupe by (txHash, logIndex). */
export function dedupeContributions(
  rows: OnChainContribution[],
): OnChainContribution[] {
  const map = new Map<string, OnChainContribution>();
  for (const row of rows) {
    map.set(`${row.transactionHash.toLowerCase()}:${row.logIndex}`, row);
  }
  return [...map.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber - b.blockNumber,
  );
}

/** Compute incremental scan window; null means no RPC needed. */
export function computeIncrementalRange(
  lastScannedBlock: number,
  currentBlock: number,
): { fromBlock: number; toBlock: number } | null {
  if (currentBlock <= lastScannedBlock) return null;
  return { fromBlock: lastScannedBlock + 1, toBlock: currentBlock };
}

/** Block-scan progress only — not contribution completion. */
export function computeHistoricalScanPercent(
  fromBlock: number,
  lastScannedBlock: number,
  targetBlock: number,
): number {
  const span = targetBlock - fromBlock;
  if (span <= 0) return lastScannedBlock >= targetBlock ? 100 : 0;
  const done = Math.max(0, lastScannedBlock - fromBlock);
  return Math.min(100, Math.round((done / span) * 10000) / 100);
}

// ── Hub attempt cache (primary profile source) ───────────────────────────

export async function getHubWalletCache(
  addressLower: string,
): Promise<HubWalletCacheRow | null> {
  const client = await db();
  const rs = await client.execute({
    sql: `SELECT address, total_attempts, status, last_completed_page, total_pages,
              per_page, created_at, updated_at, last_error
       FROM hub_wallet_cache WHERE address = ?`,
    args: [addressLower],
  });
  const row = rs.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    address: String(rowVal(row, "address")),
    totalAttempts: asNumber(rowVal(row, "total_attempts")),
    status: rowVal(row, "status") === "complete" ? "complete" : "incomplete",
    lastCompletedPage: asNumber(rowVal(row, "last_completed_page")),
    totalPages: asNumber(rowVal(row, "total_pages")),
    perPage: asNumber(rowVal(row, "per_page")),
    createdAt: asNumber(rowVal(row, "created_at")),
    updatedAt: asNumber(rowVal(row, "updated_at")),
    lastError: asStringOrNull(rowVal(row, "last_error")),
  };
}

export async function countHubAttempts(addressLower: string): Promise<number> {
  const client = await db();
  const rs = await client.execute({
    sql: `SELECT COUNT(*) AS c FROM hub_attempts WHERE address = ?`,
    args: [addressLower],
  });
  return asNumber(rs.rows[0]?.c);
}

function mapHubAttemptRow(row: Record<string, unknown>): HubAttemptRecord {
  return {
    attemptId: asNumber(rowVal(row, "attempt_id")),
    taskId: String(rowVal(row, "task_id")),
    taskName: asStringOrNull(rowVal(row, "task_name")),
    score: asNumberOrNull(rowVal(row, "score")),
    completedAt: asStringOrNull(rowVal(row, "completed_at")),
    createdAt: asStringOrNull(rowVal(row, "created_at")),
    simulationTimeSeconds: asNumberOrNull(
      rowVal(row, "simulation_time_seconds"),
    ),
    txhash: asStringOrNull(rowVal(row, "txhash")),
    theme: asStringOrNull(rowVal(row, "theme")),
    userId: asNumberOrNull(rowVal(row, "user_id")),
    username: asStringOrNull(rowVal(row, "username")),
    operatorShort: asStringOrNull(rowVal(row, "operator_short")),
    qualityRating: asStringOrNull(rowVal(row, "quality_rating")),
    modelId: asStringOrNull(rowVal(row, "model_id")),
    dataId: asStringOrNull(rowVal(row, "data_id")),
    chainTaskId: asStringOrNull(rowVal(row, "chain_task_id")),
    chainScore: asNumberOrNull(rowVal(row, "chain_score")),
    chainId: asNumberOrNull(rowVal(row, "chain_id")),
    simulationTime: asNumberOrNull(rowVal(row, "simulation_time")),
    contractAddress: asStringOrNull(rowVal(row, "contract_address")),
    serverSignature: asStringOrNull(rowVal(row, "server_signature")),
    chainDataJson: asStringOrNull(rowVal(row, "chain_data_json")),
    rawJson: asStringOrNull(rowVal(row, "raw_json")),
  };
}

export async function getCachedHubAttempts(
  addressLower: string,
): Promise<HubAttemptRecord[]> {
  const client = await db();
  const rs = await client.execute({
    sql: `SELECT attempt_id, task_id, task_name, score, completed_at, created_at,
              simulation_time_seconds, txhash, theme, user_id, username,
              operator_short, quality_rating, model_id, data_id, chain_task_id,
              chain_score, chain_id, simulation_time, contract_address,
              server_signature, chain_data_json, raw_json
       FROM hub_attempts
       WHERE address = ?
       ORDER BY attempt_id DESC`,
    args: [addressLower],
  });
  return rs.rows.map((row) => mapHubAttemptRow(row as Record<string, unknown>));
}

export async function getKnownHubAttemptIds(
  addressLower: string,
): Promise<Set<number>> {
  const client = await db();
  const rs = await client.execute({
    sql: `SELECT attempt_id FROM hub_attempts WHERE address = ?`,
    args: [addressLower],
  });
  return new Set(
    rs.rows.map((row) =>
      asNumber((row as Record<string, unknown>).attempt_id),
    ),
  );
}

function hubAttemptArgs(
  addressLower: string,
  r: HubAttemptRecord,
): InArgs {
  return [
    addressLower,
    r.attemptId,
    r.taskId,
    r.taskName,
    r.score,
    r.completedAt,
    r.createdAt,
    r.simulationTimeSeconds,
    r.txhash,
    r.theme,
    r.userId,
    r.username,
    r.operatorShort,
    r.qualityRating,
    r.modelId,
    r.dataId,
    r.chainTaskId,
    r.chainScore,
    r.chainId,
    r.simulationTime,
    r.contractAddress,
    r.serverSignature,
    r.chainDataJson,
    r.rawJson,
  ];
}

const HUB_ATTEMPT_UPSERT_SQL = `INSERT INTO hub_attempts (
      address, attempt_id, task_id, task_name, score, completed_at, created_at,
      simulation_time_seconds, txhash, theme, user_id, username, operator_short,
      quality_rating, model_id, data_id, chain_task_id, chain_score, chain_id,
      simulation_time, contract_address, server_signature, chain_data_json, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(address, attempt_id) DO UPDATE SET
      task_id = excluded.task_id,
      task_name = excluded.task_name,
      score = excluded.score,
      completed_at = excluded.completed_at,
      created_at = excluded.created_at,
      simulation_time_seconds = excluded.simulation_time_seconds,
      txhash = excluded.txhash,
      theme = excluded.theme,
      user_id = excluded.user_id,
      username = excluded.username,
      operator_short = excluded.operator_short,
      quality_rating = excluded.quality_rating,
      model_id = excluded.model_id,
      data_id = excluded.data_id,
      chain_task_id = excluded.chain_task_id,
      chain_score = excluded.chain_score,
      chain_id = excluded.chain_id,
      simulation_time = excluded.simulation_time,
      contract_address = excluded.contract_address,
      server_signature = excluded.server_signature,
      chain_data_json = excluded.chain_data_json,
      raw_json = excluded.raw_json`;

export async function upsertHubAttempts(
  addressLower: string,
  records: HubAttemptRecord[],
): Promise<number> {
  if (records.length === 0) return 0;
  const client = await db();
  const results = await client.batch(
    records.map((r) => stmt(HUB_ATTEMPT_UPSERT_SQL, hubAttemptArgs(addressLower, r))),
    "write",
  );
  return results.reduce((n, rs) => n + (rs.rowsAffected > 0 ? 1 : 0), 0);
}

export async function persistHubPageProgress(
  addressLower: string,
  opts: {
    records: HubAttemptRecord[];
    totalAttempts: number;
    totalPages: number;
    lastCompletedPage: number;
    perPage: number;
    status: HubWalletCacheStatus;
    lastError?: string | null;
    nowMs?: number;
  },
): Promise<void> {
  const nowMs = opts.nowMs ?? Date.now();
  const client = await db();
  const statements: InStatement[] = opts.records.map((r) =>
    stmt(HUB_ATTEMPT_UPSERT_SQL, hubAttemptArgs(addressLower, r)),
  );
  const touchError = opts.lastError !== undefined ? 1 : 0;
  statements.push(
    stmt(
      `INSERT INTO hub_wallet_cache (
      address, total_attempts, status, last_completed_page, total_pages,
      per_page, created_at, updated_at, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET
      total_attempts = excluded.total_attempts,
      status = excluded.status,
      last_completed_page = excluded.last_completed_page,
      total_pages = excluded.total_pages,
      per_page = excluded.per_page,
      updated_at = excluded.updated_at,
      last_error = CASE
        WHEN ? = 1 THEN excluded.last_error
        ELSE hub_wallet_cache.last_error
      END`,
      [
        addressLower,
        opts.totalAttempts,
        opts.status,
        opts.lastCompletedPage,
        opts.totalPages,
        opts.perPage,
        nowMs,
        nowMs,
        opts.lastError ?? null,
        touchError,
      ],
    ),
  );
  await client.batch(statements, "write");
}

export async function touchHubWalletCacheFreshness(
  addressLower: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `UPDATE hub_wallet_cache
     SET updated_at = ?, last_error = NULL
     WHERE address = ?`,
    args: [nowMs, addressLower],
  });
}

export async function markHubWalletCacheError(
  addressLower: string,
  error: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `UPDATE hub_wallet_cache
     SET last_error = ?, updated_at = ?
     WHERE address = ?`,
    args: [error.slice(0, 500), nowMs, addressLower],
  });
}

export async function clearHubAttemptsForAddress(
  addressLower: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const client = await db();
  await client.batch(
    [
      stmt(`DELETE FROM hub_attempts WHERE address = ?`, [addressLower]),
      stmt(
        `UPDATE hub_wallet_cache
       SET status = 'incomplete',
           last_completed_page = 0,
           last_error = NULL,
           updated_at = ?
       WHERE address = ?`,
        [nowMs, addressLower],
      ),
    ],
    "write",
  );
}

export function computeHubFetchPercent(
  fetchedAttempts: number,
  totalAttempts: number,
): number {
  if (totalAttempts <= 0) return fetchedAttempts > 0 ? 100 : 0;
  return Math.min(
    100,
    Math.round((fetchedAttempts / totalAttempts) * 10000) / 100,
  );
}
