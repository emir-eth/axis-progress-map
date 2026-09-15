/**
 * Bounded repair for reference wallet Hub cache (null-score row + reconcile).
 * Does NOT clear caches. Does NOT run Base scans.
 */
import {
  closeDatabase,
  countHubAttempts,
  getCachedHubAttempts,
  getHubWalletCache,
  openDatabase,
} from "../src/lib/db";
import {
  countHubTxhashStats,
  ensureHubAttemptHistory,
  normalizeHubTxhash,
} from "../src/lib/hub-attempts";
import { REFERENCE_WALLET } from "../src/lib/fixtures/reference-wallet";

async function main() {
  openDatabase();
  const addr = REFERENCE_WALLET.toLowerCase();
  const before = getHubWalletCache(addr);
  console.log(
    "before",
    JSON.stringify({
      status: before?.status,
      total: before?.totalAttempts,
      cached: countHubAttempts(addr),
    }),
  );

  const result = await ensureHubAttemptHistory(REFERENCE_WALLET, {
    deadlineMs: Date.now() + 120_000,
    maxAgeMs: 0,
    forceFreshnessCheck: true,
  });

  const stats = countHubTxhashStats(addr);
  const nullScore = getCachedHubAttempts(addr).filter((r) => r.score == null);
  const signed = getCachedHubAttempts(addr).filter((r) =>
    normalizeHubTxhash(r.txhash),
  ).length;

  console.log(
    JSON.stringify(
      {
        result: {
          status: result.status,
          totalAttempts: result.totalAttempts,
          fetchedAttempts: result.fetchedAttempts,
          httpRequests: result.httpRequests,
          warnings: result.warnings,
        },
        cached: countHubAttempts(addr),
        signed,
        unsigned: stats.unsignedAttemptCount,
        nullScoreRows: nullScore.length,
        nullScoreIds: nullScore.map((r) => r.attemptId),
        cache: getHubWalletCache(addr),
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
