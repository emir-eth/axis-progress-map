/**
 * SQLite store for Axis Progress Map.
 *
 * Production path: per-wallet cache (`wallet_cache` + `wallet_events`).
 * Legacy experimental global index tables remain for CLI tooling only.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { OnChainContribution } from "@/types";

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

declare global {
  var __axisSqliteDb: Database.Database | undefined;
}

function resolveDbPath(): string {
  const override = process.env.AXIS_INDEX_DB_PATH?.trim();
  if (override) return path.resolve(override);
  return path.join(process.cwd(), "data", "axis-index.db");
}

export function getDbPath(): string {
  return resolveDbPath();
}

export function openDatabase(): Database.Database {
  if (globalThis.__axisSqliteDb) {
    return globalThis.__axisSqliteDb;
  }

  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS axis_records (
      data_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      user_address TEXT NOT NULL,
      score INTEGER NOT NULL,
      simulation_time INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      transaction_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      timestamp INTEGER,
      PRIMARY KEY (transaction_hash, log_index)
    );

    CREATE INDEX IF NOT EXISTS idx_axis_records_user
      ON axis_records (user_address);
    CREATE INDEX IF NOT EXISTS idx_axis_records_task
      ON axis_records (task_id);
    CREATE INDEX IF NOT EXISTS idx_axis_records_block
      ON axis_records (block_number);
    CREATE INDEX IF NOT EXISTS idx_axis_records_timestamp
      ON axis_records (timestamp);

    CREATE TABLE IF NOT EXISTS block_timestamps (
      block_number INTEGER PRIMARY KEY,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS index_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_indexed_block INTEGER NOT NULL,
      last_sync_at INTEGER,
      initial_index_complete INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO index_state (id, last_indexed_block, last_sync_at, initial_index_complete)
    VALUES (1, 0, NULL, 0);

    CREATE TABLE IF NOT EXISTS wallet_cache (
      address TEXT PRIMARY KEY,
      last_scanned_block INTEGER NOT NULL,
      target_block INTEGER,
      status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS wallet_events (
      address TEXT NOT NULL,
      transaction_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      data_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      simulation_time INTEGER NOT NULL,
      timestamp INTEGER,
      PRIMARY KEY (address, transaction_hash, log_index)
    );

    CREATE INDEX IF NOT EXISTS idx_wallet_events_address_block
      ON wallet_events (address, block_number, log_index);

    CREATE TABLE IF NOT EXISTS hub_wallet_cache (
      address TEXT PRIMARY KEY,
      total_attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete')),
      last_completed_page INTEGER NOT NULL DEFAULT 0,
      total_pages INTEGER NOT NULL DEFAULT 0,
      per_page INTEGER NOT NULL DEFAULT 100,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS hub_attempts (
      address TEXT NOT NULL,
      attempt_id INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      task_name TEXT,
      score REAL,
      completed_at TEXT,
      created_at TEXT,
      simulation_time_seconds REAL,
      txhash TEXT,
      theme TEXT,
      user_id INTEGER,
      username TEXT,
      operator_short TEXT,
      quality_rating TEXT,
      model_id TEXT,
      data_id TEXT,
      chain_task_id TEXT,
      chain_score REAL,
      chain_id INTEGER,
      simulation_time INTEGER,
      contract_address TEXT,
      server_signature TEXT,
      chain_data_json TEXT,
      raw_json TEXT,
      PRIMARY KEY (address, attempt_id)
    );

    CREATE INDEX IF NOT EXISTS idx_hub_attempts_address
      ON hub_attempts (address);
    CREATE INDEX IF NOT EXISTS idx_hub_attempts_attempt_id
      ON hub_attempts (attempt_id);
    CREATE INDEX IF NOT EXISTS idx_hub_attempts_task_id
      ON hub_attempts (address, task_id);
    CREATE INDEX IF NOT EXISTS idx_hub_attempts_completed_at
      ON hub_attempts (address, completed_at);
    CREATE INDEX IF NOT EXISTS idx_hub_attempts_txhash
      ON hub_attempts (address, txhash);
  `);

  ensureWalletCacheMigrations(db);
  ensureHubAttemptsScoreNullable(db);

  globalThis.__axisSqliteDb = db;
  return db;
}

/**
 * Older DBs created score as REAL NOT NULL. Rebuild so null Hub scores can persist.
 * Preserves all existing rows.
 */
