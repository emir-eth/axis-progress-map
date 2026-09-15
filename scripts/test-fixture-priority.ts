/**
 * Fixture priority tests — fixture must never block real Hub loading.
 * Usage: npm run test:fixture-priority
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDatabase,
  getHubWalletCache,
  openDatabase,
  persistHubPageProgress,
} from "../src/lib/db";
import { loadProfileData } from "../src/lib/profile-data";
import { parseHubAttemptItem } from "../src/lib/hub-attempts";
import { REFERENCE_WALLET } from "../src/lib/fixtures/reference-wallet";

const OTHER = "0x1111111111111111111111111111111111111111" as const;

/** Fixture tests must not inherit a leftover NODE_ENV=production from builds. */
function ensureNonProductionNodeEnv(): string | undefined {
  const prev = process.env.NODE_ENV;
  if (prev === "production") {
    process.env.NODE_ENV = "test";
  }
  return prev;
}

function restoreNodeEnv(prev: string | undefined) {
  if (prev === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prev;
}

async function setupTempDb(): Promise<{ dir: string; prevNodeEnv: string | undefined }> {
  await closeDatabase();
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.AXIS_INDEX_DB_PATH;
  const prevNodeEnv = ensureNonProductionNodeEnv();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-fixture-prio-"));
  process.env.TURSO_DATABASE_URL = ":memory:";
  await openDatabase();
  return { dir, prevNodeEnv };
}

async function teardown(dir: string, prevNodeEnv: string | undefined) {
  await closeDatabase();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* win lock */ }
  delete process.env.AXIS_INDEX_DB_PATH;
  delete process.env.AXIS_USE_DEV_FIXTURE;
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  restoreNodeEnv(prevNodeEnv);
}

function makeItem(attempt_id: number, txhash: string | null = "ab".repeat(32)) {
  return {
    attempt_id,
    task_id: 1000,
    task_name: `Task ${attempt_id}`,
    theme: "office",
    score: 80,
    completed_at: "2026-09-09T12:00:00.000Z",
    txhash,
    chain_data: { data_id: attempt_id, task_id: 1000, score: 80, chain_id: 8453 },
  };
}

function page(opts: {
  page: number;
  total: number;
  items: ReturnType<typeof makeItem>[];
}) {
  return {
    items: opts.items,
    total: opts.total,
    page: opts.page,
    per_page: 100,
    total_pages: Math.max(1, Math.ceil(opts.total / 100)),
    next_cursor: null,
  };
}

