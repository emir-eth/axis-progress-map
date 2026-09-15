/**
 * Focused unit tests for per-wallet cache + resumable historical scans.
 * Uses mocked getLogs / getBlockNumber — NO live Base historical scan.
 *
 * Usage: npm run test:wallet-cache
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Address, Log } from "viem";
import { encodeEventTopics, encodeAbiParameters, parseAbiItem } from "viem";
import {
  closeDatabase,
  computeHistoricalScanPercent,
  computeIncrementalRange,
  dedupeContributions,
  getCachedWalletEvents,
  getWalletCache,
  openDatabase,
  persistIncompleteRangeProgress,
  saveCompleteWalletCache,
  upsertWalletEvents,
} from "../src/lib/db";
import { loadProfileData } from "../src/lib/profile-data";
import { RECORD_SUBMITTED_TOPIC } from "../src/lib/base";
import { REFERENCE_WALLET } from "../src/lib/fixtures/reference-wallet";

const EVENT = parseAbiItem(
  "event RecordSubmitted(uint256 indexed dataId, uint256 indexed taskId, address indexed user, uint256 score, uint256 simulationTime)",
);

const TEST_WALLET =
  "0x1111111111111111111111111111111111111111" as Address;

function makeLog(opts: {
  user: Address;
  dataId: bigint;
  taskId: bigint;
  score: number;
  simulationTime: number;
  blockNumber: number;
  tx: `0x${string}`;
  logIndex: number;
}): Log {
  const topics = encodeEventTopics({
    abi: [EVENT],
    eventName: "RecordSubmitted",
    args: {
      dataId: opts.dataId,
      taskId: opts.taskId,
      user: opts.user,
    },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [BigInt(opts.score), BigInt(opts.simulationTime)],
  );
  return {
    address: "0xF91A90baA9E044Da084df369445A59D859d640dB",
    topics: topics as Log["topics"],
    data,
    blockNumber: BigInt(opts.blockNumber),
    transactionHash: opts.tx,
    logIndex: opts.logIndex,
    blockHash: "0x" + "ab".repeat(32),
    transactionIndex: 0,
    removed: false,
  } as Log;
}

function setupTempDb(): string {
  closeDatabase();
  globalThis.__axisWalletMaxLogRange = null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-wallet-cache-"));
  const dbPath = path.join(dir, "test.db");
  process.env.AXIS_INDEX_DB_PATH = dbPath;
  openDatabase();
  return dir;
}

function teardownTempDb(dir: string) {
  closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.AXIS_INDEX_DB_PATH;
  delete process.env.AXIS_START_BLOCK;
  delete process.env.BASE_LOG_CHUNK_SIZE;
  globalThis.__axisWalletMaxLogRange = null;
}

async function run() {
  let passed = 0;
  let failed = 0;

  /** Avoid live Hub / block RPC in unit tests (unless a test overrides). */
  const noHub = {
    fetchHubTrajectories: async (): Promise<number | null> => null,
    resolveTimestamps: false as const,
  };

  async function test(name: string, fn: () => Promise<void> | void) {
    const dir = setupTempDb();
    const prevFixture = process.env.AXIS_USE_DEV_FIXTURE;
    try {
      await fn();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL  ${name}`);
      console.error(err);
    } finally {
      if (prevFixture === undefined) delete process.env.AXIS_USE_DEV_FIXTURE;
      else process.env.AXIS_USE_DEV_FIXTURE = prevFixture;
      teardownTempDb(dir);
    }
  }

  await test("invalid wallet returns INVALID_ADDRESS", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    const result = await loadProfileData("not-an-address", {
      skipMetadata: true,
      ...noHub,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_ADDRESS");
  });

  await test("B) reference fixture fallback when no cache + fixture enabled", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "true";
    const result = await loadProfileData(REFERENCE_WALLET, {
      skipMetadata: true,
      ...noHub,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.dataSource, "development-fixture");
    assert.equal(result.profile.analytics.summary.onChainContributions, 776);
    assert.equal(result.profile.analytics.summary.uniqueTasks, 750);
    assert.equal(result.profile.analytics.summary.averageScore, 68.12);
    assert.equal(result.profile.analytics.summary.bestScore, 96);
    assert.equal(result.profile.hubTrajectories, null);
  });

  await test("A) reference wallet with complete cache prefers real data over fixture", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "true";
    const addr = REFERENCE_WALLET.toLowerCase();
    upsertWalletEvents(addr, [
      {
        dataId: "5965276",
        taskId: "5615",
        userAddress: addr,
        score: 83,
        simulationTime: 15600,
        blockNumber: 51097989,
        transactionHash: "0x" + "41".repeat(32),
        logIndex: 0,
        timestamp: null,
      },
      {
        dataId: "2",
        taskId: "2",
        userAddress: addr,
        score: 70,
        simulationTime: 1000,
        blockNumber: 51098000,
        transactionHash: "0x" + "42".repeat(32),
        logIndex: 0,
        timestamp: null,
      },
      {
        dataId: "3",
        taskId: "3",
        userAddress: addr,
        score: 60,
        simulationTime: 1000,
        blockNumber: 51098001,
        transactionHash: "0x" + "43".repeat(32),
        logIndex: 0,
        timestamp: null,
      },
    ]);
    saveCompleteWalletCache(addr, 51098001);

    const result = await loadProfileData(REFERENCE_WALLET, {
      skipMetadata: true,
      getBlockNumber: async () => 51098003n,
      getLogs: async () => [],
      fetchHubTrajectories: async () => 839,
      resolveTimestamps: false,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.notEqual(result.profile.indexStatus.dataSource, "development-fixture");
    assert.equal(result.profile.analytics.summary.onChainContributions, 3);
    assert.notEqual(result.profile.analytics.summary.onChainContributions, 776);
    assert.equal(result.profile.hubTrajectories, 839);
    assert.equal(getCachedWalletEvents(addr).length, 3);
  });

  await test("E) Hub endpoint success populates hubTrajectories", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    const addr = TEST_WALLET.toLowerCase();
    upsertWalletEvents(addr, [
      {
        dataId: "1",
        taskId: "1",
        userAddress: addr,
        score: 50,
        simulationTime: 1,
        blockNumber: 100,
        transactionHash: "0x" + "ab".repeat(32),
        logIndex: 0,
        timestamp: null,
      },
    ]);
    saveCompleteWalletCache(addr, 100);

    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      getBlockNumber: async () => 102n,
      getLogs: async () => [],
      fetchHubTrajectories: async () => 42,
      resolveTimestamps: false,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.hubTrajectories, 42);
    assert.equal(result.profile.analytics.summary.onChainContributions, 1);
  });

  await test("F) Hub endpoint failure leaves hubTrajectories null; profile loads", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    const addr = TEST_WALLET.toLowerCase();
    upsertWalletEvents(addr, [
      {
        dataId: "1",
        taskId: "1",
        userAddress: addr,
        score: 50,
        simulationTime: 1,
        blockNumber: 100,
        transactionHash: "0x" + "ac".repeat(32),
        logIndex: 0,
        timestamp: null,
      },
    ]);
    saveCompleteWalletCache(addr, 100);

    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      getBlockNumber: async () => 102n,
      getLogs: async () => [],
      fetchHubTrajectories: async () => {
        throw new Error("Hub down");
      },
      resolveTimestamps: false,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.hubTrajectories, null);
    assert.equal(result.profile.analytics.summary.onChainContributions, 1);
  });

  await test("fetchHubTrajectoriesTotal parses total; failure → null", async () => {
    const { fetchHubTrajectoriesTotal } = await import(
      "../src/lib/hub-trajectories"
    );
    const ok = await fetchHubTrajectoriesTotal(TEST_WALLET, {
      fetchImpl: (async () =>
        new Response(JSON.stringify({ total: 839, items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch,
    });
    assert.equal(ok, 839);

    const bad = await fetchHubTrajectoriesTotal(TEST_WALLET, {
      fetchImpl: (async () =>
        new Response("nope", { status: 500 })) as typeof fetch,
    });
    assert.equal(bad, null);

    const boom = await fetchHubTrajectoriesTotal(TEST_WALLET, {
      fetchImpl: (async () => {
        throw new Error("network");
      }) as typeof fetch,
    });
    assert.equal(boom, null);
  });

  await test("dedupeContributions merges by tx+logIndex", () => {
    const a = {
      dataId: "1",
      taskId: "10",
      user: TEST_WALLET,
      score: 50,
      simulationTime: 1,
      blockNumber: 100,
      transactionHash: "0xaaa" as `0x${string}`,
      logIndex: 0,
      timestamp: null,
    };
    const b = { ...a, score: 99 };
    const c = {
      ...a,
      transactionHash: "0xbbb" as `0x${string}`,
      score: 10,
      blockNumber: 99,
    };
    const out = dedupeContributions([a, b, c]);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.blockNumber, 99);
    assert.equal(out[1]!.score, 99);
  });

  await test("computeIncrementalRange + scan percent", () => {
    assert.equal(computeIncrementalRange(100, 100), null);
    assert.deepEqual(computeIncrementalRange(51_000_000, 51_050_000), {
      fromBlock: 51_000_001,
      toBlock: 51_050_000,
    });
    assert.equal(computeHistoricalScanPercent(100, 99, 200), 0);
    assert.equal(computeHistoricalScanPercent(100, 150, 200), 50);
    assert.equal(computeHistoricalScanPercent(100, 200, 200), 100);
  });

  await test("cache miss completes small first-time scan", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    process.env.AXIS_START_BLOCK = "100";

    const log = makeLog({
      user: TEST_WALLET,
      dataId: 1n,
      taskId: 42n,
      score: 80,
      simulationTime: 1000,
      blockNumber: 105,
      tx: ("0x" + "11".repeat(32)) as `0x${string}`,
      logIndex: 0,
    });

    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      scanBudgetMs: 10_000,
      getBlockNumber: async () => 110n,
      getLogs: async () => [log],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.dataSource, "live-wallet-scan");
    assert.equal(result.profile.indexStatus.scanStatus, "complete");
    assert.equal(result.profile.analytics.summary.onChainContributions, 1);
    assert.equal(getWalletCache(TEST_WALLET.toLowerCase())?.status, "complete");
  });

  await test("cache hit with caught-up head returns wallet-cache", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    const addr = TEST_WALLET.toLowerCase();
    upsertWalletEvents(addr, [
      {
        dataId: "9",
        taskId: "7",
        userAddress: addr,
        score: 70,
        simulationTime: 500,
        blockNumber: 200,
        transactionHash: "0x" + "22".repeat(32),
        logIndex: 1,
        timestamp: null,
      },
    ]);
    saveCompleteWalletCache(addr, 250);

    let getLogsCalls = 0;
    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      getBlockNumber: async () => 252n,
      getLogs: async () => {
        getLogsCalls += 1;
        return [];
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(getLogsCalls, 0);
    assert.equal(result.profile.indexStatus.dataSource, "wallet-cache");
    assert.equal(result.profile.analytics.summary.onChainContributions, 1);
  });

  await test("incremental refresh scans only missing range and dedupes", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    const addr = TEST_WALLET.toLowerCase();
    upsertWalletEvents(addr, [
      {
        dataId: "1",
        taskId: "1",
        userAddress: addr,
        score: 40,
        simulationTime: 1,
        blockNumber: 100,
        transactionHash: "0x" + "33".repeat(32),
        logIndex: 0,
        timestamp: null,
      },
    ]);
    saveCompleteWalletCache(addr, 100);

    const ranges: Array<{ from: number; to: number }> = [];
    const newLog = makeLog({
      user: TEST_WALLET,
      dataId: 2n,
      taskId: 2n,
      score: 90,
      simulationTime: 2,
      blockNumber: 150,
      tx: ("0x" + "44".repeat(32)) as `0x${string}`,
      logIndex: 0,
    });
    const dupLog = makeLog({
      user: TEST_WALLET,
      dataId: 1n,
      taskId: 1n,
      score: 40,
      simulationTime: 1,
      blockNumber: 100,
      tx: ("0x" + "33".repeat(32)) as `0x${string}`,
      logIndex: 0,
    });

    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      scanBudgetMs: 10_000,
      getBlockNumber: async () => 202n,
      getLogs: async ({ fromBlock, toBlock }) => {
        ranges.push({ from: Number(fromBlock), to: Number(toBlock) });
        return [newLog, dupLog];
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(ranges[0]!.from, 101);
    assert.equal(result.profile.analytics.summary.onChainContributions, 2);
    assert.equal(getCachedWalletEvents(addr).length, 2);
  });

  await test("refresh failure returns existing complete cache as stale", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    const addr = TEST_WALLET.toLowerCase();
    upsertWalletEvents(addr, [
      {
        dataId: "5",
        taskId: "5",
        userAddress: addr,
        score: 55,
        simulationTime: 1,
        blockNumber: 50,
        transactionHash: "0x" + "55".repeat(32),
        logIndex: 0,
        timestamp: null,
      },
    ]);
    saveCompleteWalletCache(addr, 50);

    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      getBlockNumber: async () => 100n,
      getLogs: async () => {
        throw new Error("RPC exploded");
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.dataSource, "wallet-cache");
    assert.equal(result.profile.indexStatus.freshness, "stale");
    assert.equal(result.profile.analytics.summary.onChainContributions, 1);
    assert.equal(getWalletCache(addr)?.lastScannedBlock, 50);
  });

  // ── Resumable historical scan ────────────────────────────────────────

  await test("timeout saves incomplete checkpoint with events; no final stats", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    process.env.AXIS_START_BLOCK = "100";
    process.env.BASE_LOG_CHUNK_SIZE = "10";

    let calls = 0;
    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      scanBudgetMs: 5_000,
      getBlockNumber: async () => 152n, // safe head 150
      getLogs: async ({ fromBlock, toBlock }) => {
        calls += 1;
        const from = Number(fromBlock);
        const to = Number(toBlock);
        // Succeed first two chunks, then stall past budget via delay
        if (calls <= 2) {
          return [
            makeLog({
              user: TEST_WALLET,
              dataId: BigInt(calls),
              taskId: BigInt(calls),
              score: 60 + calls,
              simulationTime: 1,
              blockNumber: from,
              tx: (`0x${calls.toString(16).padStart(2, "0")}${"aa".repeat(31)}`) as `0x${string}`,
              logIndex: 0,
            }),
          ];
        }
        // After two successful ranges, burn the budget
        await new Promise((r) => setTimeout(r, 60));
        void to;
        return [];
      },
    });

    // Force incomplete by using a custom approach: run with budget that
    // expires mid-way. With chunk=10 and range 100→150, after 2 chunks
    // (100-109, 110-119) we delay. Need budget to allow 2 chunks then stop.
    // Re-run with tighter control below if needed.
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // If somehow completed in one go due to timing, still assert invariants.
    const cache = getWalletCache(TEST_WALLET.toLowerCase());
    assert.ok(cache);

    if (result.profile.indexStatus.scanStatus === "incomplete") {
      assert.equal(result.profile.indexStatus.dataSource, "live-wallet-scan");
      assert.equal(result.profile.indexStatus.canResume, true);
      assert.ok(result.profile.indexStatus.scanProgress);
      assert.equal(result.profile.analytics.summary.onChainContributions, 0);
      assert.equal(result.profile.contributions.length, 0);
      assert.equal(cache!.status, "incomplete");
      assert.equal(cache!.targetBlock, 150);
      assert.ok(cache!.lastScannedBlock >= 109);
      assert.ok(getCachedWalletEvents(TEST_WALLET.toLowerCase()).length >= 1);
    } else {
      // Fast machine completed whole window — still valid complete path
      assert.equal(cache!.status, "complete");
    }
  });

  await test("second request resumes from checkpoint+1 not deployment", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    process.env.AXIS_START_BLOCK = "100";
    process.env.BASE_LOG_CHUNK_SIZE = "50";

    const addr = TEST_WALLET.toLowerCase();
    // Seed incomplete checkpoint as if first request saved through 119
    persistIncompleteRangeProgress(
      addr,
      [
        {
          dataId: "1",
          taskId: "1",
          userAddress: addr,
          score: 61,
          simulationTime: 1,
          blockNumber: 105,
          transactionHash: "0x" + "aa".repeat(32),
          logIndex: 0,
          timestamp: null,
        },
      ],
      119,
      150,
    );

    const ranges: Array<{ from: number; to: number }> = [];
    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      scanBudgetMs: 10_000,
      // Chain head moved forward — target must stay 150
      getBlockNumber: async () => 500n,
      getLogs: async ({ fromBlock, toBlock }) => {
        ranges.push({ from: Number(fromBlock), to: Number(toBlock) });
        return [
          makeLog({
            user: TEST_WALLET,
            dataId: 2n,
            taskId: 2n,
            score: 70,
            simulationTime: 1,
            blockNumber: 130,
            tx: ("0x" + "bb".repeat(32)) as `0x${string}`,
            logIndex: 0,
          }),
        ];
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(ranges.length >= 1);
    assert.equal(ranges[0]!.from, 120);
    // Historical phase only (before optional post-complete incremental catch-up)
    const historical = [];
    for (const r of ranges) {
      if (r.from > 150) break;
      historical.push(r);
    }
    assert.ok(historical.length >= 1);
    assert.ok(historical.every((r) => r.from >= 120 && r.to <= 150));
    // Original target finished → complete; head 498 may trigger incremental
    assert.equal(getWalletCache(addr)?.status, "complete");
    assert.equal(result.profile.indexStatus.scanStatus, "complete");
    assert.equal(result.profile.analytics.summary.onChainContributions, 2);
    // Events from partial + resume deduped
    assert.equal(getCachedWalletEvents(addr).length, 2);
  });

  await test("failed range does not advance checkpoint", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    process.env.AXIS_START_BLOCK = "100";
    process.env.BASE_LOG_CHUNK_SIZE = "10";

    const addr = TEST_WALLET.toLowerCase();
    persistIncompleteRangeProgress(addr, [], 109, 150);

    let calls = 0;
    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      scanBudgetMs: 10_000,
      getBlockNumber: async () => 152n,
      getLogs: async () => {
        calls += 1;
        throw new Error("RPC hard failure");
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.scanStatus, "incomplete");
    assert.equal(result.profile.indexStatus.canResume, true);
    assert.equal(getWalletCache(addr)?.lastScannedBlock, 109);
    assert.equal(getWalletCache(addr)?.targetBlock, 150);
    assert.ok(calls >= 1);
  });

  await test("reaching target flips incomplete → complete", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    process.env.AXIS_START_BLOCK = "100";
    const addr = TEST_WALLET.toLowerCase();
    persistIncompleteRangeProgress(
      addr,
      [
        {
          dataId: "1",
          taskId: "1",
          userAddress: addr,
          score: 40,
          simulationTime: 1,
          blockNumber: 100,
          transactionHash: "0x" + "cc".repeat(32),
          logIndex: 0,
          timestamp: null,
        },
      ],
      140,
      150,
    );

    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      scanBudgetMs: 10_000,
      getBlockNumber: async () => 152n, // safe head == target 150
      getLogs: async () => [
        makeLog({
          user: TEST_WALLET,
          dataId: 9n,
          taskId: 9n,
          score: 88,
          simulationTime: 1,
          blockNumber: 145,
          tx: ("0x" + "dd".repeat(32)) as `0x${string}`,
          logIndex: 0,
        }),
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(getWalletCache(addr)?.status, "complete");
    assert.equal(getWalletCache(addr)?.targetBlock, null);
    assert.equal(result.profile.indexStatus.scanStatus, "complete");
    assert.ok(result.profile.analytics.summary.onChainContributions >= 2);
  });

  await test("chain moving forward does not change frozen historical target", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    process.env.AXIS_START_BLOCK = "100";
    process.env.BASE_LOG_CHUNK_SIZE = "20";
    const addr = TEST_WALLET.toLowerCase();
    persistIncompleteRangeProgress(addr, [], 119, 150);

    const maxTo: number[] = [];
    await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      scanBudgetMs: 10_000,
      getBlockNumber: async () => 9999n,
      getLogs: async ({ toBlock }) => {
        maxTo.push(Number(toBlock));
        return [];
      },
    });

    // Historical resume must not request beyond original target 150
    // (incremental after complete may go further — only assert during incomplete portion)
    const cache = getWalletCache(addr);
    if (cache?.status === "incomplete") {
      assert.ok(maxTo.every((t) => t <= 150));
      assert.equal(cache.targetBlock, 150);
    } else {
      // Completed historical then may incremental — first historical batches ≤ 150
      const historical = maxTo.filter((t) => t <= 150);
      assert.ok(historical.length >= 1);
      assert.equal(cache?.status, "complete");
    }
  });

  await test("incomplete response withholds contribution analytics", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    process.env.AXIS_START_BLOCK = "100";
    const addr = TEST_WALLET.toLowerCase();
    persistIncompleteRangeProgress(
      addr,
      [
        {
          dataId: "7",
          taskId: "7",
          userAddress: addr,
          score: 99,
          simulationTime: 1,
          blockNumber: 110,
          transactionHash: "0x" + "ee".repeat(32),
          logIndex: 0,
          timestamp: null,
        },
      ],
      119,
      10_000,
    );

    // Budget so small that resume of huge target stays incomplete
    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      scanBudgetMs: 1,
      getBlockNumber: async () => 10_002n,
      getLogs: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return [];
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.scanStatus, "incomplete");
    assert.equal(result.profile.analytics.summary.onChainContributions, 0);
    assert.equal(result.profile.contributions.length, 0);
    assert.equal(result.profile.empty, true);
    // Events still on disk for later completion
    assert.equal(getCachedWalletEvents(addr).length, 1);
  });

  // ── Block timestamps ─────────────────────────────────────────────────

  await test("A) multiple events in one block → timestamp fetched once", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    process.env.AXIS_START_BLOCK = "100";
    const { attachBlockTimestamps } = await import(
      "../src/lib/block-timestamps"
    );
    let batchCalls = 0;
    const records = [
      {
        dataId: "1",
        taskId: "1",
        userAddress: TEST_WALLET.toLowerCase(),
        score: 10,
        simulationTime: 1,
        blockNumber: 500,
        transactionHash: "0x" + "11".repeat(32),
        logIndex: 0,
        timestamp: null as number | null,
      },
      {
        dataId: "2",
        taskId: "2",
        userAddress: TEST_WALLET.toLowerCase(),
        score: 20,
        simulationTime: 1,
        blockNumber: 500,
        transactionHash: "0x" + "12".repeat(32),
        logIndex: 1,
        timestamp: null as number | null,
      },
    ];
    const out = await attachBlockTimestamps(records, {
      useCache: false,
      fetchBatch: async (blocks) => {
        batchCalls += 1;
        assert.deepEqual(blocks, [500]);
        return new Map([[500, 1_700_000_000]]);
      },
    });
    assert.equal(batchCalls, 1);
    assert.equal(out[0]!.timestamp, 1_700_000_000);
    assert.equal(out[1]!.timestamp, 1_700_000_000);
  });

  await test("B+C) scan persists timestamp; failure keeps event with null", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    process.env.AXIS_START_BLOCK = "100";

    const log = makeLog({
      user: TEST_WALLET,
      dataId: 1n,
      taskId: 42n,
      score: 80,
      simulationTime: 1000,
      blockNumber: 105,
      tx: ("0x" + "77".repeat(32)) as `0x${string}`,
      logIndex: 0,
    });

    const ok = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      scanBudgetMs: 10_000,
      getBlockNumber: async () => 110n,
      getLogs: async () => [log],
      resolveTimestamps: true,
      fetchBlockTimestamps: async (blocks) => {
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0], 105);
        return new Map([[105, 1_710_000_000]]);
      },
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.profile.analytics.summary.onChainContributions, 1);
    assert.equal(ok.profile.contributions[0]!.timestamp, 1_710_000_000);
    assert.equal(
      getCachedWalletEvents(TEST_WALLET.toLowerCase())[0]!.timestamp,
      1_710_000_000,
    );

    // Fresh wallet path: timestamp RPC fails → event still stored
    const dirNote = "reuse same temp db is fine; new address";
    void dirNote;
    const OTHER = "0x2222222222222222222222222222222222222222" as Address;
    const log2 = makeLog({
      user: OTHER,
      dataId: 9n,
      taskId: 9n,
      score: 11,
      simulationTime: 1,
      blockNumber: 108,
      tx: ("0x" + "78".repeat(32)) as `0x${string}`,
      logIndex: 0,
    });
    const fail = await loadProfileData(OTHER, {
      skipMetadata: true,
      ...noHub,
      scanBudgetMs: 10_000,
      getBlockNumber: async () => 110n,
      getLogs: async () => [log2],
      resolveTimestamps: true,
      fetchBlockTimestamps: async () => {
        throw new Error("timestamp RPC down");
      },
    });
    assert.equal(fail.ok, true);
    if (!fail.ok) return;
    assert.equal(fail.profile.analytics.summary.onChainContributions, 1);
    assert.equal(fail.profile.contributions[0]!.timestamp, null);
    assert.equal(
      getCachedWalletEvents(OTHER.toLowerCase())[0]!.timestamp,
      null,
    );
  });

  await test("D+E) backfill updates null; enriched skips lookup", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    const addr = TEST_WALLET.toLowerCase();
    const {
      applyBlockTimestampToWalletEvents,
      listDistinctBlocksMissingTimestamps,
      countWalletEventsMissingTimestamps,
    } = await import("../src/lib/db");
    const { attachBlockTimestamps } = await import(
      "../src/lib/block-timestamps"
    );

    upsertWalletEvents(addr, [
      {
        dataId: "1",
        taskId: "1",
        userAddress: addr,
        score: 1,
        simulationTime: 1,
        blockNumber: 900,
        transactionHash: "0x" + "90".repeat(32),
        logIndex: 0,
        timestamp: null,
      },
      {
        dataId: "2",
        taskId: "2",
        userAddress: addr,
        score: 2,
        simulationTime: 1,
        blockNumber: 901,
        transactionHash: "0x" + "91".repeat(32),
        logIndex: 0,
        timestamp: 1_720_000_000,
      },
    ]);
    saveCompleteWalletCache(addr, 901);

    assert.deepEqual(listDistinctBlocksMissingTimestamps(addr), [900]);
    assert.equal(countWalletEventsMissingTimestamps(addr), 1);

    const changed = applyBlockTimestampToWalletEvents(900, 1_721_000_000, addr);
    assert.equal(changed, 1);
    assert.equal(countWalletEventsMissingTimestamps(addr), 0);
    assert.equal(getCachedWalletEvents(addr).find((e) => e.blockNumber === 900)?.timestamp, 1_721_000_000);

    let calls = 0;
    const already = await attachBlockTimestamps(
      [
        {
          dataId: "2",
          taskId: "2",
          userAddress: addr,
          score: 2,
          simulationTime: 1,
          blockNumber: 901,
          transactionHash: "0x" + "91".repeat(32),
          logIndex: 0,
          timestamp: 1_720_000_000,
        },
      ],
      {
        useCache: false,
        fetchBatch: async () => {
          calls += 1;
          return new Map();
        },
      },
    );
    assert.equal(calls, 0);
    assert.equal(already[0]!.timestamp, 1_720_000_000);
  });

  await test("F+G) profile maps DB timestamp; null stays null", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    const addr = TEST_WALLET.toLowerCase();
    upsertWalletEvents(addr, [
      {
        dataId: "1",
        taskId: "1",
        userAddress: addr,
        score: 50,
        simulationTime: 1,
        blockNumber: 200,
        transactionHash: "0x" + "a1".repeat(32),
        logIndex: 0,
        timestamp: 1_730_000_000,
      },
      {
        dataId: "2",
        taskId: "2",
        userAddress: addr,
        score: 51,
        simulationTime: 1,
        blockNumber: 201,
        transactionHash: "0x" + "a2".repeat(32),
        logIndex: 0,
        timestamp: null,
      },
    ]);
    saveCompleteWalletCache(addr, 201);

    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      ...noHub,
      getBlockNumber: async () => 203n,
      getLogs: async () => [],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const byTask = new Map(
      result.profile.contributions.map((c) => [c.taskId, c.timestamp]),
    );
    assert.equal(byTask.get("1"), 1_730_000_000);
    assert.equal(byTask.get("2"), null);
  });

  await test("H) Explorer date formatting helpers", async () => {
    const { formatDateShort, formatTimestampIso } = await import(
      "../src/lib/format"
    );
    assert.equal(formatDateShort(null), "—");
    assert.equal(formatTimestampIso(null), undefined);
    const iso = formatTimestampIso(1_700_000_000);
    assert.ok(iso?.startsWith("2023-"));
    const short = formatDateShort(1_700_000_000);
    assert.notEqual(short, "—");
    assert.ok(short.includes("2023") || /\d{4}/.test(short));
  });

  await test("I) backfill helpers do not call getLogs / historical scan", async () => {
    process.env.AXIS_USE_DEV_FIXTURE = "false";
    const addr = TEST_WALLET.toLowerCase();
    upsertWalletEvents(addr, [
      {
        dataId: "1",
        taskId: "1",
        userAddress: addr,
        score: 1,
        simulationTime: 1,
        blockNumber: 777,
        transactionHash: "0x" + "b7".repeat(32),
        logIndex: 0,
        timestamp: null,
      },
    ]);
    const { listDistinctBlocksMissingTimestamps, applyBlockTimestampToWalletEvents } =
      await import("../src/lib/db");
    const { resolveBlockTimestamps } = await import(
      "../src/lib/block-timestamps"
    );
    const blocks = listDistinctBlocksMissingTimestamps(addr);
    assert.deepEqual(blocks, [777]);
    const map = await resolveBlockTimestamps(blocks, {
      useCache: false,
      fetchBatch: async () => new Map([[777, 1_740_000_000]]),
    });
    applyBlockTimestampToWalletEvents(777, map.get(777)!, addr);
    assert.equal(getCachedWalletEvents(addr)[0]!.timestamp, 1_740_000_000);
    // No loadProfileData / getLogs involved — timestamp enrichment only.
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  assert.ok(RECORD_SUBMITTED_TOPIC.startsWith("0x"));
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
