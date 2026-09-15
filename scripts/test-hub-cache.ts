/**
 * Hub-first cache / profile tests (mocked Hub HTTP — no live Hub, no Base scan).
 *
 * Usage: npm run test:hub-cache
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDatabase,
  countHubAttempts,
  getCachedHubAttempts,
  getHubWalletCache,
  openDatabase,
  persistHubPageProgress,
  saveCompleteWalletCache,
} from "../src/lib/db";
import { loadProfileData } from "../src/lib/profile-data";
import {
  normalizeHubTxhash,
  parseHubAttemptItem,
} from "../src/lib/hub-attempts";
import { REFERENCE_WALLET } from "../src/lib/fixtures/reference-wallet";
import type { IndexStatus } from "../src/types";

const WALLET_A =
  "0x1111111111111111111111111111111111111111" as const;
const WALLET_B =
  "0x2222222222222222222222222222222222222222" as const;

function isShareAllowedLike(status: IndexStatus): boolean {
  if (status.scanStatus === "incomplete") return false;
  if (status.dataSource === "scan-incomplete") return false;
  if (status.dataSource === "hub-incomplete") return false;
  return true;
}

function setupTempDb(): string {
  closeDatabase();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-hub-cache-"));
  const dbPath = path.join(dir, "test.db");
  process.env.AXIS_INDEX_DB_PATH = dbPath;
  openDatabase();
  return dir;
}

function teardownTempDb(dir: string) {
  closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.AXIS_INDEX_DB_PATH;
  delete process.env.AXIS_USE_DEV_FIXTURE;
}

function makeItem(opts: {
  attempt_id: number;
  task_id?: number;
  score?: number | null;
  completed_at?: string;
  txhash?: string | null;
  theme?: string;
  task_name?: string;
}) {
  return {
    attempt_id: opts.attempt_id,
    task_id: opts.task_id ?? 1000 + (opts.attempt_id % 50),
    task_name: opts.task_name ?? `Task ${opts.attempt_id}`,
    theme: opts.theme ?? "office",
    score: opts.score === undefined ? 70 + (opts.attempt_id % 20) : opts.score,
    completed_at:
      opts.completed_at ??
      `2026-09-0${1 + (opts.attempt_id % 9)}T12:00:00.000Z`,
    txhash: opts.txhash === undefined ? "ab".repeat(32) : opts.txhash,
    chain_data: {
      data_id: opts.attempt_id,
      task_id: opts.task_id ?? 1000,
      score: Math.floor(opts.score ?? 70),
      chain_id: 8453,
      simulation_time: 12000,
    },
  };
}

function pageResponse(opts: {
  page: number;
  total: number;
  per_page?: number;
  items: ReturnType<typeof makeItem>[];
}) {
  const per = opts.per_page ?? 100;
  const total_pages = Math.max(1, Math.ceil(opts.total / per));
  return {
    items: opts.items,
    total: opts.total,
    page: opts.page,
    per_page: per,
    total_pages,
    next_cursor: null,
  };
}

function makeFetch(
  pages: Map<number, unknown>,
  opts?: {
    failPages?: Map<number, number>;
    failOnce?: Map<number, number>;
  },
) {
  const failOnceLeft = new Map(opts?.failOnce ?? []);
  let calls = 0;
  const fetchImpl = async (url: string): Promise<Response> => {
    calls += 1;
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") ?? "1");
    if (opts?.failPages?.has(page)) {
      const status = opts.failPages.get(page)!;
      return new Response(JSON.stringify({ error: "fail" }), { status });
    }
    if (failOnceLeft.has(page)) {
      const status = failOnceLeft.get(page)!;
      failOnceLeft.delete(page);
      return new Response(JSON.stringify({ error: "temp" }), { status });
    }
    const body = pages.get(page);
    if (!body) {
      return new Response(JSON.stringify({ error: "missing" }), {
        status: 404,
      });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, getCalls: () => calls };
}

async function run() {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    const dir = setupTempDb();
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    try {
      await fn();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL  ${name}`);
      console.error(err);
    } finally {
      teardownTempDb(dir);
    }
  }

  await test("1. uncached wallet page 1", async () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      makeItem({ attempt_id: 1000 - i }),
    );
    const { fetchImpl } = makeFetch(
      new Map([[1, pageResponse({ page: 1, total: 250, items })]]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
      hubFetchBudgetMs: 30_000,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.scanStatus, "incomplete");
    assert.equal(result.profile.hubStatus?.lastCompletedPage, 1);
    assert.equal(result.profile.hubStatus?.totalAttempts, 250);
    assert.equal(countHubAttempts(WALLET_A.toLowerCase()), 100);
    assert.equal(result.profile.contributions.length, 0);
  });

  await test("2. resumable Hub pages", async () => {
    persistHubPageProgress(WALLET_A.toLowerCase(), {
      records: Array.from({ length: 100 }, (_, i) =>
        parseHubAttemptItem(makeItem({ attempt_id: 2000 - i }))!,
      ),
      totalAttempts: 150,
      totalPages: 2,
      lastCompletedPage: 1,
      perPage: 100,
      status: "incomplete",
    });
    const page2Items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ attempt_id: 1900 - i }),
    );
    const { fetchImpl } = makeFetch(
      new Map([[2, pageResponse({ page: 2, total: 150, items: page2Items })]]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
      hubFetchBudgetMs: 30_000,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.scanStatus, "complete");
    assert.equal(result.profile.hubStatus?.lastCompletedPage, 2);
    assert.equal(countHubAttempts(WALLET_A.toLowerCase()), 150);
  });

  await test("3. cache completes", async () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({ attempt_id: 300 + i }),
    );
    const { fetchImpl } = makeFetch(
      new Map([[1, pageResponse({ page: 1, total: 3, items })]]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.scanStatus, "complete");
    assert.equal(getHubWalletCache(WALLET_A.toLowerCase())?.status, "complete");
    assert.equal(result.profile.analytics.summary.onChainContributions, 3);
  });

  await test("4. complete cache returns instantly", async () => {
    persistHubPageProgress(WALLET_A.toLowerCase(), {
      records: [parseHubAttemptItem(makeItem({ attempt_id: 1 }))!],
      totalAttempts: 1,
      totalPages: 1,
      lastCompletedPage: 1,
      perPage: 100,
      status: "complete",
    });
    let calls = 0;
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: async () => {
        calls += 1;
        throw new Error("should not fetch when fresh");
      },
      skipMetadata: true,
      hubCacheMaxAgeMs: 60_000,
      now: () => Date.now(),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(calls, 0);
    assert.equal(result.profile.indexStatus.dataSource, "hub-cache");
  });

  await test("5. new Hub total causes incremental refresh", async () => {
    const old = parseHubAttemptItem(makeItem({ attempt_id: 10 }))!;
    persistHubPageProgress(WALLET_A.toLowerCase(), {
      records: [old],
      totalAttempts: 1,
      totalPages: 1,
      lastCompletedPage: 1,
      perPage: 100,
      status: "complete",
      nowMs: Date.now() - 10 * 60_000,
    });
    const items = [
      makeItem({ attempt_id: 11 }),
      makeItem({ attempt_id: 10 }),
    ];
    const { fetchImpl, getCalls } = makeFetch(
      new Map([[1, pageResponse({ page: 1, total: 2, items })]]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
      hubCacheMaxAgeMs: 60_000,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(getCalls() >= 1);
    assert.equal(countHubAttempts(WALLET_A.toLowerCase()), 2);
    assert.equal(result.profile.analytics.summary.onChainContributions, 2);
  });

  await test("6. attempt dedup by attempt_id", async () => {
    const dup = makeItem({ attempt_id: 55 });
    const { fetchImpl } = makeFetch(
      new Map([
        [
          1,
          pageResponse({
            page: 1,
            total: 1,
            items: [dup, { ...dup, score: 99 }],
          }),
        ],
      ]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(countHubAttempts(WALLET_A.toLowerCase()), 1);
  });

  await test("7. 500 retry preserves progress", async () => {
    persistHubPageProgress(WALLET_A.toLowerCase(), {
      records: Array.from({ length: 100 }, (_, i) =>
        parseHubAttemptItem(makeItem({ attempt_id: 9000 - i }))!,
      ),
      totalAttempts: 150,
      totalPages: 2,
      lastCompletedPage: 1,
      perPage: 100,
      status: "incomplete",
    });
    const page2Items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ attempt_id: 8900 - i }),
    );
    const { fetchImpl } = makeFetch(
      new Map([[2, pageResponse({ page: 2, total: 150, items: page2Items })]]),
      { failOnce: new Map([[2, 500]]) },
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
      hubFetchBudgetMs: 60_000,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.scanStatus, "complete");
    assert.equal(countHubAttempts(WALLET_A.toLowerCase()), 150);
  });

  await test("8. 429 preserves progress", async () => {
    persistHubPageProgress(WALLET_A.toLowerCase(), {
      records: Array.from({ length: 100 }, (_, i) =>
        parseHubAttemptItem(makeItem({ attempt_id: 8000 - i }))!,
      ),
      totalAttempts: 200,
      totalPages: 2,
      lastCompletedPage: 1,
      perPage: 100,
      status: "incomplete",
    });
    const { fetchImpl } = makeFetch(new Map(), {
      failPages: new Map([[2, 429]]),
    });
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.scanStatus, "incomplete");
    assert.equal(countHubAttempts(WALLET_A.toLowerCase()), 100);
    assert.equal(result.profile.indexStatus.canResume, false);
  });

  await test("9. Hub complete + Base missing → full profile", async () => {
    const items = [makeItem({ attempt_id: 1, score: 88 })];
    const { fetchImpl } = makeFetch(
      new Map([[1, pageResponse({ page: 1, total: 1, items })]]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.scanStatus, "complete");
    assert.equal(result.profile.baseVerification.status, "none");
    assert.equal(result.profile.contributions.length, 1);
    assert.equal(result.profile.analytics.summary.onChainContributions, 1);
  });

  await test("10. Base incomplete does not block Hub profile", async () => {
    const db = openDatabase();
    db.prepare(
      `INSERT INTO wallet_cache (address, last_scanned_block, target_block, status, created_at, updated_at)
       VALUES (?, 1, 100, 'incomplete', ?, ?)`,
    ).run(WALLET_A.toLowerCase(), Date.now(), Date.now());

    const items = [makeItem({ attempt_id: 42 })];
    const { fetchImpl } = makeFetch(
      new Map([[1, pageResponse({ page: 1, total: 1, items })]]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.scanStatus, "complete");
    assert.equal(result.profile.baseVerification.status, "incomplete");
    assert.equal(result.profile.contributions.length, 1);
  });

  await test("11. txhash null displays safely", async () => {
    const items = [makeItem({ attempt_id: 7, txhash: null })];
    const { fetchImpl } = makeFetch(
      new Map([[1, pageResponse({ page: 1, total: 1, items })]]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.contributions[0]?.transactionHash, null);
    assert.equal(result.profile.hubTxhash?.unsignedAttemptCount, 1);
    assert.equal(result.profile.hubTxhash?.trajectoryCount, 0);
    // Trajectories = public Hub total (includes unsigned)
    assert.equal(result.profile.analytics.summary.onChainContributions, 1);
    assert.equal(result.profile.hubTrajectories, 1);
    assert.equal(normalizeHubTxhash(null), null);
  });

  await test("12. Explorer uses completed_at", async () => {
    const items = [
      makeItem({
        attempt_id: 9,
        completed_at: "2026-09-09T20:22:05.000Z",
      }),
    ];
    const { fetchImpl } = makeFetch(
      new Map([[1, pageResponse({ page: 1, total: 1, items })]]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ts = result.profile.contributions[0]?.timestamp;
    assert.ok(ts != null);
    assert.equal(
      new Date(ts! * 1000).toISOString(),
      "2026-09-09T20:22:05.000Z",
    );
  });

  await test("13. Hub analytics only after complete history", async () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      makeItem({ attempt_id: 5000 - i }),
    );
    const { fetchImpl } = makeFetch(
      new Map([[1, pageResponse({ page: 1, total: 200, items })]]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.scanStatus, "incomplete");
    assert.equal(result.profile.analytics.summary.onChainContributions, 0);
    assert.equal(result.profile.analytics.skills.length, 0);
  });

  await test("14. two-wallet isolation", async () => {
    const fetchA = makeFetch(
      new Map([
        [
          1,
          pageResponse({
            page: 1,
            total: 1,
            items: [makeItem({ attempt_id: 111, task_name: "Wallet A Task" })],
          }),
        ],
      ]),
    );
    const fetchB = makeFetch(
      new Map([
        [
          1,
          pageResponse({
            page: 1,
            total: 1,
            items: [makeItem({ attempt_id: 222, task_name: "Wallet B Task" })],
          }),
        ],
      ]),
    );
    const a = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchA.fetchImpl,
      skipMetadata: true,
    });
    const b = await loadProfileData(WALLET_B, {
      fetchHubPages: fetchB.fetchImpl,
      skipMetadata: true,
    });
    assert.equal(a.ok && b.ok, true);
    if (!a.ok || !b.ok) return;
    assert.equal(a.profile.contributions[0]?.attemptId, 111);
    assert.equal(b.profile.contributions[0]?.attemptId, 222);
    assert.equal(getCachedHubAttempts(WALLET_A.toLowerCase()).length, 1);
    assert.equal(getCachedHubAttempts(WALLET_B.toLowerCase()).length, 1);
    assert.equal(
      getCachedHubAttempts(WALLET_A.toLowerCase())[0]?.taskName,
      "Wallet A Task",
    );
    assert.equal(
      getCachedHubAttempts(WALLET_B.toLowerCase())[0]?.taskName,
      "Wallet B Task",
    );
  });

  await test("15. fixture cannot override complete real Hub cache", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "true";
    persistHubPageProgress(REFERENCE_WALLET.toLowerCase(), {
      records: [
        parseHubAttemptItem(
          makeItem({ attempt_id: 999, score: 12, task_name: "Real Hub" }),
        )!,
      ],
      totalAttempts: 1,
      totalPages: 1,
      lastCompletedPage: 1,
      perPage: 100,
      status: "complete",
    });
    const result = await loadProfileData(REFERENCE_WALLET, {
      fetchHubPages: async () => {
        throw new Error("fresh cache should not refetch");
      },
      skipMetadata: true,
      hubCacheMaxAgeMs: 60_000,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.notEqual(
      result.profile.indexStatus.dataSource,
      "development-fixture",
    );
    assert.equal(result.profile.analytics.summary.onChainContributions, 1);
    assert.equal(result.profile.contributions[0]?.taskName, "Real Hub");
  });

  await test("16. Generate Card works from Hub-complete profile", async () => {
    const items = [makeItem({ attempt_id: 5, score: 91 })];
    const { fetchImpl } = makeFetch(
      new Map([[1, pageResponse({ page: 1, total: 1, items })]]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(isShareAllowedLike(result.profile.indexStatus), true);
    assert.equal(result.profile.baseVerification.status, "none");
  });

  await test("17. count match completes despite page cursor short", async () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      parseHubAttemptItem(makeItem({ attempt_id: i + 1 }))!,
    );
    persistHubPageProgress(WALLET_A.toLowerCase(), {
      records,
      totalAttempts: 5,
      totalPages: 2,
      lastCompletedPage: 1,
      perPage: 100,
      status: "incomplete",
    });
    let calls = 0;
    const result = await loadProfileData(WALLET_A, {
      skipMetadata: true,
      hubCacheMaxAgeMs: 60_000,
      fetchHubPages: async () => {
        calls += 1;
        throw new Error("should not fetch when count already matches");
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(calls, 0);
    assert.equal(result.profile.indexStatus.scanStatus, "complete");
    assert.equal(getHubWalletCache(WALLET_A.toLowerCase())?.status, "complete");
    assert.equal(countHubAttempts(WALLET_A.toLowerCase()), 5);
  });

  await test("18. exhausted reconciliation does not loop forever", async () => {
    const {
      ensureHubAttemptHistory,
      formatHubReconcileExhaustedError,
      isHubReconcileExhaustedForTotal,
    } = await import("../src/lib/hub-attempts");

    persistHubPageProgress(WALLET_A.toLowerCase(), {
      records: [parseHubAttemptItem(makeItem({ attempt_id: 1 }))!],
      totalAttempts: 3,
      totalPages: 1,
      lastCompletedPage: 1,
      perPage: 100,
      status: "incomplete",
      lastError: formatHubReconcileExhaustedError(3, 1),
    });
    assert.equal(
      isHubReconcileExhaustedForTotal(
        getHubWalletCache(WALLET_A.toLowerCase())?.lastError,
        3,
      ),
      true,
    );

    let calls = 0;
    const result = await ensureHubAttemptHistory(WALLET_A, {
      deadlineMs: Date.now() + 30_000,
      maxAgeMs: 60_000,
      fetchImpl: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({
            items: [makeItem({ attempt_id: 1 })],
            total: 3,
            page: 1,
            per_page: 100,
            total_pages: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    assert.equal(result.status, "incomplete");
    assert.equal(result.reconciliationExhausted, true);
    // May fetch page 1 for resume path before detecting exhausted reconcile,
    // but must not full-reconcile repeatedly — at most a small number of calls.
    assert.ok(calls <= 2);
  });

  await test("bonus: Base verification read-only complete", async () => {
    saveCompleteWalletCache(WALLET_A.toLowerCase(), 100, Date.now());
    const items = [makeItem({ attempt_id: 3 })];
    const { fetchImpl } = makeFetch(
      new Map([[1, pageResponse({ page: 1, total: 1, items })]]),
    );
    const result = await loadProfileData(WALLET_A, {
      fetchHubPages: fetchImpl,
      skipMetadata: true,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.baseVerification.status, "complete");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
