/**
 * EXPERIMENTAL — not used by the app profile path.
 * READ-ONLY proof-of-concept: fetch Axis RecordSubmitted logs via Blockscout.
 *
 * Usage: npm run test:blockscout
 */
import { decodeAbiParameters, getAddress, isAddress } from "viem";

const ENDPOINT = "https://base.blockscout.com/api";
const CONTRACT = "0xF91A90baA9E044Da084df369445A59D859d640dB";
const TOPIC0 =
  "0x6d77e907890f072253fbef2eb8d17cd30e09e409799f01195372185adc5313fd";
const DEPLOYMENT_BLOCK = 43_731_412;
const REF_WALLET = "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD";
const EMPTY_WALLET = "0x000000000000000000000000000000000000dEaD";

const KNOWN_TX =
  "0x1eb9e7486335205d1ecf648c160747ea86e664e0f1a0551dca2d3b541e8079c1";
const KNOWN = {
  block: 51_048_211,
  dataId: "5908784",
  taskId: "5440",
  score: 59,
  simulationTime: 25_200,
};

const PREV_LATEST_TS = Date.parse("2026-09-08T16:42:49.000Z");
const PREV_SCAN_HEAD = 51_051_790;

const HIST = {
  total: 776,
  uniqueTasks: 750,
  avg: 68.12,
  best: 96,
  worst: 0,
  ge70: 429,
  ge80: 338,
  ge90: 176,
};

const MAX_PAGE = 1000;
const MAX_RETRIES = 12;
/** Polite spacing between successful Blockscout calls (free public API). */
const REQUEST_GAP_MS = Number(process.env.AXIS_BS_GAP_MS || 5_000);
/**
 * Keep windows modest: large ranges have been observed to return OK with
 * <1000 rows yet still omit later logs in the requested range.
 */
const WINDOW_BLOCKS = Number(process.env.AXIS_BS_WINDOW || 100_000);
/**
 * Empirically, this reference wallet has no RecordSubmitted before ~49609902
 * (verified empty 43731412→49200000 via Blockscout). Override with AXIS_BS_FROM.
 */
const SCAN_FROM = Number(process.env.AXIS_BS_FROM || 49_600_000);

interface BsLog {
  address: string;
  blockNumber: string;
  data: string;
  logIndex: string;
  timeStamp: string;
  topics: string[];
  transactionHash: string;
}

interface DecodedEvent {
  dataId: string;
  taskId: string;
  user: string;
  score: number;
  simulationTime: number;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
  timestamp: number;
}

interface FetchStats {
  httpRequests: number;
  retries: number;
  errors: string[];
  rateLimited: number;
  durations: number[];
}

