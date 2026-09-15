/**
 * Post-index validation harness for the SQLite architecture.
 * Prerequisites: npm run index:axis completed.
 *
 * Usage: npx tsx scripts/validate-index-api.ts [baseUrl]
 */
import http from "node:http";
import {
  forceLastSyncAt,
  getIndexState,
  getWalletRecords,
  openDatabase,
  countAxisRecords,
} from "../src/lib/db";
import { syncAxisIndex } from "../src/lib/indexer";
import { buildTaskIndex, matchContributions } from "../src/lib/matcher";
import { buildAnalytics } from "../src/lib/analytics";
import { fetchAxisTaskFamilies } from "../src/lib/axis";

const REF = "0x1e30c7c5495a9248facbb3642aee5da0b8f75cad";
const EMPTY = "0x0000000000000000000000000000000000000001";
const BASE = process.argv[2] || "http://127.0.0.1:3011";

function request(path: string): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  ms: number;
}> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const t0 = Date.now();
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
        timeout: 600_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            ms: Date.now() - t0,
          }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function main() {
  openDatabase();
  const state = getIndexState();
  console.log("Index state:", state);
  console.log("Total events:", countAxisRecords());

  const local = getWalletRecords(REF);
  console.log("\n=== LOCAL SQLITE REFERENCE WALLET ===");
  console.log("contributions:", local.length);
  const families = await fetchAxisTaskFamilies();
  const mapped = matchContributions(local, buildTaskIndex(families));
  const analytics = buildAnalytics(mapped, true);
  console.log(analytics.summary);
  console.log(analytics.coverage);
  console.log(
    "newer than historical 776?",
    local.length > 776,
    `(delta ${local.length - 776})`,
  );

  console.log("\n=== TEST A: recent-index API ===");
  forceLastSyncAt(Date.now());
  const a = await request(`/api/profile/${REF}`);
  const aj = JSON.parse(a.body);
  console.log("status", a.status, "ms", a.ms);
  console.log("headers eth_getLogs", a.headers["x-axis-eth-getlogs"]);
  console.log("freshness", aj.indexStatus?.freshness, aj.indexStatus?.dataSource);
  console.log("timings", aj.timings);
  console.log("contributions", aj.analytics?.summary?.onChainContributions);

  console.log("\n=== TEST B: stale-index API ===");
  forceLastSyncAt(Date.now() - 60 * 60 * 1000);
  const b = await request(`/api/profile/${REF}`);
  const bj = JSON.parse(b.body);
  console.log("status", b.status, "ms", b.ms);
  console.log("headers eth_getLogs", b.headers["x-axis-eth-getlogs"]);
  console.log("freshness", bj.indexStatus?.freshness, bj.indexStatus?.dataSource);
  console.log("timings", bj.timings);
  console.log("contributions", bj.analytics?.summary?.onChainContributions);

  console.log("\n=== TEST C: concurrent stale syncs ===");
  forceLastSyncAt(Date.now() - 60 * 60 * 1000);
  // Direct sync single-flight test
  const p1 = syncAxisIndex();
  const p2 = syncAxisIndex();
  const [r1, r2] = await Promise.all([p1, p2]);
  console.log("same promise result identity?", r1 === r2);
  console.log("r1", { skipped: r1.skipped, ethGetLogs: r1.ethGetLogs, from: r1.fromBlock, to: r1.toBlock });
  console.log("r2", { skipped: r2.skipped, ethGetLogs: r2.ethGetLogs, from: r2.fromBlock, to: r2.toBlock });

  console.log("\n=== EMPTY WALLET ===");
  forceLastSyncAt(Date.now());
  const e = await request(`/api/profile/${EMPTY}`);
  const ej = JSON.parse(e.body);
  console.log("status", e.status, "ms", e.ms, "empty", ej.empty);
  console.log("contributions", ej.analytics?.summary?.onChainContributions);
  console.log("eth_getLogs", e.headers["x-axis-eth-getlogs"]);
  console.log("freshness", ej.indexStatus?.freshness);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
