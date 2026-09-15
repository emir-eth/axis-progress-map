/**
 * Backfill wallet_events.timestamp from Base block headers.
 * Does NOT rescan RecordSubmitted logs.
 *
 * Usage:
 *   npx tsx scripts/backfill-wallet-timestamps.ts 0x...
 *   npm run backfill:timestamps -- 0x...
 *
 * Requires an explicit wallet address (no whole-DB sweep by default).
 */
import { getAddress, isAddress } from "viem";
import {
  applyBlockTimestampToWalletEvents,
  closeDatabase,
  countCachedWalletEvents,
  countWalletEventsMissingTimestamps,
  getWalletEventByTx,
  listDistinctBlocksMissingTimestamps,
  openDatabase,
} from "../src/lib/db";
import {
  emptyBlockTimestampStats,
  resolveBlockTimestamps,
} from "../src/lib/block-timestamps";

const KNOWN_TX =
  "0x418c889d523e8426f92837be3a702cffdb4264c16ebcf7a1951dfe5ceac55925";

function parseWalletArg(): string {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const raw = args[0];
  if (!raw || !isAddress(raw)) {
    console.error(
      "Usage: npx tsx scripts/backfill-wallet-timestamps.ts <walletAddress>",
    );
    process.exit(1);
  }
  return getAddress(raw).toLowerCase();
}

async function main() {
  const addressLower = parseWalletArg();
  openDatabase();
  const started = Date.now();

  const totalEvents = countCachedWalletEvents(addressLower);
  const missingBefore = countWalletEventsMissingTimestamps(addressLower);
  const blocks = listDistinctBlocksMissingTimestamps(addressLower);

  console.log(
    JSON.stringify({
      phase: "start",
      address: addressLower,
      totalEvents,
      missingTimestampsBefore: missingBefore,
      uniqueBlocksNeedingLookup: blocks.length,
    }),
  );

  if (blocks.length === 0) {
    console.log(
      JSON.stringify({
        phase: "done",
        note: "No missing timestamps",
        runtimeMs: Date.now() - started,
      }),
    );
    closeDatabase();
    return;
  }

  const stats = emptyBlockTimestampStats();
  const map = await resolveBlockTimestamps(blocks, { stats });

  let eventsEnriched = 0;
  for (const bn of blocks) {
    const ts = map.get(bn);
    if (ts == null) continue;
    eventsEnriched += applyBlockTimestampToWalletEvents(
      bn,
      ts,
      addressLower,
    );
  }

  const missingAfter = countWalletEventsMissingTimestamps(addressLower);
  const known = getWalletEventByTx(addressLower, KNOWN_TX);

  console.log(
    JSON.stringify(
      {
        phase: "final",
        totalEvents,
        missingTimestampsBefore: missingBefore,
        uniqueBlocksNeedingLookup: blocks.length,
        blocksResolved: map.size,
        ethGetBlockBatches: stats.ethGetBlockBatches,
        ethGetBlockByNumber: stats.ethGetBlockByNumber,
        cacheHits: stats.cacheHits,
        blocksFetched: stats.blocksFetched,
        rpcFailures: stats.failures,
        eventsEnriched,
        missingTimestampsAfter: missingAfter,
        runtimeMs: Date.now() - started,
        knownTx: known
          ? {
              found: true,
              blockNumber: known.blockNumber,
              timestamp: known.timestamp,
              iso:
                known.timestamp != null
                  ? new Date(known.timestamp * 1000).toISOString()
                  : null,
            }
          : { found: false },
      },
      null,
      2,
    ),
  );

  closeDatabase();
  process.exit(missingAfter > 0 && eventsEnriched === 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  closeDatabase();
  process.exit(1);
});