async function run() {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    const { dir, prevNodeEnv } = await setupTempDb();
    try {
      await fn();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL  ${name}`);
      console.error(err);
    } finally {
      await teardown(dir, prevNodeEnv);
    }
  }

  await test("A) reference, no cache, Hub available → real Hub build, not fixture", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "true";
    let hubCalls = 0;
    const result = await loadProfileData(REFERENCE_WALLET, {
      skipMetadata: true,
      hubFetchBudgetMs: 30_000,
      fetchHubPages: async (url) => {
        hubCalls += 1;
        const u = new URL(url);
        const p = Number(u.searchParams.get("page") ?? "1");
        const items = Array.from({ length: 100 }, (_, i) =>
          makeItem(9000 - i),
        );
        return new Response(
          JSON.stringify(page({ page: p, total: 864, items })),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.notEqual(
      result.profile.indexStatus.dataSource,
      "development-fixture",
    );
    assert.ok(hubCalls >= 1);
    assert.ok(await getHubWalletCache(REFERENCE_WALLET.toLowerCase()));
    // Incomplete or complete — but not the old 776 fixture snapshot
    assert.notEqual(result.profile.analytics.summary.onChainContributions, 776);
  });

  await test("B) reference, incomplete Hub cache → resume, not fixture", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "true";
    await persistHubPageProgress(REFERENCE_WALLET.toLowerCase(), {
      records: Array.from({ length: 100 }, (_, i) =>
        parseHubAttemptItem(makeItem(8000 - i))!,
      ),
      totalAttempts: 864,
      totalPages: 9,
      lastCompletedPage: 1,
      perPage: 100,
      status: "incomplete",
    });
    let hubCalls = 0;
    const result = await loadProfileData(REFERENCE_WALLET, {
      skipMetadata: true,
      hubFetchBudgetMs: 30_000,
      fetchHubPages: async (url) => {
        hubCalls += 1;
        const u = new URL(url);
        const p = Number(u.searchParams.get("page") ?? "1");
        assert.ok(p >= 2, "should resume after page 1");
        return new Response(
          JSON.stringify(
            page({
              page: p,
              total: 864,
              items: Array.from({ length: 100 }, (_, i) => makeItem(7900 - i)),
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.notEqual(
      result.profile.indexStatus.dataSource,
      "development-fixture",
    );
    assert.ok(hubCalls >= 1);
  });

  await test("C) reference, complete Hub cache → real Hub profile", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "true";
    await persistHubPageProgress(REFERENCE_WALLET.toLowerCase(), {
      records: [
        parseHubAttemptItem(makeItem(1, "ab".repeat(32)))!,
        parseHubAttemptItem(makeItem(2, null))!,
      ],
      totalAttempts: 2,
      totalPages: 1,
      lastCompletedPage: 1,
      perPage: 100,
      status: "complete",
    });
    const result = await loadProfileData(REFERENCE_WALLET, {
      skipMetadata: true,
      hubCacheMaxAgeMs: 60_000,
      fetchHubPages: async () => {
        throw new Error("fresh complete cache should not need Hub");
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.dataSource, "hub-cache");
    // Trajectories = public Hub total (all attempts)
    assert.equal(result.profile.analytics.summary.onChainContributions, 2);
    assert.equal(result.profile.hubTrajectories, 2);
    assert.equal(result.profile.hubTxhash?.hubAttemptCount, 2);
    assert.equal(result.profile.hubTxhash?.trajectoryCount, 1);
    assert.equal(result.profile.hubTxhash?.unsignedAttemptCount, 1);
  });

  await test("D) reference, Hub unavailable + fixture enabled → fixture fallback", async () => {
    // Intended ONLY for non-production + AXIS_USE_DEV_FIXTURE + reference wallet
    // when Hub never returns usable progress. Production hard-gate is covered by G.
    process.env.AXIS_USE_DEV_FIXTURE = "true";
    assert.notEqual(process.env.NODE_ENV, "production");
    const result = await loadProfileData(REFERENCE_WALLET, {
      skipMetadata: true,
      fetchHubPages: async () =>
        new Response(JSON.stringify({ error: "down" }), { status: 503 }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.profile.indexStatus.dataSource,
      "development-fixture",
    );
    assert.equal(result.profile.analytics.summary.onChainContributions, 776);
  });

  await test("E) other wallet never gets fixture", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "true";
    const result = await loadProfileData(OTHER, {
      skipMetadata: true,
      fetchHubPages: async () =>
        new Response(JSON.stringify({ error: "down" }), { status: 503 }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.notEqual(
      result.profile.indexStatus.dataSource,
      "development-fixture",
    );
  });

  await test("F) real Hub profile is not labeled development-fixture", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "true";
    const result = await loadProfileData(REFERENCE_WALLET, {
      skipMetadata: true,
      fetchHubPages: async () =>
        new Response(
          JSON.stringify(
            page({
              page: 1,
              total: 1,
              items: [makeItem(42)],
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.notEqual(
      result.profile.indexStatus.dataSource,
      "development-fixture",
    );
    assert.notEqual(
      result.profile.indexStatus.dataSource,
      "verified-fixture",
    );
  });

  await test("G) production NODE_ENV never enables fixture", async () => {
    const { isDevFixtureEnabled } = await import("../src/lib/dev-fixture");
    const prevNode = process.env.NODE_ENV;
    const prevFix = process.env.AXIS_USE_DEV_FIXTURE;
    try {
      process.env.NODE_ENV = "production";
      process.env.AXIS_USE_DEV_FIXTURE = "true";
      assert.equal(isDevFixtureEnabled(), false);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevFix === undefined) delete process.env.AXIS_USE_DEV_FIXTURE;
      else process.env.AXIS_USE_DEV_FIXTURE = prevFix;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
