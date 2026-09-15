/**
 * Secondary Base verification — Turso resume across requests.
 * Usage: npx tsx scripts/test-base-verification.ts
 */
import assert from "node:assert/strict";
import type { Address, Log } from "viem";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import {
  closeDatabase,
  getWalletCache,
  openDatabase,
} from "../src/lib/db";
import {
  ensureBaseVerification,
  readBaseVerification,
  remainingBaseVerificationBudgetMs,
} from "../src/lib/base-verification";
import { loadProfileData } from "../src/lib/profile-data";

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

async function setup() {
  await closeDatabase();
  if (process.env.NODE_ENV === "production") process.env.NODE_ENV = "test";
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.AXIS_INDEX_DB_PATH;
  process.env.TURSO_DATABASE_URL = ":memory:";
  process.env.AXIS_USE_DEV_FIXTURE = "false";
  process.env.AXIS_START_BLOCK = "100";
  process.env.BASE_LOG_CHUNK_SIZE = "10";
  globalThis.__axisWalletMaxLogRange = null;
  await openDatabase();
}

async function teardown() {
  await closeDatabase();
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.AXIS_START_BLOCK;
  delete process.env.BASE_LOG_CHUNK_SIZE;
  globalThis.__axisWalletMaxLogRange = null;
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  await setup();
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
  } finally {
    await teardown();
  }
}

