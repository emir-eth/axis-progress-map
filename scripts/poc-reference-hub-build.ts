/**
 * Limited live Hub build for the reference wallet only.
 * Max 3 minutes, max 20 Hub HTTP requests. No Base scan. No fixture fallback.
 */
import {
  closeDatabase,
  countHubAttempts,
  getHubWalletCache,
  openDatabase,
} from "../src/lib/db";
import {
  countHubTxhashStats,
  ensureHubAttemptHistory,
} from "../src/lib/hub-attempts";
import { REFERENCE_WALLET } from "../src/lib/fixtures/reference-wallet";

const MAX_MS = 3 * 60_000;
const MAX_HTTP = 20;

async function main() {
  // Use the project DB so progress is preserved for the real app.
  closeDatabase();
  openDatabase();

  const addr = REFERENCE_WALLET.toLowerCase();
  const before = getHubWalletCache(addr);
  console.log(
    JSON.stringify(
      {
        phase: "before",
        cache: before,
        fetched: countHubAttempts(addr),
      },
      null,
      2,
    ),
  );

  const started = Date.now();
  let http = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    http += 1;
    if (http > MAX_HTTP) throw new Error(`HTTP limit ${MAX_HTTP}`);
    if (Date.now() - started > MAX_MS) throw new Error("time limit");
    return fetch(input, { ...init, credentials: "omit" });
  };

  const result = await ensureHubAttemptHistory(REFERENCE_WALLET, {
    deadlineMs: started + MAX_MS,
    fetchImpl,
    now: () => Date.now(),
    maxAgeMs: 0,
  });

  const after = getHubWalletCache(addr);
  const fetched = countHubAttempts(addr);
  const stats =
    after?.status === "complete" ? countHubTxhashStats(addr) : null;

  console.log(
    JSON.stringify(
      {
        phase: "after",
        publicHubTotal: result.totalAttempts,
        fetchedRows: fetched,
        cacheStatus: after?.status ?? null,
        lastCompletedPage: after?.lastCompletedPage ?? null,
        totalPages: after?.totalPages ?? null,
        trajectoryCount: stats?.trajectoryCount ?? null,
        unsignedAttempts: stats?.unsignedAttemptCount ?? null,
        hubAttempts: stats?.hubAttemptCount ?? null,
        http,
        runtimeMs: Date.now() - started,
        warnings: result.warnings,
        rateLimited: result.rateLimited,
        dataSourceWouldBe:
          after?.status === "complete" ? "hub-cache" : "hub-incomplete",
      },
      null,
      2,
    ),
  );

  closeDatabase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
