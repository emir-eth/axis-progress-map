/**
 * Turso / libSQL persistence-focused tests (local file: DB — no production Turso required).
 * Usage: npx tsx scripts/test-turso-persistence.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDatabase,
  countHubAttempts,
  DatabaseConfigError,
  getCachedHubAttempts,
  getHubWalletCache,
  getResolvedDbTarget,
  isRemoteTursoConfigured,
  openDatabase,
  persistHubPageProgress,
  upsertHubAttempts,
  type HubAttemptRecord,
} from "../src/lib/db";
import { isDevFixtureEnabled } from "../src/lib/dev-fixture";

const WALLET_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function sample(attemptId: number, score: number | null): HubAttemptRecord {
  return {
    attemptId,
    taskId: `task-${attemptId}`,
    taskName: `Task ${attemptId}`,
    score,
    completedAt: "2026-09-01T12:00:00.000Z",
    createdAt: "2026-09-01T11:00:00.000Z",
    simulationTimeSeconds: 12,
    txhash: null,
    theme: "office",
    userId: 1,
    username: "t",
    operatorShort: "0xaa..aaaa",
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
  };
}

async function withTempDb<T>(
  fn: () => Promise<T>,
  opts?: { persistentFile?: boolean },
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-turso-unit-"));
  const prevPath = process.env.AXIS_INDEX_DB_PATH;
  const prevUrl = process.env.TURSO_DATABASE_URL;
  const prevToken = process.env.TURSO_AUTH_TOKEN;
  const prevNode = process.env.NODE_ENV;
  delete process.env.TURSO_AUTH_TOKEN;
  if (prevNode === "production") process.env.NODE_ENV = "test";
  if (opts?.persistentFile) {
    delete process.env.TURSO_DATABASE_URL;
    process.env.AXIS_INDEX_DB_PATH = path.join(dir, "test.db");
  } else {
    delete process.env.AXIS_INDEX_DB_PATH;
    process.env.TURSO_DATABASE_URL = ":memory:";
  }
  await closeDatabase();
  await openDatabase();
  try {
    return await fn();
  } finally {
    await closeDatabase();
    if (prevPath === undefined) delete process.env.AXIS_INDEX_DB_PATH;
    else process.env.AXIS_INDEX_DB_PATH = prevPath;
    if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = prevUrl;
    if (prevToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
    else process.env.TURSO_AUTH_TOKEN = prevToken;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may keep a brief lock on closed libSQL files — ignore cleanup.
    }
  }
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  await test("A) schema initialization is idempotent", async () => {
    await withTempDb(async () => {
      await openDatabase();
      await openDatabase();
      await persistHubPageProgress(WALLET_A, {
        records: [sample(1, 10)],
        totalAttempts: 1,
        totalPages: 1,
        lastCompletedPage: 1,
        perPage: 100,
        status: "complete",
      });
      assert.equal(await countHubAttempts(WALLET_A), 1);
    });
  });

  await test("B) score:null round-trips correctly", async () => {
    await withTempDb(async () => {
      await upsertHubAttempts(WALLET_A, [sample(42, null)]);
      const rows = await getCachedHubAttempts(WALLET_A);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.score, null);
    });
  });

  await test("C) Hub attempt upsert remains idempotent", async () => {
    await withTempDb(async () => {
      await upsertHubAttempts(WALLET_A, [sample(7, 50)]);
      await upsertHubAttempts(WALLET_A, [sample(7, 99)]);
      assert.equal(await countHubAttempts(WALLET_A), 1);
      const rows = await getCachedHubAttempts(WALLET_A);
      assert.equal(rows[0]!.score, 99);
    });
  });

  await test("D) two wallets remain isolated", async () => {
    await withTempDb(async () => {
      await persistHubPageProgress(WALLET_A, {
        records: [sample(1, 1), sample(2, 2)],
        totalAttempts: 2,
        totalPages: 1,
        lastCompletedPage: 1,
        perPage: 100,
        status: "complete",
      });
      await persistHubPageProgress(WALLET_B, {
        records: [sample(10, 10)],
        totalAttempts: 1,
        totalPages: 1,
        lastCompletedPage: 1,
        perPage: 100,
        status: "incomplete",
      });
      assert.equal(await countHubAttempts(WALLET_A), 2);
      assert.equal(await countHubAttempts(WALLET_B), 1);
      assert.equal((await getHubWalletCache(WALLET_A))?.status, "complete");
      assert.equal((await getHubWalletCache(WALLET_B))?.status, "incomplete");
    });
  });

  await test("E) incomplete Hub cache persists/resumes", async () => {
    await withTempDb(async () => {
      await persistHubPageProgress(WALLET_A, {
        records: [sample(100, 1)],
        totalAttempts: 250,
        totalPages: 3,
        lastCompletedPage: 1,
        perPage: 100,
        status: "incomplete",
      });
      await closeDatabase();
      await openDatabase();
      const cache = await getHubWalletCache(WALLET_A);
      assert.ok(cache);
      assert.equal(cache!.status, "incomplete");
      assert.equal(cache!.lastCompletedPage, 1);
      assert.equal(cache!.totalAttempts, 250);
      assert.equal(await countHubAttempts(WALLET_A), 1);
    }, { persistentFile: true });
  });

  await test("F) cached count reconciliation works", async () => {
    await withTempDb(async () => {
      await persistHubPageProgress(WALLET_A, {
        records: [sample(1, 1), sample(2, 2), sample(3, 3)],
        totalAttempts: 3,
        totalPages: 1,
        lastCompletedPage: 1,
        perPage: 100,
        status: "complete",
      });
      assert.equal(await countHubAttempts(WALLET_A), 3);
      const cache = await getHubWalletCache(WALLET_A);
      assert.equal(cache!.totalAttempts, 3);
      assert.equal(await countHubAttempts(WALLET_A), cache!.totalAttempts);
    });
  });

  await test("G) complete cache remains complete when counts match", async () => {
    await withTempDb(async () => {
      await persistHubPageProgress(WALLET_A, {
        records: [sample(1, 1)],
        totalAttempts: 1,
        totalPages: 1,
        lastCompletedPage: 1,
        perPage: 100,
        status: "complete",
      });
      const again = await getHubWalletCache(WALLET_A);
      assert.equal(again!.status, "complete");
      assert.equal(await countHubAttempts(WALLET_A), again!.totalAttempts);
    });
  });

  await test("H) production does not use local filesystem SQLite", async () => {
    const prevNode = process.env.NODE_ENV;
    const prevUrl = process.env.TURSO_DATABASE_URL;
    const prevToken = process.env.TURSO_AUTH_TOKEN;
    const prevPath = process.env.AXIS_INDEX_DB_PATH;
    await closeDatabase();
    try {
      process.env.NODE_ENV = "production";
      delete process.env.TURSO_DATABASE_URL;
      delete process.env.TURSO_AUTH_TOKEN;
      process.env.AXIS_INDEX_DB_PATH = path.join(os.tmpdir(), "should-not-open.db");
      assert.throws(() => getResolvedDbTarget(), (err: unknown) => {
        assert.ok(err instanceof DatabaseConfigError);
        return true;
      });
      assert.equal(isRemoteTursoConfigured(), false);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
      else process.env.TURSO_DATABASE_URL = prevUrl;
      if (prevToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
      else process.env.TURSO_AUTH_TOKEN = prevToken;
      if (prevPath === undefined) delete process.env.AXIS_INDEX_DB_PATH;
      else process.env.AXIS_INDEX_DB_PATH = prevPath;
    }
  });

  await test("I) missing production Turso credentials fail clearly", async () => {
    const prevNode = process.env.NODE_ENV;
    const prevUrl = process.env.TURSO_DATABASE_URL;
    await closeDatabase();
    try {
      process.env.NODE_ENV = "production";
      delete process.env.TURSO_DATABASE_URL;
      await assert.rejects(async () => openDatabase(), (err: unknown) => {
        assert.ok(err instanceof DatabaseConfigError);
        assert.match(String((err as Error).message), /TURSO_DATABASE_URL/);
        return true;
      });
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevUrl === undefined) delete process.env.TURSO_DATABASE_URL;
      else process.env.TURSO_DATABASE_URL = prevUrl;
    }
  });

  await test("J) fixture remains impossible in production", async () => {
    const prevNode = process.env.NODE_ENV;
    const prevFix = process.env.AXIS_USE_DEV_FIXTURE;
    try {
      process.env.NODE_ENV = "production";
      process.env.AXIS_USE_DEV_FIXTURE = "true";
      assert.equal(isDevFixtureEnabled(), false);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevFix === undefined) delete process.env.AXIS_USE_DEV_FIXTURE;
      else process.env.AXIS_USE_DEV_FIXTURE = prevFix;
    }
  });

  // sanity: local memory / file mode resolves without remote Turso
  await test("local mode uses file/memory URL (not remote)", async () => {
    await withTempDb(async () => {
      const target = getResolvedDbTarget();
      assert.equal(target.mode, "file");
      assert.ok(
        target.url === ":memory:" || target.url.startsWith("file:"),
      );
      assert.equal(isRemoteTursoConfigured(), false);
    });
  });

  console.log("\nturso-persistence tests done");
}

main();