async function main() {
  await test("none when Turso has no wallet_cache row", async () => {
    const snap = await readBaseVerification(TEST_WALLET.toLowerCase());
    assert.equal(snap.status, "none");
    assert.equal(snap.recordSubmittedCount, null);
  });

  await test("cold start checkpoints; second request resumes to complete", async () => {
    let calls = 0;

    const pass1 = await ensureBaseVerification(TEST_WALLET, {
      budgetMs: 900,
      resolveTimestamps: false,
      getBlockNumber: async () => 152n,
      getLogs: async ({ fromBlock }) => {
        calls += 1;
        const from = Number(fromBlock);
        if (calls >= 2) {
          await new Promise((r) => setTimeout(r, 600));
        }
        return [
          makeLog({
            user: TEST_WALLET,
            dataId: BigInt(calls),
            taskId: BigInt(calls),
            score: 70,
            simulationTime: 1,
            blockNumber: from,
            tx: (`0x${calls.toString(16).padStart(2, "0")}${"ab".repeat(31)}`) as `0x${string}`,
            logIndex: 0,
          }),
        ];
      },
    });

    assert.equal(pass1.status, "incomplete");
    assert.ok((pass1.recordSubmittedCount ?? 0) >= 1);
    const cache1 = await getWalletCache(TEST_WALLET.toLowerCase());
    assert.ok(cache1);
    assert.equal(cache1.status, "incomplete");
    assert.ok(cache1.lastScannedBlock >= 100);
    const checkpoint = cache1.lastScannedBlock;

    const pass2 = await ensureBaseVerification(TEST_WALLET, {
      budgetMs: 30_000,
      resolveTimestamps: false,
      getBlockNumber: async () => 152n,
      getLogs: async ({ fromBlock }) => {
        calls += 1;
        const from = Number(fromBlock);
        assert.ok(from > checkpoint, "resume must start after checkpoint");
        return [
          makeLog({
            user: TEST_WALLET,
            dataId: BigInt(500 + calls),
            taskId: BigInt(calls),
            score: 71,
            simulationTime: 1,
            blockNumber: from,
            tx: (`0x${(calls + 50).toString(16).padStart(2, "0")}${"cd".repeat(31)}`) as `0x${string}`,
            logIndex: 0,
          }),
        ];
      },
    });

    assert.equal(pass2.status, "complete");
    const cache2 = await getWalletCache(TEST_WALLET.toLowerCase());
    assert.equal(cache2?.status, "complete");
    assert.ok(
      (pass2.recordSubmittedCount ?? 0) >= (pass1.recordSubmittedCount ?? 0),
    );
  });

  await test("remaining budget respects request cap", async () => {
    const started = Date.now() - 50_000;
    const left = remainingBaseVerificationBudgetMs(started, 25_000, Date.now());
    assert.ok(left <= 5_500);
    assert.ok(left >= 0);
  });

  await test("Hub-complete profile does not auto-start Base verification", async () => {
    const { persistHubPageProgress } = await import("../src/lib/db");
    const addr = TEST_WALLET.toLowerCase();
    await persistHubPageProgress(addr, {
      records: [
        {
          attemptId: 1,
          taskId: "1",
          taskName: "t",
          score: 50,
          completedAt: "2026-09-01T00:00:00.000Z",
          createdAt: "2026-09-01T00:00:00.000Z",
          simulationTimeSeconds: 1,
          txhash: null,
          theme: null,
          userId: null,
          username: null,
          operatorShort: null,
          qualityRating: null,
          modelId: null,
          dataId: null,
          chainTaskId: null,
          chainScore: null,
          chainId: null,
          simulationTime: null,
          contractAddress: null,
          serverSignature: null,
          chainDataJson: null,
          rawJson: null,
        },
      ],
      totalAttempts: 1,
      totalPages: 1,
      lastCompletedPage: 1,
      perPage: 50,
      status: "complete",
    });

    let getLogsCalls = 0;
    const result = await loadProfileData(TEST_WALLET, {
      skipMetadata: true,
      hubFetchBudgetMs: 5_000,
      scanBudgetMs: 15_000,
      hubCacheMaxAgeMs: 60 * 60_000,
      resolveTimestamps: false,
      fetchHubPages: async () =>
        new Response(
          JSON.stringify({
            items: [],
            total: 1,
            page: 1,
            per_page: 50,
            total_pages: 1,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      getBlockNumber: async () => 120n,
      getLogs: async ({ fromBlock }) => {
        getLogsCalls += 1;
        const from = Number(fromBlock);
        return [
          makeLog({
            user: TEST_WALLET,
            dataId: BigInt(getLogsCalls),
            taskId: 1n,
            score: 80,
            simulationTime: 1,
            blockNumber: from,
            tx: (`0x${getLogsCalls.toString(16).padStart(2, "0")}${"ee".repeat(31)}`) as `0x${string}`,
            logIndex: 0,
          }),
        ];
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.profile.indexStatus.dataSource, "hub-cache");
    assert.equal(getLogsCalls, 0, "public profile must not call Base eth_getLogs");
    assert.equal(result.profile.baseVerification.status, "none");
  });

  await test("concurrent incomplete writes never rewind checkpoint or demote complete", async () => {
    const {
      persistIncompleteRangeProgress,
      saveCompleteWalletCache,
      upsertWalletEvents,
    } = await import("../src/lib/db");
    const addr = TEST_WALLET.toLowerCase();

    await persistIncompleteRangeProgress(addr, [], 150, 500, Date.now());
    await persistIncompleteRangeProgress(addr, [], 120, 500, Date.now());
    let cache = await getWalletCache(addr);
    assert.equal(cache?.lastScannedBlock, 150);
    assert.equal(cache?.status, "incomplete");

    await saveCompleteWalletCache(addr, 200, Date.now());
    await persistIncompleteRangeProgress(addr, [], 180, 500, Date.now());
    cache = await getWalletCache(addr);
    assert.equal(cache?.status, "complete");
    assert.equal(cache?.lastScannedBlock, 200);

    const rec = {
      dataId: "1",
      taskId: "1",
      userAddress: addr,
      score: 1,
      simulationTime: 1,
      blockNumber: 201,
      transactionHash: ("0x" + "11".repeat(32)) as `0x${string}`,
      logIndex: 0,
      timestamp: null as number | null,
    };
    await upsertWalletEvents(addr, [rec]);
    await upsertWalletEvents(addr, [rec]);
    const { countCachedWalletEvents } = await import("../src/lib/db");
    assert.equal(await countCachedWalletEvents(addr), 1);
  });

  console.log(`\nbase-verification tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

