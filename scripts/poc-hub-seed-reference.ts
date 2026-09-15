/**
 * LIMITED live Hub cache POC for the reference wallet.
 * Hard limits: max 2 min, max 15 Hub requests, no auth, sequential pages,
 * no Base scan. Preserves resumable progress on stop.
 *
 * Usage: npx tsx scripts/poc-hub-seed-reference.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, openDatabase, getHubWalletCache, countHubAttempts } from "../src/lib/db";
import { ensureHubAttemptHistory } from "../src/lib/hub-attempts";
import { REFERENCE_WALLET } from "../src/lib/fixtures/reference-wallet";

const MAX_MS = 120_000;
const MAX_HTTP = 15;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-hub-poc-"));
  const dbPath = path.join(dir, "poc.db");
  process.env.AXIS_INDEX_DB_PATH = dbPath;
  closeDatabase();
  openDatabase();

  const started = Date.now();
  let http = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    http += 1;
    if (http > MAX_HTTP) {
      throw new Error(`HTTP limit ${MAX_HTTP} exceeded`);
    }
    return fetch(input, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
      // no cookies / auth
      credentials: "omit",
    });
  };

  let result;
  try {
    result = await ensureHubAttemptHistory(REFERENCE_WALLET, {
      deadlineMs: started + MAX_MS,
      fetchImpl,
      now: () => Date.now(),
      maxAgeMs: 0,
      forceFreshnessCheck: false,
    });
  } catch (err) {
    const cache = getHubWalletCache(REFERENCE_WALLET.toLowerCase());
    console.log(
      JSON.stringify(
        {
          error: err instanceof Error ? err.message : String(err),
          liveTotal: cache?.totalAttempts ?? null,
          rowsFetched: countHubAttempts(REFERENCE_WALLET.toLowerCase()),
          cacheStatus: cache?.status ?? null,
          requests: http,
          runtimeMs: Date.now() - started,
        },
        null,
        2,
      ),
    );
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }

  const report = {
    wallet: REFERENCE_WALLET,
    liveTotal: result.totalAttempts,
    rowsFetched: result.fetchedAttempts,
    cacheStatus: result.status,
    lastCompletedPage: result.lastCompletedPage,
    totalPages: result.totalPages,
    requests: http,
    runtimeMs: Date.now() - started,
    rateLimited: result.rateLimited,
    errors: result.warnings,
    dbPath,
  };
  console.log(JSON.stringify(report, null, 2));

  closeDatabase();
  // Keep POC db path printed; delete temp dir after
  fs.rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