function ensureHubAttemptsScoreNullable(db: Database.Database): void {
  const cols = db
    .prepare(`PRAGMA table_info(hub_attempts)`)
    .all() as Array<{ name: string; notnull: number }>;
  if (cols.length === 0) return;
  const scoreCol = cols.find((c) => c.name === "score");
  if (!scoreCol || scoreCol.notnull === 0) return;

  db.exec(`
    BEGIN;
    CREATE TABLE hub_attempts_score_nullable (
      address TEXT NOT NULL,
      attempt_id INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      task_name TEXT,
      score REAL,
      completed_at TEXT,
      created_at TEXT,
      simulation_time_seconds REAL,
      txhash TEXT,
      theme TEXT,
      user_id INTEGER,
      username TEXT,
      operator_short TEXT,
      quality_rating TEXT,
      model_id TEXT,
      data_id TEXT,
      chain_task_id TEXT,
      chain_score REAL,
      chain_id INTEGER,
      simulation_time INTEGER,
      contract_address TEXT,
      server_signature TEXT,
      chain_data_json TEXT,
      raw_json TEXT,
      PRIMARY KEY (address, attempt_id)
    );
    INSERT INTO hub_attempts_score_nullable SELECT * FROM hub_attempts;
    DROP TABLE hub_attempts;
    ALTER TABLE hub_attempts_score_nullable RENAME TO hub_attempts;
    CREATE INDEX IF NOT EXISTS idx_hub_attempts_address
      ON hub_attempts (address);
    CREATE INDEX IF NOT EXISTS idx_hub_attempts_attempt_id
      ON hub_attempts (attempt_id);
    CREATE INDEX IF NOT EXISTS idx_hub_attempts_task_id
      ON hub_attempts (address, task_id);
    CREATE INDEX IF NOT EXISTS idx_hub_attempts_completed_at
      ON hub_attempts (address, completed_at);
    CREATE INDEX IF NOT EXISTS idx_hub_attempts_txhash
      ON hub_attempts (address, txhash);
    COMMIT;
  `);
}

