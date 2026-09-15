/**
 * Read-only: list incomplete Hub caches near 1862/1869 totals.
 */
import {
  closeDatabase,
  countHubAttempts,
  getHubWalletCache,
  openDatabase,
} from "../src/lib/db";
import Database from "better-sqlite3";
import path from "node:path";

openDatabase();
const db = new Database(path.join(process.cwd(), "data", "axis-index.db"), {
  readonly: true,
});

const rows = db
  .prepare(
    `SELECT address, total_attempts, status, last_completed_page, total_pages,
            updated_at, last_error
     FROM hub_wallet_cache
     WHERE status = 'incomplete'
        OR ABS(total_attempts - 1862) < 5
        OR ABS(total_attempts - 1869) < 5
     ORDER BY updated_at DESC`,
  )
  .all() as Array<{
  address: string;
  total_attempts: number;
  status: string;
  last_completed_page: number;
  total_pages: number;
  updated_at: number;
  last_error: string | null;
}>;

const out = rows.map((r) => {
  const cached = countHubAttempts(r.address);
  return {
    address: r.address,
    total_attempts: r.total_attempts,
    cached,
    missing: r.total_attempts - cached,
    last_completed_page: r.last_completed_page,
    total_pages: r.total_pages,
    status: r.status,
    updated_at: r.updated_at,
    updated_iso: new Date(r.updated_at).toISOString(),
    last_error: r.last_error,
  };
});

console.log(JSON.stringify(out, null, 2));
db.close();
closeDatabase();
