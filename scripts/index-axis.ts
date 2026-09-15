/**
 * EXPERIMENTAL — not used by the app profile path.
 * Initial / resumable full Axis RecordSubmitted global index.
 * Usage: npm run index:axis
 */
import {
  countAxisRecords,
  getDbPath,
  getIndexState,
  openDatabase,
} from "../src/lib/db";
import { getAxisStartBlock } from "../src/lib/base";
import { getSafeChainHead, runFullIndex } from "../src/lib/indexer";

async function main() {
  openDatabase();
  const start = getAxisStartBlock();
  const head = await getSafeChainHead();
  const state = getIndexState();
  const resumeFrom =
    state.lastIndexedBlock >= start ? state.lastIndexedBlock + 1 : start;

  console.log("Axis global index");
  console.log("");
  console.log("DB:", getDbPath());
  console.log("Range:", `${resumeFrom} → ${head}`);
  console.log(
    "Resume:",
    state.lastIndexedBlock > 0
      ? `last_indexed_block=${state.lastIndexedBlock}`
      : "fresh start",
  );
  console.log("Existing events:", countAxisRecords());
  console.log("");

  const t0 = Date.now();
  const stats = await runFullIndex({
    onProgress: (p) => {
      const line = [
        `Progress: ${p.pct.toFixed(1)}%`,
        `Events stored: ${p.eventsStored}`,
        `Current block: ${p.currentBlock}`,
        `RPC requests: ${p.rpcCalls}`,
        `Retries: ${p.retries}`,
      ].join(" | ");
      process.stdout.write(`\r${line}          `);
    },
  });

  console.log("\n");
  const finalState = getIndexState();
  console.log("=== DONE ===");
  console.log("fromBlock:", stats.fromBlock);
  console.log("toBlock:", stats.toBlock);
  console.log("newEvents this run:", stats.newEvents);
  console.log("total events:", countAxisRecords());
  console.log("durationMs:", stats.durationMs);
  console.log("wallMs:", Date.now() - t0);
  console.log("rpcCalls:", stats.rpcCalls);
  console.log("retries:", stats.retries);
  console.log("ethGetLogs:", stats.ethGetLogs);
  console.log("ethGetBlockBatches:", stats.ethGetBlockBatches);
  console.log("ethGetBlockByNumber:", stats.ethGetBlockByNumber);
  console.log("lastIndexedBlock:", finalState.lastIndexedBlock);
  console.log("initialIndexComplete:", finalState.initialIndexComplete);
  console.log(
    "lastSyncAt:",
    finalState.lastSyncAt
      ? new Date(finalState.lastSyncAt).toISOString()
      : null,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