/** Add columns / indexes introduced after the first wallet_cache schema. */
function ensureWalletCacheMigrations(db: Database.Database): void {
  const cols = db
    .prepare(`PRAGMA table_info(wallet_cache)`)
    .all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("target_block")) {
    db.exec(`ALTER TABLE wallet_cache ADD COLUMN target_block INTEGER`);
  }

  // Partial index for timestamp backfill (safe if already present).
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_wallet_events_missing_timestamp
        ON wallet_events (address, block_number)
        WHERE timestamp IS NULL
    `);
  } catch {
    // Older SQLite builds without partial indexes — backfill still works.
  }
}

/** Test helper: close and drop the process-global connection. */
export function closeDatabase(): void {
  if (globalThis.__axisSqliteDb) {
    globalThis.__axisSqliteDb.close();
    globalThis.__axisSqliteDb = undefined;
  }
}

export function databaseFileExists(): boolean {
  return fs.existsSync(resolveDbPath());
}

export function getIndexState(): IndexState {
  const db = openDatabase();
  const row = db
    .prepare(
      `SELECT last_indexed_block, last_sync_at, initial_index_complete
       FROM index_state WHERE id = 1`,
    )
    .get() as
    | {
        last_indexed_block: number;
        last_sync_at: number | null;
        initial_index_complete: number;
      }
    | undefined;

  if (!row) {
    return {
      lastIndexedBlock: 0,
      lastSyncAt: null,
      initialIndexComplete: false,
    };
  }

  return {
    lastIndexedBlock: row.last_indexed_block,
    lastSyncAt: row.last_sync_at,
    initialIndexComplete: row.initial_index_complete === 1,
  };
}

export function isInitialIndexComplete(): boolean {
  if (!databaseFileExists()) return false;
  return getIndexState().initialIndexComplete;
}

/**
 * Persist progress only after a contiguous range was fully written.
 * Never advances past an incomplete fetch.
 */
export function setLastIndexedBlock(blockNumber: number): void {
  const db = openDatabase();
  db.prepare(
    `UPDATE index_state
     SET last_indexed_block = ?
     WHERE id = 1 AND last_indexed_block < ?`,
  ).run(blockNumber, blockNumber);
}

export function markInitialIndexComplete(atMs: number = Date.now()): void {
  const db = openDatabase();
  db.prepare(
    `UPDATE index_state
     SET initial_index_complete = 1,
         last_sync_at = ?
     WHERE id = 1`,
  ).run(atMs);
}

export function setLastSyncAt(atMs: number): void {
  const db = openDatabase();
  db.prepare(`UPDATE index_state SET last_sync_at = ? WHERE id = 1`).run(atMs);
}

export function getCachedBlockTimestamps(
  blockNumbers: number[],
): Map<number, number> {
  const out = new Map<number, number>();
  if (blockNumbers.length === 0) return out;
  const db = openDatabase();
  const stmt = db.prepare(
    `SELECT timestamp FROM block_timestamps WHERE block_number = ?`,
  );
  for (const bn of blockNumbers) {
    const row = stmt.get(bn) as { timestamp: number } | undefined;
    if (row) out.set(bn, row.timestamp);
  }
  return out;
}

export function upsertBlockTimestamps(
  entries: Array<{ blockNumber: number; timestamp: number }>,
): void {
  if (entries.length === 0) return;
  const db = openDatabase();
  const stmt = db.prepare(
    `INSERT INTO block_timestamps (block_number, timestamp)
     VALUES (?, ?)
     ON CONFLICT(block_number) DO NOTHING`,
  );
  const tx = db.transaction((rows: typeof entries) => {
    for (const row of rows) {
      stmt.run(row.blockNumber, row.timestamp);
    }
  });
  tx(entries);
}

export function upsertAxisRecords(records: IndexedRecord[]): number {
  if (records.length === 0) return 0;
  const db = openDatabase();
  const stmt = db.prepare(
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
  );

  let inserted = 0;
  const tx = db.transaction((rows: IndexedRecord[]) => {
    for (const r of rows) {
      const info = stmt.run(
        r.dataId,
        r.taskId,
        r.userAddress,
        r.score,
        r.simulationTime,
        r.blockNumber,
        r.transactionHash,
        r.logIndex,
        r.timestamp,
      );
      // changes is 1 for insert or update; count only brand-new rows via changes+lastInsertRowid is messy.
      // Use changes === 1 && not an update: better-sqlite3 returns changes for both.
      // Track via SELECT before is expensive; approximate with changes and ignore duplicates:
      if (info.changes > 0) inserted += 1;
    }
  });
  tx(records);
  return inserted;
}

export function countAxisRecords(): number {
  const db = openDatabase();
  const row = db.prepare(`SELECT COUNT(*) AS c FROM axis_records`).get() as {
    c: number;
  };
  return row.c;
}

export function getWalletRecords(walletLower: string): OnChainContribution[] {
  const db = openDatabase();
  const rows = db
    .prepare(
      `SELECT data_id, task_id, user_address, score, simulation_time,
              block_number, transaction_hash, log_index, timestamp
       FROM axis_records
       WHERE user_address = ?
       ORDER BY block_number ASC, log_index ASC`,
    )
    .all(walletLower) as Array<{
    data_id: string;
    task_id: string;
    user_address: string;
    score: number;
    simulation_time: number;
    block_number: number;
    transaction_hash: string;
    log_index: number;
    timestamp: number | null;
  }>;

  return rows.map((r) => ({
    dataId: r.data_id,
    taskId: r.task_id,
    user: r.user_address as `0x${string}`,
    score: r.score,
    simulationTime: r.simulation_time,
    blockNumber: r.block_number,
    transactionHash: r.transaction_hash as `0x${string}`,
    logIndex: r.log_index,
    timestamp: r.timestamp,
  }));
}

/** Test helper: force last_sync_at into the past without wiping indexed events. */
export function forceLastSyncAt(atMs: number | null): void {
  const db = openDatabase();
  db.prepare(`UPDATE index_state SET last_sync_at = ? WHERE id = 1`).run(atMs);
}

export function getWalletCache(addressLower: string): WalletCacheRow | null {
  const db = openDatabase();
  const row = db
    .prepare(
      `SELECT address, last_scanned_block, target_block, status,
              created_at, updated_at, last_error
       FROM wallet_cache WHERE address = ?`,
    )
    .get(addressLower) as
    | {
        address: string;
        last_scanned_block: number;
        target_block: number | null;
        status: string;
        created_at: number;
        updated_at: number;
        last_error: string | null;
      }
    | undefined;

  if (!row) return null;
  return {
    address: row.address,
    lastScannedBlock: row.last_scanned_block,
    targetBlock:
      row.target_block == null ? null : Number(row.target_block),
    status: row.status === "complete" ? "complete" : "incomplete",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
  };
}

export function upsertWalletEvents(
  addressLower: string,
  records: IndexedRecord[],
): number {
  if (records.length === 0) return 0;
  const db = openDatabase();
  const stmt = db.prepare(
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
  );

  let touched = 0;
  const tx = db.transaction((rows: IndexedRecord[]) => {
    for (const r of rows) {
      const info = stmt.run(
        addressLower,
        r.transactionHash,
        r.logIndex,
        r.blockNumber,
        r.dataId,
        r.taskId,
        r.score,
        r.simulationTime,
        r.timestamp,
      );
      if (info.changes > 0) touched += 1;
    }
  });
  tx(records);
  return touched;
}

/**
 * Persist a completed wallet cache entry.
 * Only call after a contiguous scan through `lastScannedBlock` succeeded.
 */
export function saveCompleteWalletCache(
  addressLower: string,
  lastScannedBlock: number,
  nowMs: number = Date.now(),
): void {
  const db = openDatabase();
  db.prepare(
    `INSERT INTO wallet_cache (
      address, last_scanned_block, target_block, status,
      created_at, updated_at, last_error
    ) VALUES (?, ?, NULL, 'complete', ?, ?, NULL)
    ON CONFLICT(address) DO UPDATE SET
      last_scanned_block = excluded.last_scanned_block,
      target_block = NULL,
      status = 'complete',
      updated_at = excluded.updated_at,
      last_error = NULL`,
  ).run(addressLower, lastScannedBlock, nowMs, nowMs);
}

/**
 * Atomic checkpoint for resumable first-time scans:
 * upsert events for the completed range, then advance last_scanned_block.
 * Never marks status=complete.
 */
export function persistIncompleteRangeProgress(
  addressLower: string,
  records: IndexedRecord[],
  lastScannedBlock: number,
  targetBlock: number,
  nowMs: number = Date.now(),
): void {
  const db = openDatabase();
  const eventStmt = db.prepare(
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
  );
  const cacheStmt = db.prepare(
    `INSERT INTO wallet_cache (
      address, last_scanned_block, target_block, status,
      created_at, updated_at, last_error
    ) VALUES (?, ?, ?, 'incomplete', ?, ?, NULL)
    ON CONFLICT(address) DO UPDATE SET
      last_scanned_block = excluded.last_scanned_block,
      target_block = COALESCE(wallet_cache.target_block, excluded.target_block),
      status = 'incomplete',
      updated_at = excluded.updated_at,
      last_error = NULL`,
  );

  const tx = db.transaction(() => {
    for (const r of records) {
      eventStmt.run(
        addressLower,
        r.transactionHash,
        r.logIndex,
        r.blockNumber,
        r.dataId,
        r.taskId,
        r.score,
        r.simulationTime,
        r.timestamp,
      );
    }
    cacheStmt.run(
      addressLower,
      lastScannedBlock,
      targetBlock,
      nowMs,
      nowMs,
    );
  });
  tx();
}

/** Initialize incomplete scan row before any range succeeds (target frozen). */
export function ensureIncompleteWalletScan(
  addressLower: string,
  lastScannedBlock: number,
  targetBlock: number,
  nowMs: number = Date.now(),
): void {
  const db = openDatabase();
  db.prepare(
    `INSERT INTO wallet_cache (
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
  ).run(addressLower, lastScannedBlock, targetBlock, nowMs, nowMs);
}

