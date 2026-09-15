/**
 * Repair Hub caches stuck incomplete when unique rows already match total.
 * Does not clear caches. Does not run Base scans.
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

const TARGETS = [
  "0x612cdfef8db47eea34b036b895fe5a6f477616d5",
  "0x0d1a77989c204468173ff4e37d1ce95f46e0d81e",
] as const;

async function main() {
  openDatabase();
  for (const wallet of TARGETS) {
    const before = getHubWalletCache(wallet);
    const beforeCount = countHubAttempts(wallet);
    console.log(
      "BEFORE",
      wallet.slice(0, 10),
      JSON.stringify({
        status: before?.status,
        total: before?.totalAttempts,
        cached: beforeCount,
        page: `${before?.lastCompletedPage}/${before?.totalPages}`,
      }),
    );

    const result = await ensureHubAttemptHistory(
      wallet as `0x${string}`,
      {
        deadlineMs: Date.now() + 30_000,
        maxAgeMs: 60_000,
      },
    );
    const stats = countHubTxhashStats(wallet);
    console.log(
      "AFTER",
      wallet.slice(0, 10),
      JSON.stringify({
        resultStatus: result.status,
        http: result.httpRequests,
        total: result.totalAttempts,
        fetched: result.fetchedAttempts,
        cache: getHubWalletCache(wallet)?.status,
        signed: stats.trajectoryCount,
        unsigned: stats.unsignedAttemptCount,
        warnings: result.warnings,
      }),
    );
  }

  const ref = REFERENCE_WALLET.toLowerCase();
  const refCache = getHubWalletCache(ref);
  const refStats = countHubTxhashStats(ref);
  console.log(
    "REFERENCE",
    JSON.stringify({
      status: refCache?.status,
      total: refCache?.totalAttempts,
      cached: countHubAttempts(ref),
      signed: refStats.trajectoryCount,
      unsigned: refStats.unsignedAttemptCount,
    }),
  );
  closeDatabase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