function padTopicAddress(address: string): string {
  const a = getAddress(address);
  return `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
}

function hexToNumber(hex: string): number {
  return Number.parseInt(hex, 16);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function getLatestBlock(): Promise<number> {
  const url = `${ENDPOINT}?module=block&action=eth_block_number`;
  const res = await fetch(url);
  const json = (await res.json()) as { result?: string };
  if (!json.result) {
    // fallback via proxy eth_blockNumber style used by some explorers
    const r2 = await fetch("https://mainnet.base.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      }),
    });
    const j2 = (await r2.json()) as { result: string };
    return hexToNumber(j2.result);
  }
  return hexToNumber(json.result);
}

/**
 * Build getLogs URL.
 *
 * Base Blockscout intermittently returns empty results when combining
 * `address` + `topic0` + `topic3`. Topic0+topic3 (no address) is reliable;
 * we then keep only Axis contract logs client-side (cheap).
 */
function buildLogsUrl(
  fromBlock: number,
  toBlock: number,
  topic3: string | null,
  includeAddress: boolean,
): string {
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    fromBlock: String(fromBlock),
    toBlock: String(toBlock),
    topic0: TOPIC0,
  });
  if (includeAddress) params.set("address", CONTRACT);
  if (topic3) {
    params.set("topic3", topic3);
    params.set("topic0_3_opr", "and");
  }
  return `${ENDPOINT}?${params.toString()}`;
}

async function fetchLogsPage(
  fromBlock: number,
  toBlock: number,
  topic3: string | null,
  stats: FetchStats,
): Promise<BsLog[]> {
  // Prefer topic-only filter when wallet topic3 is set (more reliable on Base BS).
  const url = buildLogsUrl(fromBlock, toBlock, topic3, !topic3);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const t0 = Date.now();
    stats.httpRequests += 1;
    try {
      const res = await fetch(url);
      const ms = Date.now() - t0;
      stats.durations.push(ms);

      // Body may be JSON even on 429
      const text = await res.text();
      let json: {
        status?: string;
        message?: string;
        result?: BsLog[] | string;
      } = {};
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        /* non-JSON */
      }

      const msg = String(json.message || json.result || text || "");
      const rateLimited =
        res.status === 429 || /too many requests|rate limit/i.test(msg);

      if (rateLimited) {
        stats.rateLimited += 1;
        stats.retries += 1;
        const wait = Math.min(90_000, 4_000 * 2 ** attempt);
        console.log(
          `  rate-limited [${fromBlock}-${toBlock}] attempt ${attempt + 1}/${MAX_RETRIES}, wait ${wait}ms`,
        );
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      if (json.status === "0") {
        if (/no .+ found/i.test(msg) || /No records found/i.test(msg)) {
          await sleep(REQUEST_GAP_MS);
          return [];
        }
        // some explorers return status 0 with empty result
        if (!json.result || json.result === "[]") {
          await sleep(REQUEST_GAP_MS);
          return [];
        }
        throw new Error(`API error: ${msg}`);
      }

      if (!Array.isArray(json.result)) {
        await sleep(REQUEST_GAP_MS);
        return [];
      }
      const filtered = topic3
        ? json.result.filter(
            (l) => l.address.toLowerCase() === CONTRACT.toLowerCase(),
          )
        : json.result;
      await sleep(REQUEST_GAP_MS);
      return filtered;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_RETRIES - 1) {
        stats.errors.push(message);
        throw error;
      }
      stats.retries += 1;
      await sleep(Math.min(60_000, 2_000 * 2 ** attempt));
    }
  }
  throw new Error(
    `Exhausted retries for logs ${fromBlock}-${toBlock} (likely rate limited)`,
  );
}

/**
 * Fetch all logs in [from,to] using fixed-size block windows first
 * (Blockscout may reject or silently fail huge ranges), then bisect
 * any window that hits the 1000-result cap.
 */
async function fetchAllLogs(
  fromBlock: number,
  toBlock: number,
  topic3: string | null,
  stats: FetchStats,
): Promise<BsLog[]> {
  if (fromBlock > toBlock) return [];

  const out: BsLog[] = [];
  let windows = 0;

  for (let start = fromBlock; start <= toBlock; start += WINDOW_BLOCKS) {
    const end = Math.min(start + WINDOW_BLOCKS - 1, toBlock);
    windows += 1;
    process.stdout.write(
      `  window ${windows}: ${start}→${end} (so far ${out.length} logs, ${stats.httpRequests} HTTP)\n`,
    );
    const chunk = await fetchRangeAdaptive(start, end, topic3, stats);
    out.push(...chunk);
  }
  return out;
}

async function fetchRangeAdaptive(
  fromBlock: number,
  toBlock: number,
  topic3: string | null,
  stats: FetchStats,
): Promise<BsLog[]> {
  if (fromBlock > toBlock) return [];
  const page = await fetchLogsPage(fromBlock, toBlock, topic3, stats);
  if (page.length < MAX_PAGE) return page;

  if (fromBlock === toBlock) {
    stats.errors.push(
      `Single-block ${fromBlock} returned ${page.length} logs (cap ${MAX_PAGE}); possible truncation`,
    );
    return page;
  }

  const mid = Math.floor((fromBlock + toBlock) / 2);
  const left = await fetchRangeAdaptive(fromBlock, mid, topic3, stats);
  const right = await fetchRangeAdaptive(mid + 1, toBlock, topic3, stats);
  return [...left, ...right];
}

function decodeLog(log: BsLog): DecodedEvent | null {
  try {
    const topics = log.topics;
    if (topics.length < 4) return null;
    const dataId = BigInt(topics[1]).toString();
    const taskId = BigInt(topics[2]).toString();
    const user = getAddress(`0x${topics[3].slice(-40)}`);
    const [score, simulationTime] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      log.data as `0x${string}`,
    );
    return {
      dataId,
      taskId,
      user,
      score: Number(score),
      simulationTime: Number(simulationTime),
      blockNumber: hexToNumber(log.blockNumber),
      logIndex: hexToNumber(log.logIndex),
      transactionHash: log.transactionHash.toLowerCase(),
      timestamp: hexToNumber(log.timeStamp) * 1000,
    };
  } catch {
    return null;
  }
}

function summarize(events: DecodedEvent[]) {
  const scores = events.map((e) => e.score);
  const uniqueTasks = new Set(events.map((e) => e.taskId)).size;
  const sum = scores.reduce((a, b) => a + b, 0);
  return {
    total: events.length,
    uniqueTasks,
    avg: events.length ? Math.round((sum / events.length) * 100) / 100 : 0,
    best: events.length ? Math.max(...scores) : 0,
    worst: events.length ? Math.min(...scores) : 0,
    ge70: scores.filter((s) => s >= 70).length,
    ge80: scores.filter((s) => s >= 80).length,
    ge90: scores.filter((s) => s >= 90).length,
  };
}

function dedupeSort(events: DecodedEvent[]): DecodedEvent[] {
  const map = new Map<string, DecodedEvent>();
  for (const e of events) {
    map.set(`${e.transactionHash}-${e.logIndex}`, e);
  }
  return [...map.values()].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return a.logIndex - b.logIndex;
  });
}

async function runWallet(
  label: string,
  wallet: string,
  latest: number,
): Promise<{
  events: DecodedEvent[];
  stats: FetchStats;
  wallMs: number;
  topicFilterOk: boolean;
}> {
  if (!isAddress(wallet)) throw new Error(`invalid wallet ${wallet}`);
  const topic3 = padTopicAddress(wallet);
  const stats: FetchStats = {
    httpRequests: 0,
    retries: 0,
    errors: [],
    rateLimited: 0,
    durations: [],
  };

  console.log(`\n=== ${label} ===`);
  console.log("wallet:", getAddress(wallet));
  console.log("topic3:", topic3);
  console.log("range:", `${SCAN_FROM} → ${latest}`);
  console.log("gap ms:", REQUEST_GAP_MS, "window:", WINDOW_BLOCKS);

  const t0 = Date.now();
  const raw = await fetchAllLogs(SCAN_FROM, latest, topic3, stats);
  const decoded = dedupeSort(
    raw.map(decodeLog).filter((e): e is DecodedEvent => e !== null),
  );

  // Verify topic3 filter: every decoded user must match
  const topicFilterOk = decoded.every(
    (e) => e.user.toLowerCase() === getAddress(wallet).toLowerCase(),
  );

  const wallMs = Date.now() - t0;
  console.log("raw logs:", raw.length);
  console.log("decoded unique:", decoded.length);
  console.log("topic3 filter consistent:", topicFilterOk);
  console.log("HTTP requests:", stats.httpRequests);
  console.log("retries:", stats.retries);
  console.log("rateLimited:", stats.rateLimited);
  console.log("wall ms:", wallMs);
  if (stats.durations.length) {
    const avg =
      stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length;
    console.log("avg request ms:", Math.round(avg));
  }

  return { events: decoded, stats, wallMs, topicFilterOk };
}

async function main() {
  console.log("Blockscout Axis PoC");
  console.log("endpoint:", ENDPOINT);
  console.log("API key required: no");

  const latest = await getLatestBlock();
  console.log("latest block:", latest);

  // Quick filter sanity: small window around known event (topic0+topic3, no address)
  const probeStats: FetchStats = {
    httpRequests: 0,
    retries: 0,
    errors: [],
    rateLimited: 0,
    durations: [],
  };
  const probe = await fetchLogsPage(
    KNOWN.block - 5,
    KNOWN.block + 5,
    padTopicAddress(REF_WALLET),
    probeStats,
  );
  console.log(
    "\nProbe around known block:",
    probe.length,
    "logs,",
    probeStats.httpRequests,
    "HTTP",
  );
  if (probe.length === 0) {
    console.log(
      "WARNING: topic3 probe around known block returned 0 (Blockscout getLogs flaky)",
    );
  }

  console.log(
    "\nNote: using topic0+topic3 without address (address+topics is flaky on Base Blockscout)",
  );
  console.log("Pagination: fixed", WINDOW_BLOCKS, "block windows; bisect if >=", MAX_PAGE);

  const ref = await runWallet("REFERENCE WALLET", REF_WALLET, latest);
  const summary = summarize(ref.events);
  console.log("\n--- summary ---");
  console.log(summary);

  const historical = ref.events.filter(
    (e) =>
      e.blockNumber <= PREV_SCAN_HEAD || e.timestamp <= PREV_LATEST_TS,
  );
  const newer = ref.events.filter(
    (e) => e.blockNumber > PREV_SCAN_HEAD && e.timestamp > PREV_LATEST_TS,
  );
  console.log("historical (<= prior scan head/ts):", historical.length);
  console.log("genuinely newer:", newer.length);
  if (newer.length) {
    console.log(
      "newest block/ts:",
      newer[newer.length - 1].blockNumber,
      new Date(newer[newer.length - 1].timestamp).toISOString(),
    );
  }

  const histSummary = summarize(historical);
  console.log("\n--- vs historical snapshot (historical subset) ---");
  console.log("expected", HIST);
  console.log("got     ", histSummary);

  const known = ref.events.find((e) => e.transactionHash === KNOWN_TX);
  console.log("\n--- known tx spot check ---");
  if (!known) {
    console.log("MISSING known tx", KNOWN_TX);
  } else {
    console.log("FOUND", {
      block: known.blockNumber,
      dataId: known.dataId,
      taskId: known.taskId,
      score: known.score,
      simulationTime: known.simulationTime,
    });
    const match =
      known.blockNumber === KNOWN.block &&
      known.dataId === KNOWN.dataId &&
      known.taskId === KNOWN.taskId &&
      known.score === KNOWN.score &&
      known.simulationTime === KNOWN.simulationTime;
    console.log("fields match expected:", match);
  }

  const empty = await runWallet("EMPTY WALLET", EMPTY_WALLET, latest);

  // Verdict
  const histOk =
    histSummary.total === HIST.total &&
    histSummary.uniqueTasks === HIST.uniqueTasks &&
    histSummary.avg === HIST.avg &&
    histSummary.best === HIST.best &&
    histSummary.worst === HIST.worst &&
    histSummary.ge70 === HIST.ge70 &&
    histSummary.ge80 === HIST.ge80 &&
    histSummary.ge90 === HIST.ge90;

  let verdict: "SUITABLE" | "PARTIALLY SUITABLE" | "NOT SUITABLE" = "NOT SUITABLE";
  let why = "";
  if (
    ref.topicFilterOk &&
    known &&
    histOk &&
    ref.wallMs < 60_000 &&
    empty.events.length === 0
  ) {
    verdict = "SUITABLE";
    why =
      "Server-side topic3 filtering worked, historical 776 snapshot matched, known tx found, empty wallet returned 0, and wall time was interactive.";
  } else if (ref.topicFilterOk && known && histSummary.total >= HIST.total * 0.95) {
    verdict = "PARTIALLY SUITABLE";
    why =
      "Filtering works and most historical events are present, but timing and/or exact snapshot metrics need review.";
  } else {
    why =
      "Missing known event, weak historical match, broken topic filtering, or non-interactive latency.";
  }

  console.log("\n=== VERDICT ===");
  console.log(verdict);
  console.log(why);

  // Machine-readable footer for the report
  console.log("\n=== REPORT JSON ===");
  console.log(
    JSON.stringify(
      {
        endpoint: ENDPOINT,
        apiKeyRequired: false,
        topicFilterWorked: ref.topicFilterOk,
        pagination:
          "fixed 50k block windows + bisect when page hits 1000; topic0+topic3 without address",
        topicFilterNote:
          "address+topic0+topic3 is flaky on Base Blockscout; topic0+topic3 works more reliably",
        reference: {
          total: summary.total,
          historical: historical.length,
          newer: newer.length,
          ...summary,
          histSummary,
          knownTxFound: Boolean(known),
        },
        httpRequests: ref.stats.httpRequests + empty.stats.httpRequests + probeStats.httpRequests,
        refHttpRequests: ref.stats.httpRequests,
        refWallMs: ref.wallMs,
        emptyHttpRequests: empty.stats.httpRequests,
        emptyWallMs: empty.wallMs,
        emptyEvents: empty.events.length,
        rateLimited: ref.stats.rateLimited + empty.stats.rateLimited,
        retries: ref.stats.retries + empty.stats.retries,
        errors: [...ref.stats.errors, ...empty.stats.errors],
        verdict,
        why,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