export function markIncompleteScanError(
  addressLower: string,
  error: string,
  nowMs: number = Date.now(),
): void {
  const db = openDatabase();
  db.prepare(
    `UPDATE wallet_cache
     SET last_error = ?, updated_at = ?
     WHERE address = ? AND status = 'incomplete'`,
  ).run(error.slice(0, 500), nowMs, addressLower);
}

/** Mark refresh failure without deleting events or rolling back last_scanned_block. */
export function markWalletCacheRefreshFailed(
  addressLower: string,
  error: string,
  nowMs: number = Date.now(),
): void {
  const db = openDatabase();
  db.prepare(
    `UPDATE wallet_cache
     SET last_error = ?, updated_at = ?
     WHERE address = ? AND status = 'complete'`,
  ).run(error.slice(0, 500), nowMs, addressLower);
}

export function clearWalletCacheRefreshError(
  addressLower: string,
  nowMs: number = Date.now(),
): void {
  const db = openDatabase();
  db.prepare(
    `UPDATE wallet_cache
     SET last_error = NULL, updated_at = ?
     WHERE address = ?`,
  ).run(nowMs, addressLower);
}

export function getCachedWalletEvents(
  addressLower: string,
): OnChainContribution[] {
  const db = openDatabase();
  const rows = db
    .prepare(
      `SELECT data_id, task_id, score, simulation_time,
              block_number, transaction_hash, log_index, timestamp
       FROM wallet_events
       WHERE address = ?
       ORDER BY block_number ASC, log_index ASC`,
    )
    .all(addressLower) as Array<{
    data_id: string;
    task_id: string;
    score: number;
    simulation_time: number;
    block_number: number;
    transaction_hash: string;
    log_index: number;
    timestamp: number | null;
  }>;

  return rows.map((r) => ({
    dataId: r.data_id,
    taskId: r.task_id,
    user: addressLower as `0x${string}`,
    score: r.score,
    simulationTime: r.simulation_time,
    blockNumber: r.block_number,
    transactionHash: r.transaction_hash as `0x${string}`,
    logIndex: r.log_index,
    timestamp: r.timestamp,
  }));
}

