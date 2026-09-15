/**
 * Server-only libSQL / Turso client.
 *
 * Production: requires TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN for remote).
 * Local/test: TURSO_* if set, else file SQLite via AXIS_INDEX_DB_PATH or
 * data/axis-index.db — never as a silent production fallback.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

declare global {
  var __axisLibsqlClient: Client | undefined;
  var __axisLibsqlSchemaReady: Promise<void> | undefined;
  var __axisLibsqlResolvedUrl: string | undefined;
  var __axisLibsqlSchemaClient: Client | undefined;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function defaultLocalDbFile(): string {
  const override = process.env.AXIS_INDEX_DB_PATH?.trim();
  if (override) return path.resolve(override);
  return path.join(process.cwd(), "data", "axis-index.db");
}

export function getResolvedDbTarget(): {
  url: string;
  authToken?: string;
  mode: "turso" | "file";
} {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || undefined;

  if (tursoUrl) {
    if (
      tursoUrl === ":memory:" ||
      tursoUrl.startsWith("file:") ||
      tursoUrl.startsWith("libsql:") ||
      tursoUrl.startsWith("https:")
    ) {
      if (tursoUrl === ":memory:" || tursoUrl.startsWith("file:")) {
        return { url: tursoUrl, mode: "file" };
      }
      return { url: tursoUrl, authToken, mode: "turso" };
    }
    return { url: tursoUrl, authToken, mode: "turso" };
  }

  if (isProduction()) {
    throw new DatabaseConfigError(
      "Production requires TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for remote Turso). Local SQLite fallback is disabled in production.",
    );
  }

  const filePath = defaultLocalDbFile();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // libSQL file URL — absolute path with forward slashes
  const normalized = filePath.replace(/\\/g, "/");
  const url = normalized.startsWith("/")
    ? `file:${normalized}`
    : `file:/${normalized}`;
  return { url, mode: "file" };
}

/** Diagnostic path/URL — never includes auth token. */
export function getDbPath(): string {
  try {
    const t = getResolvedDbTarget();
    return t.url;
  } catch {
    return "(unconfigured)";
  }
}

export function isRemoteTursoConfigured(): boolean {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (!url) return false;
  if (url === ":memory:" || url.startsWith("file:")) return false;
  return true;
}

export function getClient(): Client {
  const existing = globalThis.__axisLibsqlClient;
  if (existing && !existing.closed) {
    return existing;
  }
  if (existing?.closed) {
    globalThis.__axisLibsqlClient = undefined;
    globalThis.__axisLibsqlSchemaReady = undefined;
    globalThis.__axisLibsqlSchemaClient = undefined;
    globalThis.__axisLibsqlResolvedUrl = undefined;
  }

  const target = getResolvedDbTarget();
  const client = createClient({
    url: target.url,
    authToken: target.authToken,
  });

  globalThis.__axisLibsqlClient = client;
  globalThis.__axisLibsqlResolvedUrl = target.url;
  globalThis.__axisLibsqlSchemaReady = undefined;
  globalThis.__axisLibsqlSchemaClient = undefined;
  return client;
}

export async function closeDatabase(): Promise<void> {
  const client = globalThis.__axisLibsqlClient;
  globalThis.__axisLibsqlClient = undefined;
  globalThis.__axisLibsqlSchemaReady = undefined;
  globalThis.__axisLibsqlSchemaClient = undefined;
  globalThis.__axisLibsqlResolvedUrl = undefined;
  if (client) {
    try {
      client.close();
    } catch {
      // ignore
    }
  }
}

const SCHEMA_SQL = `
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
`;

async function ensureWalletCacheMigrations(client: Client): Promise<void> {
  const cols = await client.execute(`PRAGMA table_info(wallet_cache)`);
  const names = new Set(
    cols.rows.map((r) => String(r.name ?? r[1] ?? "")),
  );
  if (!names.has("target_block")) {
    await client.execute(
      `ALTER TABLE wallet_cache ADD COLUMN target_block INTEGER`,
    );
  }

  try {
    await client.execute(`
      CREATE INDEX IF NOT EXISTS idx_wallet_events_missing_timestamp
        ON wallet_events (address, block_number)
        WHERE timestamp IS NULL
    `);
  } catch {
    // Partial indexes may be unavailable on some backends — non-fatal.
  }
}

/**
 * Older DBs may have score as REAL NOT NULL. Rebuild so null Hub scores persist.
 * Non-destructive for rows; only runs when needed.
 */
async function ensureHubAttemptsScoreNullable(client: Client): Promise<void> {
  const cols = await client.execute(`PRAGMA table_info(hub_attempts)`);
  if (cols.rows.length === 0) return;

  const scoreCol = cols.rows.find((r) => {
    const name = String(r.name ?? r[1] ?? "");
    return name === "score";
  });
  if (!scoreCol) return;

  const notnull = Number(scoreCol.notnull ?? scoreCol[3] ?? 0);
  if (notnull === 0) return;

  await client.batch(
    [
      `CREATE TABLE hub_attempts_score_nullable (
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
    )`,
      `INSERT INTO hub_attempts_score_nullable SELECT * FROM hub_attempts`,
      `DROP TABLE hub_attempts`,
      `ALTER TABLE hub_attempts_score_nullable RENAME TO hub_attempts`,
      `CREATE INDEX IF NOT EXISTS idx_hub_attempts_address ON hub_attempts (address)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_attempts_attempt_id ON hub_attempts (attempt_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_attempts_task_id ON hub_attempts (address, task_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_attempts_completed_at ON hub_attempts (address, completed_at)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_attempts_txhash ON hub_attempts (address, txhash)`,
    ],
    "write",
  );
}

export async function ensureSchema(): Promise<Client> {
  const client = getClient();
  if (globalThis.__axisLibsqlSchemaClient !== client) {
    globalThis.__axisLibsqlSchemaReady = undefined;
    globalThis.__axisLibsqlSchemaClient = client;
  }
  if (!globalThis.__axisLibsqlSchemaReady) {
    const initFor = client;
    globalThis.__axisLibsqlSchemaReady = (async () => {
      const statements = SCHEMA_SQL.split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await initFor.batch(statements, "write");
      await ensureWalletCacheMigrations(initFor);
      await ensureHubAttemptsScoreNullable(initFor);
    })().catch((err) => {
      if (globalThis.__axisLibsqlSchemaClient === initFor) {
        globalThis.__axisLibsqlSchemaReady = undefined;
        globalThis.__axisLibsqlSchemaClient = undefined;
      }
      throw err;
    });
  }
  try {
    await globalThis.__axisLibsqlSchemaReady;
  } catch (err) {
    // Init may fail if the client was closed mid-flight — retry on a fresh client.
    if (
      err instanceof Error &&
      /CLIENT_CLOSED|closed/i.test(err.message)
    ) {
      if (globalThis.__axisLibsqlClient === client) {
        globalThis.__axisLibsqlClient = undefined;
      }
      globalThis.__axisLibsqlSchemaReady = undefined;
      globalThis.__axisLibsqlSchemaClient = undefined;
      return ensureSchema();
    }
    throw err;
  }

  const live = getClient();
  if (live !== client) {
    return ensureSchema();
  }
  return live;
}

/** Alias used by tests/scripts — initializes schema. */
export async function openDatabase(): Promise<Client> {
  return ensureSchema();
}
