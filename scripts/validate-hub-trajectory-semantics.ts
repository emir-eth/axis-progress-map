/**
 * Report Hub trajectory semantics from existing SQLite caches (read-only).
 * Does not refetch Hub history.
 */
import Database from "better-sqlite3";
import path from "node:path";
import {
  closeDatabase,
  countHubAttempts,
  getCachedHubAttempts,
  getHubWalletCache,
  openDatabase,
} from "../src/lib/db";
import { computeHubSemanticCounts } from "../src/lib/hub-semantics";

openDatabase();

const db = new Database(path.join(process.cwd(), "data", "axis-index.db"), {
  readonly: true,
});

const caches = db
  .prepare(
    `SELECT address, status, total_attempts
     FROM hub_wallet_cache ORDER BY updated_at DESC`,
  )
  .all() as Array<{
  address: string;
  status: string;
  total_attempts: number;
}>;

const out = [];
for (const row of caches) {
  const stored = countHubAttempts(row.address);
  const attempts = getCachedHubAttempts(row.address);
  const semantics = computeHubSemanticCounts(attempts);
  const cache = getHubWalletCache(row.address);
  out.push({
    address: row.address,
    status: cache?.status ?? row.status,
    apiTotal: row.total_attempts,
    storedRows: stored,
    hubAttempts: semantics.hubAttemptCount,
    trajectories: semantics.trajectoryCount,
    unsigned: semantics.unsignedAttemptCount,
    invariantOk:
      semantics.hubAttemptCount ===
      semantics.trajectoryCount + semantics.unsignedAttemptCount,
  });
}
console.log(JSON.stringify(out, null, 2));
db.close();
closeDatabase();
