/**
 * Safe one-page Hub resume test — uses existing checkpoint only.
 * Limits: 3 HTTP, 30s, concurrency 1, max 1 retry (inside fetchHubAttemptsPage).
 */
import {
  closeDatabase,
  countHubAttempts,
  getHubWalletCache,
  openDatabase,
  persistHubPageProgress,
} from "../src/lib/db";
import {
  fetchHubAttemptsPage,
  parseHubAttemptItem,
  HUB_PER_PAGE,
} from "../src/lib/hub-attempts";

const WALLET = "0xe8317b584e834de42a07223d5d6e3b20cfa3374a";
const MAX_HTTP = 3;
const MAX_MS = 30_000;

async function main() {
  openDatabase();
  const before = getHubWalletCache(WALLET);
  if (!before) {
    console.log(JSON.stringify({ error: "no cache row" }));
    process.exit(1);
  }
  const fetchedBefore = countHubAttempts(WALLET);
  console.log(
    JSON.stringify(
      {
        phase: "before",
        address: before.address,
        status: before.status,
        totalAttempts: before.totalAttempts,
        fetchedBefore,
        lastCompletedPage: before.lastCompletedPage,
        totalPages: before.totalPages,
        perPage: before.perPage,
        lastError: before.lastError,
        updatedAt: new Date(before.updatedAt).toISOString(),
      },
      null,
      2,
    ),
  );

  const nextPage = before.lastCompletedPage + 1;
  if (before.status === "complete" || nextPage > before.totalPages) {
    console.log(
      JSON.stringify({ phase: "skip", reason: "complete or no next page" }),
    );
    closeDatabase();
    return;
  }

  const start = Date.now();
  let http = 0;
  const wrapFetch: typeof fetch = async (input, init) => {
    http += 1;
    if (http > MAX_HTTP) throw new Error("HTTP limit");
    if (Date.now() - start > MAX_MS) throw new Error("time limit");
    const t0 = Date.now();
    const res = await fetch(input, { ...init, credentials: "omit" });
    console.log(
      JSON.stringify({
        phase: "http",
        n: http,
        status: res.status,
        ms: Date.now() - t0,
      }),
    );
    return res;
  };

  console.log(
    JSON.stringify({
      phase: "request",
      nextPage,
      totalPages: before.totalPages,
    }),
  );

  const result = await fetchHubAttemptsPage(WALLET, nextPage, {
    fetchImpl: wrapFetch,
    timeoutMs: 12_000,
  });

  if (!result.ok) {
    console.log(
      JSON.stringify(
        {
          phase: "fail",
          error: result.error,
          httpStatus: result.httpStatus,
          rateLimited: result.rateLimited,
          http,
          runtimeMs: Date.now() - start,
          fetchedUnchanged: countHubAttempts(WALLET),
        },
        null,
        2,
      ),
    );
    closeDatabase();
    return;
  }

  const records = [];
  const seen = new Set<number>();
  for (const item of result.page.items) {
    const parsed = parseHubAttemptItem(item);
    if (!parsed || seen.has(parsed.attemptId)) continue;
    seen.add(parsed.attemptId);
    records.push(parsed);
  }

  const done = nextPage >= result.page.total_pages;
  persistHubPageProgress(WALLET, {
    records,
    totalAttempts: result.page.total,
    totalPages: result.page.total_pages,
    lastCompletedPage: nextPage,
    perPage: HUB_PER_PAGE,
    status: done ? "complete" : "incomplete",
    nowMs: Date.now(),
  });

  const after = getHubWalletCache(WALLET)!;
  const fetchedAfter = countHubAttempts(WALLET);
  console.log(
    JSON.stringify(
      {
        phase: "after",
        nextPage,
        pageItemCount: result.page.items.length,
        uniqueParsed: records.length,
        liveTotal: result.page.total,
        liveTotalPages: result.page.total_pages,
        fetchedBefore,
        fetchedAfter,
        advanced: fetchedAfter > fetchedBefore,
        lastCompletedPage: after.lastCompletedPage,
        status: after.status,
        http,
        runtimeMs: Date.now() - start,
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