export function countCachedWalletEvents(addressLower: string): number {
  const db = openDatabase();
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM wallet_events WHERE address = ?`)
    .get(addressLower) as { c: number };
  return row.c;
}

export function countWalletEventsMissingTimestamps(
  addressLower: string,
): number {
  const db = openDatabase();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM wallet_events
       WHERE address = ? AND timestamp IS NULL`,
    )
    .get(addressLower) as { c: number };
  return row.c;
}

/** Distinct block numbers that still need timestamp enrichment for a wallet. */
export function listDistinctBlocksMissingTimestamps(
  addressLower: string,
): number[] {
  const db = openDatabase();
  const rows = db
    .prepare(
      `SELECT DISTINCT block_number AS block_number
       FROM wallet_events
       WHERE address = ? AND timestamp IS NULL
       ORDER BY block_number ASC`,
    )
    .all(addressLower) as Array<{ block_number: number }>;
  return rows.map((r) => r.block_number);
}

/**
 * Apply a resolved block timestamp to all matching null-timestamp wallet events.
 * Returns number of rows updated.
 */
export function applyBlockTimestampToWalletEvents(
  blockNumber: number,
  timestamp: number,
  addressLower?: string,
): number {
  const db = openDatabase();
  if (addressLower) {
    const info = db
      .prepare(
        `UPDATE wallet_events
         SET timestamp = ?
         WHERE address = ? AND block_number = ? AND timestamp IS NULL`,
      )
      .run(timestamp, addressLower, blockNumber);
    return info.changes;
  }
  const info = db
    .prepare(
      `UPDATE wallet_events
       SET timestamp = ?
       WHERE block_number = ? AND timestamp IS NULL`,
    )
    .run(timestamp, blockNumber);
  return info.changes;
}

