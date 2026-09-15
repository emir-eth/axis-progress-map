/**
 * One-time local bootstrap: build wallet_cache + wallet_events for the
 * reference wallet via the existing resumable wallet scanner.
 *
 * Does NOT modify .env.local. Fixture bypass is process-only.
 *
 * Usage: npx tsx scripts/bootstrap-reference-wallet-cache.ts
 */
import {
  closeDatabase,
  countCachedWalletEvents,
  getCachedWalletEvents,
  getWalletCache,
  openDatabase,
} from "../src/lib/db";
import { loadProfileData } from "../src/lib/profile-data";
import { normalizeAddress } from "../src/lib/base";

const WALLET = "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD";
const KNOWN_TX =
  "0x418c889d523e8426f92837be3a702cffdb4264c16ebcf7a1951dfe5ceac55925";
const EXPECTED = {
  taskId: "5615",
  score: 83,
  simulationTime: 15600,
  dataId: "5965276",
} as const;

/** Per-pass request budget (ms). Existing scanner stops at budget; we resume. */
const PASS_BUDGET_MS = 120_000;
const MAX_PASSES = 200;
const HUB_TXHASH_COUNT = 812;

function log(obj: unknown) {
  console.log(JSON.stringify(obj));
}

async function main() {
  process.env.AXIS_USE_DEV_FIXTURE = "false";

  const started = Date.now();
  openDatabase();

  const address = normalizeAddress(WALLET);
  const addressLower = address.toLowerCase();

  const before = getWalletCache(addressLower);
  log({
    phase: "start",
    beforeCache: before,
    beforeEvents: countCachedWalletEvents(addressLower),
    processFixture: process.env.AXIS_USE_DEV_FIXTURE,
  });

  let passes = 0;
  let totalEthGetLogs = 0;
  const rpcErrors: string[] = [];
  const warnings: string[] = [];

  while (passes < MAX_PASSES) {
    const cache = getWalletCache(addressLower);
    if (cache?.status === "complete") {
      break;
    }

    passes += 1;
    const passStarted = Date.now();
    log({
      phase: "pass_start",
      pass: passes,
      lastScannedBlock: cache?.lastScannedBlock ?? null,
      targetBlock: cache?.targetBlock ?? null,
      status: cache?.status ?? null,
      events: countCachedWalletEvents(addressLower),
    });

    try {
      const result = await loadProfileData(WALLET, {
        scanBudgetMs: PASS_BUDGET_MS,
      });

      if (result.ok) {
        const t = result.profile.timings;
        totalEthGetLogs += t?.ethGetLogs ?? 0;
        for (const w of result.profile.warnings ?? []) {
          warnings.push(w);
          if (/rpc|rate limit|unavailable|timeout|failed/i.test(w)) {
            rpcErrors.push(w);
          }
        }
        const after = getWalletCache(addressLower);
        log({
          phase: "pass_end",
          pass: passes,
          durationMs: Date.now() - passStarted,
          ethGetLogs: t?.ethGetLogs ?? 0,
          scanStatus: result.profile.indexStatus.scanStatus,
          lastScannedBlock: after?.lastScannedBlock ?? null,
          targetBlock: after?.targetBlock ?? null,
          status: after?.status ?? null,
          events: countCachedWalletEvents(addressLower),
          incomplete:
            result.profile.indexStatus.scanStatus === "incomplete",
        });
      } else {
        rpcErrors.push(`${result.code}: ${result.error}`);
        log({
          phase: "pass_error_result",
          pass: passes,
          code: result.code,
          error: result.error,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      rpcErrors.push(msg);
      log({ phase: "pass_exception", pass: passes, error: msg });
    }

    const mid = getWalletCache(addressLower);
    if (mid?.status === "complete") break;

    // Brief pause between passes to ease public RPC pressure
    await new Promise((r) => setTimeout(r, 500));
  }

  const finalCache = getWalletCache(addressLower);
  const events = getCachedWalletEvents(addressLower);
  const eventCount = events.length;
  const firstBlock =
    events.length > 0
      ? Math.min(...events.map((e) => e.blockNumber))
      : null;
  const latestBlock =
    events.length > 0
      ? Math.max(...events.map((e) => e.blockNumber))
      : null;

  const known = events.find(
    (e) => e.transactionHash.toLowerCase() === KNOWN_TX.toLowerCase(),
  );
  const knownMatch =
    known &&
    known.taskId === EXPECTED.taskId &&
    known.score === EXPECTED.score &&
    known.simulationTime === EXPECTED.simulationTime &&
    known.dataId === EXPECTED.dataId;

  const runtimeMs = Date.now() - started;
  const completed = finalCache?.status === "complete";

  log({
    phase: "final",
    bootstrapCompleted: completed,
    status: finalCache?.status ?? null,
    eventCount,
    firstBlock,
    latestBlock,
    lastScannedBlock: finalCache?.lastScannedBlock ?? null,
    targetBlock: finalCache?.targetBlock ?? null,
    resumePasses: passes,
    totalEthGetLogs,
    runtimeMs,
    runtimeMin: Math.round((runtimeMs / 60000) * 100) / 100,
    knownTxFound: Boolean(known),
    knownTxDecoded: known
      ? {
          taskId: known.taskId,
          score: known.score,
          simulationTime: known.simulationTime,
          dataId: known.dataId,
          blockNumber: known.blockNumber,
        }
      : null,
    knownTxValuesMatch: Boolean(knownMatch),
    hubTxhashCount: HUB_TXHASH_COUNT,
    differenceVsHub812: eventCount - HUB_TXHASH_COUNT,
    rpcErrors: [...new Set(rpcErrors)].slice(0, 20),
    rpcErrorCount: rpcErrors.length,
  });

  closeDatabase();
  process.exit(completed ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
