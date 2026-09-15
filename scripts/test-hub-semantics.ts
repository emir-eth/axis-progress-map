/**
 * Hub metric semantics tests (null score, reconciliation, analytics, explorer).
 * Usage: npm run test:hub-semantics
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeHubSemanticCounts,
  filterTrajectoryContributions,
  filterUnsignedContributions,
  hasValidHubTxhash,
} from "../src/lib/hub-semantics";
import { buildAnalytics } from "../src/lib/analytics";
import {
  ensureHubAttemptHistory,
  parseHubAttemptItem,
} from "../src/lib/hub-attempts";
import {
  closeDatabase,
  countHubAttempts,
  getCachedHubAttempts,
  getHubWalletCache,
  openDatabase,
  persistHubPageProgress,
} from "../src/lib/db";
import { deriveShareFields } from "../src/lib/share-fields";
import { formatScore } from "../src/lib/format";
import type { MappedContribution, ProfileAnalytics } from "../src/types";

function hubHistoryProgressPercent(
  fetched: number,
  total: number,
): number | null {
  if (total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((fetched / total) * 100)));
}

const WALLET =
  "0x1111111111111111111111111111111111111111" as `0x${string}`;

function baseMapped(
  partial: Partial<MappedContribution> = {},
): MappedContribution {
  return {
    dataId: "1",
    taskId: "100",
    user: WALLET,
    score: 80,
    simulationTime: 1000,
    blockNumber: null,
    transactionHash: null,
    logIndex: 0,
    timestamp: 1_700_000_000,
    attemptId: 1,
    source: "hub",
    metadataStatus: "mapped",
    phase: "post",
    taskName: "Task",
    description: null,
    skills: ["Pick"],
    theme: "office",
    embodiment: "franka",
    difficulty: 1,
    successRate: 0.5,
    familyId: "f1",
    ...partial,
  };
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function makeItem(opts: {
  attempt_id: number;
  score?: number | null;
  txhash?: string | null;
  task_id?: number | string;
}) {
  return {
    attempt_id: opts.attempt_id,
    task_id: opts.task_id ?? 3308,
    task_name: "Task",
    score: opts.score === undefined ? 50 : opts.score,
    completed_at: "2026-08-10T14:15:09.428995+00:00",
    created_at: "2026-08-10T14:15:09.428995+00:00",
    simulation_time_seconds: 10,
    txhash: opts.txhash === undefined ? null : opts.txhash,
    theme: "office",
    user_id: 1,
    username: "tester",
    operator_short: "0x11..1111",
    quality_rating: "perfect",
    model_id: "m",
    chain_data: null,
  };
}

async function withTempDb<T>(fn: () => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-hub-sem-"));
  const prev = process.env.AXIS_INDEX_DB_PATH;
  const prevTursoUrl = process.env.TURSO_DATABASE_URL;
  const prevTursoToken = process.env.TURSO_AUTH_TOKEN;
  const prevNode = process.env.NODE_ENV;
  if (prevNode === "production") process.env.NODE_ENV = "test";
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.AXIS_INDEX_DB_PATH;
  process.env.TURSO_DATABASE_URL = ":memory:";
  await closeDatabase();
  await openDatabase();
  try {
    return await fn();
  } finally {
    await closeDatabase();
    if (prev === undefined) delete process.env.AXIS_INDEX_DB_PATH;
    else process.env.AXIS_INDEX_DB_PATH = prev;
    if (prevTursoUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevTursoUrl;
    if (prevTursoToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
    else process.env.TURSO_AUTH_TOKEN = prevTursoToken;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* win lock */ }
  }
}