/**
 * Look up one cached wallet event by tx hash (for verification scripts).
 */
export function getWalletEventByTx(
  addressLower: string,
  transactionHash: string,
): {
  blockNumber: number;
  timestamp: number | null;
  taskId: string;
  score: number;
  dataId: string;
} | null {
  const db = openDatabase();
  const row = db
    .prepare(
      `SELECT block_number, timestamp, task_id, score, data_id
       FROM wallet_events
       WHERE address = ? AND lower(transaction_hash) = lower(?)
       LIMIT 1`,
    )
    .get(addressLower, transactionHash) as
    | {
        block_number: number;
        timestamp: number | null;
        task_id: string;
        score: number;
        data_id: string;
      }
    | undefined;
  if (!row) return null;
  return {
    blockNumber: row.block_number,
    timestamp: row.timestamp,
    taskId: row.task_id,
    score: row.score,
    dataId: row.data_id,
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

export function getHubWalletCache(
  addressLower: string,
): HubWalletCacheRow | null {
  const db = openDatabase();
  const row = db
    .prepare(
      `SELECT address, total_attempts, status, last_completed_page, total_pages,
              per_page, created_at, updated_at, last_error
       FROM hub_wallet_cache WHERE address = ?`,
    )
    .get(addressLower) as
    | {
        address: string;
        total_attempts: number;
        status: string;
        last_completed_page: number;
        total_pages: number;
        per_page: number;
        created_at: number;
        updated_at: number;
        last_error: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    address: row.address,
    totalAttempts: row.total_attempts,
    status: row.status === "complete" ? "complete" : "incomplete",
    lastCompletedPage: row.last_completed_page,
    totalPages: row.total_pages,
    perPage: row.per_page,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
  };
}

export function countHubAttempts(addressLower: string): number {
  const db = openDatabase();
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM hub_attempts WHERE address = ?`)
    .get(addressLower) as { c: number };
  return row.c;
}

export function getCachedHubAttempts(
  addressLower: string,
): HubAttemptRecord[] {
  const db = openDatabase();
  const rows = db
    .prepare(
      `SELECT attempt_id, task_id, task_name, score, completed_at, created_at,
              simulation_time_seconds, txhash, theme, user_id, username,
              operator_short, quality_rating, model_id, data_id, chain_task_id,
              chain_score, chain_id, simulation_time, contract_address,
              server_signature, chain_data_json, raw_json
       FROM hub_attempts
       WHERE address = ?
       ORDER BY attempt_id DESC`,
    )
    .all(addressLower) as Array<{
    attempt_id: number;
    task_id: string;
    task_name: string | null;
    score: number | null;
    completed_at: string | null;
    created_at: string | null;
    simulation_time_seconds: number | null;
    txhash: string | null;
    theme: string | null;
    user_id: number | null;
    username: string | null;
    operator_short: string | null;
    quality_rating: string | null;
    model_id: string | null;
    data_id: string | null;
    chain_task_id: string | null;
    chain_score: number | null;
    chain_id: number | null;
    simulation_time: number | null;
    contract_address: string | null;
    server_signature: string | null;
    chain_data_json: string | null;
    raw_json: string | null;
  }>;

  return rows.map((r) => ({
    attemptId: r.attempt_id,
    taskId: r.task_id,
    taskName: r.task_name,
    score: r.score,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    simulationTimeSeconds: r.simulation_time_seconds,
    txhash: r.txhash,
    theme: r.theme,
    userId: r.user_id,
    username: r.username,
    operatorShort: r.operator_short,
    qualityRating: r.quality_rating,
    modelId: r.model_id,
    dataId: r.data_id,
    chainTaskId: r.chain_task_id,
    chainScore: r.chain_score,
    chainId: r.chain_id,
    simulationTime: r.simulation_time,
    contractAddress: r.contract_address,
    serverSignature: r.server_signature,
    chainDataJson: r.chain_data_json,
    rawJson: r.raw_json,
  }));
}

export function getKnownHubAttemptIds(addressLower: string): Set<number> {
  const db = openDatabase();
  const rows = db
    .prepare(`SELECT attempt_id FROM hub_attempts WHERE address = ?`)
    .all(addressLower) as Array<{ attempt_id: number }>;
  return new Set(rows.map((r) => r.attempt_id));
}

export function upsertHubAttempts(
  addressLower: string,
  records: HubAttemptRecord[],
): number {
  if (records.length === 0) return 0;
  const db = openDatabase();
  const stmt = db.prepare(
    `INSERT INTO hub_attempts (
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
      raw_json = excluded.raw_json`,
  );

  let touched = 0;
  const tx = db.transaction((rows: HubAttemptRecord[]) => {
    for (const r of rows) {
      const info = stmt.run(
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
      );
      if (info.changes > 0) touched += 1;
    }
  });
  tx(records);
  return touched;
}

/**
 * Persist Hub page progress. Never marks complete unless explicitly requested.
 */
export function persistHubPageProgress(
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
): void {
  const nowMs = opts.nowMs ?? Date.now();
  const db = openDatabase();
  const eventStmt = db.prepare(
    `INSERT INTO hub_attempts (
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
      raw_json = excluded.raw_json`,
  );
  const cacheStmt = db.prepare(
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
  );

  const tx = db.transaction(() => {
    for (const r of opts.records) {
      eventStmt.run(
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
      );
    }
    const touchError = opts.lastError !== undefined ? 1 : 0;
    cacheStmt.run(
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
    );
  });
  tx();
}

export function touchHubWalletCacheFreshness(
  addressLower: string,
  nowMs: number = Date.now(),
): void {
  const db = openDatabase();
  db.prepare(
    `UPDATE hub_wallet_cache
     SET updated_at = ?, last_error = NULL
     WHERE address = ?`,
  ).run(nowMs, addressLower);
}

export function markHubWalletCacheError(
  addressLower: string,
  error: string,
  nowMs: number = Date.now(),
): void {
  const db = openDatabase();
  db.prepare(
    `UPDATE hub_wallet_cache
     SET last_error = ?, updated_at = ?
     WHERE address = ?`,
  ).run(error.slice(0, 500), nowMs, addressLower);
}

/**
 * Drop all cached Hub attempts for one wallet so history can be rebuilt
 * from the live Hub total (Hub history is not strictly append-only).
 */
export function clearHubAttemptsForAddress(
  addressLower: string,
  nowMs: number = Date.now(),
): void {
  const db = openDatabase();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM hub_attempts WHERE address = ?`).run(addressLower);
    db.prepare(
      `UPDATE hub_wallet_cache
       SET status = 'incomplete',
           last_completed_page = 0,
           last_error = NULL,
           updated_at = ?
       WHERE address = ?`,
    ).run(nowMs, addressLower);
  });
  tx();
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