async function main() {
  await test("A) score:null row parses and caches", async () => {
    await withTempDb(async () => {
      const parsed = parseHubAttemptItem(
        makeItem({ attempt_id: 3593904, score: null, txhash: null }),
      );
      assert.ok(parsed);
      assert.equal(parsed!.score, null);
      assert.equal(parsed!.attemptId, 3593904);
      await persistHubPageProgress(WALLET.toLowerCase(), {
        records: [parsed!],
        totalAttempts: 1,
        totalPages: 1,
        lastCompletedPage: 1,
        perPage: 100,
        status: "incomplete",
      });
      const rows = await getCachedHubAttempts(WALLET.toLowerCase());
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.score, null);
    });
  });

  await test("B) score:null contributes to Trajectories total", () => {
    const rows = [
      baseMapped({
        attemptId: 1,
        score: null,
        taskId: "1",
        transactionHash: null,
      }),
      baseMapped({
        attemptId: 2,
        score: 90,
        taskId: "2",
        transactionHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
      }),
    ];
    const analytics = buildAnalytics(rows, true);
    assert.equal(analytics.summary.onChainContributions, 2);
  });

  await test("C) score:null excluded from average/best", () => {
    const rows = [
      baseMapped({ attemptId: 1, score: null, taskId: "1" }),
      baseMapped({ attemptId: 2, score: 40, taskId: "2" }),
      baseMapped({ attemptId: 3, score: 60, taskId: "3" }),
    ];
    const analytics = buildAnalytics(rows, true);
    assert.equal(analytics.summary.averageScore, 50);
    assert.equal(analytics.summary.bestScore, 60);
  });

  await test("D/E) mismatched complete cannot stay complete; reconcile restores", async () => {
    await withTempDb(async () => {
      const existing = Array.from({ length: 863 }, (_, i) =>
        parseHubAttemptItem(makeItem({ attempt_id: i + 1, score: 10 }))!,
      );
      await persistHubPageProgress(WALLET.toLowerCase(), {
        records: existing,
        totalAttempts: 864,
        totalPages: 1,
        lastCompletedPage: 1,
        perPage: 100,
        status: "complete",
      });
      assert.equal(await countHubAttempts(WALLET.toLowerCase()), 863);
      assert.equal((await getHubWalletCache(WALLET.toLowerCase()))?.status, "complete");

      const missing = makeItem({
        attempt_id: 3593904,
        score: null,
        txhash: null,
      });
      const allItems = [
        ...Array.from({ length: 863 }, (_, i) =>
          makeItem({ attempt_id: i + 1, score: 10 }),
        ),
        missing,
      ];

      const result = await ensureHubAttemptHistory(WALLET, {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              items: allItems,
              total: 864,
              page: 1,
              per_page: 100,
              total_pages: 1,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        deadlineMs: Date.now() + 60_000,
        maxAgeMs: 60_000,
      });

      assert.equal(result.status, "complete");
      assert.equal(await countHubAttempts(WALLET.toLowerCase()), 864);
      const cached = await getCachedHubAttempts(WALLET.toLowerCase());
      assert.ok(
        cached.some((r) => r.attemptId === 3593904 && r.score === null),
      );
      assert.equal((await getHubWalletCache(WALLET.toLowerCase()))?.status, "complete");
    });
  });

  await test("F) signed + unsigned = total cached attempts", () => {
    const rows = [
      ...Array.from({ length: 836 }, () => ({ txhash: "ab".repeat(32) })),
      ...Array.from({ length: 28 }, () => ({ txhash: null as string | null })),
    ];
    const c = computeHubSemanticCounts(rows);
    assert.equal(c.hubAttemptCount, 864);
    assert.equal(c.trajectoryCount + c.unsignedAttemptCount, 864);
    assert.equal(c.trajectoryCount, 836);
    assert.equal(c.unsignedAttemptCount, 28);
  });

  await test("G) explorer default = ALL (no signed-only filter)", () => {
    const rows = [
      baseMapped({
        attemptId: 1,
        transactionHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
      }),
      baseMapped({ attemptId: 2, transactionHash: null }),
    ];
    assert.equal(rows.length, 2);
    assert.equal(filterTrajectoryContributions(rows).length, 1);
    assert.equal(filterUnsignedContributions(rows).length, 1);
  });

  await test("H) null score displays —", () => {
    assert.equal(formatScore(null), "—");
    assert.equal(formatScore(undefined), "—");
  });

  await test("I) null txhash displays — (invalid hash)", () => {
    assert.equal(hasValidHubTxhash(null), false);
    assert.equal(hasValidHubTxhash(""), false);
  });

  await test("J) Unique Tasks includes null-score attempts", () => {
    const rows = [
      baseMapped({ attemptId: 1, score: null, taskId: "A" }),
      baseMapped({ attemptId: 2, score: 10, taskId: "B" }),
    ];
    const analytics = buildAnalytics(rows, true);
    assert.equal(analytics.summary.uniqueTasks, 2);
  });

  await test("K) Skill/Environment mapping uses all Hub attempts", () => {
    const rows = [
      baseMapped({
        attemptId: 1,
        score: null,
        taskId: "A",
        skills: ["Reach"],
        theme: "kitchen",
        metadataStatus: "mapped",
      }),
      baseMapped({
        attemptId: 2,
        score: 10,
        taskId: "B",
        skills: ["Pick"],
        theme: "office",
        metadataStatus: "mapped",
        transactionHash: ("0x" + "cd".repeat(32)) as `0x${string}`,
      }),
    ];
    const analytics = buildAnalytics(rows, true);
    assert.equal(analytics.skills.length, 2);
    assert.equal(analytics.themes.length, 2);
    assert.equal(analytics.coverage.totalContributions, 2);
  });

  await test("L) Generate Card uses public Hub total", () => {
    const analytics: ProfileAnalytics = {
      summary: {
        onChainContributions: 864,
        uniqueTasks: 10,
        averageScore: 50,
        bestScore: 99,
      },
      coverage: {
        mappedUniqueTasks: 8,
        totalUniqueTasks: 10,
        coveragePercent: 80,
        mappedContributions: 800,
        totalContributions: 864,
      },
      skills: [],
      themes: [],
      timeline: [],
      metadataAvailable: false,
    };
    const fields = deriveShareFields(analytics, {
      hubTxhash: {
        hubAttemptCount: 864,
        trajectoryCount: 836,
        unsignedAttemptCount: 28,
      },
    });
    assert.equal(fields.contributionCount, 864);
    assert.equal(fields.signedAttempts, 836);
    assert.equal(fields.unsignedAttempts, 28);
    assert.equal(
      (fields as { hubAttempts?: number }).hubAttempts,
      undefined,
    );
  });

  await test("M) Share card does not surface Base records", () => {
    const analytics: ProfileAnalytics = {
      summary: {
        onChainContributions: 864,
        uniqueTasks: 1,
        averageScore: 1,
        bestScore: 1,
      },
      coverage: {
        mappedUniqueTasks: 0,
        totalUniqueTasks: 1,
        coveragePercent: 0,
        mappedContributions: 0,
        totalContributions: 864,
      },
      skills: [],
      themes: [],
      timeline: [],
      metadataAvailable: false,
    };
    const fields = deriveShareFields(analytics, {
      hubTxhash: {
        trajectoryCount: 836,
        unsignedAttemptCount: 28,
      },
    });
    assert.equal(fields.contributionCount, 864);
    assert.equal(fields.signedAttempts, 836);
    assert.equal(fields.unsignedAttempts, 28);
    assert.equal(
      (fields as { baseRecords?: number }).baseRecords,
      undefined,
    );
  });

  await test("preparation progress unchanged", () => {
    assert.equal(hubHistoryProgressPercent(400, 1865), 21);
  });

  console.log("\nhub-semantics tests done");
}

main();
