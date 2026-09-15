/**
 * EXPERIMENTAL — not used by the app profile path.
 * READ-ONLY proof-of-concept: Axis RecordSubmitted logs via Etherscan API V2 (Base).
 *
 * Usage: npm run test:etherscan
 *
 * Never prints the API key.
 */
import { decodeAbiParameters, getAddress } from "viem";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENDPOINT = "https://api.etherscan.io/v2/api";
const CHAIN_ID = "8453";
const CONTRACT = "0xF91A90baA9E044Da084df369445A59D859d640dB";
const TOPIC0 =
  "0x6d77e907890f072253fbef2eb8d17cd30e09e409799f01195372185adc5313fd";
const REF_WALLET = "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD";
/** Approx contract deployment / earliest Axis activity on Base. */
const FROM_BLOCK = 43_731_412;
/** Prior verified scan head used as historical snapshot boundary. */
const HIST_BOUNDARY_BLOCK = 51_051_790;

const KNOWN_TX =
  "0x1eb9e7486335205d1ecf648c160747ea86e664e0f1a0551dca2d3b541e8079c1";

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

const REQUEST_TIMEOUT_MS = 10_000;
const GLOBAL_BUDGET_MS = 60_000;
const MAX_RETRIES = 1;
const PAGE_SIZE = 1000;

interface EsLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  logIndex: string;
  transactionHash: string;
  timeStamp?: string;
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
}

function loadEnvLocal(): Record<string, string> {
  const path = resolve(process.cwd(), ".env.local");
  const out: Record<string, string> = {};
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function padAddressTopic(addr: string): string {
  const a = getAddress(addr).toLowerCase().replace(/^0x/, "");
  return `0x${"0".repeat(24)}${a}`;
}

function parseMaybeHex(v: string): number {
  if (!v) return 0;
  return v.startsWith("0x") || v.startsWith("0X")
    ? Number.parseInt(v, 16)
    : Number.parseInt(v, 10);
}

function decodeLog(log: EsLog): DecodedEvent {
  const dataId = BigInt(log.topics[1]!).toString();
  const taskId = BigInt(log.topics[2]!).toString();
  const user = getAddress(`0x${log.topics[3]!.slice(26)}`);
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
    blockNumber: parseMaybeHex(log.blockNumber),
    logIndex: parseMaybeHex(log.logIndex),
    transactionHash: log.transactionHash.toLowerCase(),
  };
}

type FetchOutcome =
  | { ok: true; logs: EsLog[]; rawMessage: string }
  | {
      ok: false;
      kind: "rate_limit" | "plan" | "http" | "api" | "timeout" | "abort";
      detail: string;
    };

async function fetchLogsOnce(
  apiKey: string,
  page: number,
  signal: AbortSignal,
): Promise<FetchOutcome> {
  const topic3 = padAddressTopic(REF_WALLET);
  const params = new URLSearchParams({
    chainid: CHAIN_ID,
    module: "logs",
    action: "getLogs",
    address: CONTRACT,
    fromBlock: String(FROM_BLOCK),
    toBlock: "latest",
    topic0: TOPIC0,
    topic3,
    topic0_3_opr: "and",
    page: String(page),
    offset: String(PAGE_SIZE),
    apikey: apiKey,
  });

  const url = `${ENDPOINT}?${params.toString()}`;
  const safeUrl = url.replace(apiKey, "<REDACTED>");

  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (signal.aborted || /aborted|timeout/i.test(msg)) {
      return { ok: false, kind: "timeout", detail: msg };
    }
    return { ok: false, kind: "http", detail: msg };
  }

  const text = await res.text();
  let body: { status?: string; message?: string; result?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return {
      ok: false,
      kind: "http",
      detail: `Non-JSON HTTP ${res.status} from ${safeUrl}`,
    };
  }

  const message = String(body.message ?? "");
  const result = body.result;
  const resultStr =
    typeof result === "string" ? result : JSON.stringify(result ?? "");

  if (
    /rate limit|Max rate limit|too many requests/i.test(message) ||
    /rate limit|too many requests/i.test(resultStr)
  ) {
    return {
      ok: false,
      kind: "rate_limit",
      detail: `${message} | ${resultStr}`.slice(0, 300),
    };
  }

  if (
    /not supported|Free API|API Pro|upgrade|plan|invalid chainid|chain id/i.test(
      message + " " + resultStr,
    )
  ) {
    return {
      ok: false,
      kind: "plan",
      detail: `${message} | ${resultStr}`.slice(0, 400),
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      kind: "http",
      detail: `HTTP ${res.status}: ${message || resultStr}`.slice(0, 300),
    };
  }

  if (body.status === "0") {
    // Empty result is OK
    if (
      /No records found/i.test(message) ||
      /No records found/i.test(resultStr)
    ) {
      return { ok: true, logs: [], rawMessage: message };
    }
    return {
      ok: false,
      kind: "api",
      detail: `${message} | ${resultStr}`.slice(0, 400),
    };
  }

  if (!Array.isArray(result)) {
    return {
      ok: false,
      kind: "api",
      detail: `Unexpected result type: ${typeof result} | ${message}`.slice(
        0,
        400,
      ),
    };
  }

  return { ok: true, logs: result as EsLog[], rawMessage: message };
}

async function fetchLogsWithRetry(
  apiKey: string,
  page: number,
  deadline: number,
  stats: { http: number; retries: number; errors: string[] },
): Promise<FetchOutcome> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { ok: false, kind: "abort", detail: "global 60s budget exhausted" };
    }
    const timeout = Math.min(REQUEST_TIMEOUT_MS, remaining);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    stats.http += 1;
    try {
      const out = await fetchLogsOnce(apiKey, page, ctrl.signal);
      if (out.ok) return out;
      stats.errors.push(`${out.kind}: ${out.detail}`);
      if (out.kind === "rate_limit" || out.kind === "plan") return out;
      if (attempt < MAX_RETRIES) {
        stats.retries += 1;
        continue;
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, kind: "api", detail: "exhausted retries" };
}

function statsOf(events: DecodedEvent[]) {
  const tasks = new Set(events.map((e) => e.taskId));
  const scores = events.map((e) => e.score);
  const sum = scores.reduce((a, b) => a + b, 0);
  const avg = events.length ? Math.round((sum / events.length) * 100) / 100 : 0;
  return {
    total: events.length,
    uniqueTasks: tasks.size,
    avg,
    best: scores.length ? Math.max(...scores) : 0,
    worst: scores.length ? Math.min(...scores) : 0,
    ge70: scores.filter((s) => s >= 70).length,
    ge80: scores.filter((s) => s >= 80).length,
    ge90: scores.filter((s) => s >= 90).length,
  };
}

async function main() {
  const wallStart = Date.now();
  const deadline = wallStart + GLOBAL_BUDGET_MS;
  const env = loadEnvLocal();
  const apiKey = env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    console.log("API_KEY_AVAILABLE=NO");
    console.log("VERDICT=NOT SUITABLE");
    console.log("REASON=ETHERSCAN_API_KEY missing from .env.local");
    process.exit(1);
  }

  const stats = { http: 0, retries: 0, errors: [] as string[] };
  const allLogs: EsLog[] = [];
  let truncated = false;
  let page = 1;
  let baseSupported: "YES" | "NO" | "UNKNOWN" = "UNKNOWN";
  let getLogsSupported: "YES" | "NO" | "UNKNOWN" = "UNKNOWN";
  let requestWorked = false;
  let topic3Worked: "YES" | "NO" | "UNKNOWN" = "UNKNOWN";

  // Direct indexed query first (page 1). At most one extra page if exactly 1000.
  while (page <= 2) {
    const out = await fetchLogsWithRetry(apiKey, page, deadline, stats);
    if (!out.ok) {
      if (out.kind === "plan") {
        baseSupported = /chain|Base|8453/i.test(out.detail) ? "NO" : baseSupported;
        getLogsSupported = /getLogs|logs|Free API|Pro/i.test(out.detail)
          ? "NO"
          : getLogsSupported;
        console.log("ETHERSCAN_REQUEST_WORKED=NO");
        console.log(`BASE_SUPPORTED_FREE=${baseSupported}`);
        console.log(`GETLOGS_SUPPORTED_FREE=${getLogsSupported}`);
        console.log(`PLAN_OR_SUPPORT_ERROR=${out.detail}`);
        console.log(`HTTP_REQUESTS=${stats.http}`);
        console.log(`RETRIES=${stats.retries}`);
        console.log(`WALL_MS=${Date.now() - wallStart}`);
        console.log("VERDICT=NOT SUITABLE");
        console.log(`REASON=${out.detail.slice(0, 180)}`);
        return;
      }
      if (out.kind === "rate_limit") {
        console.log("ETHERSCAN_REQUEST_WORKED=NO");
        console.log("RATE_LIMITED=YES");
        console.log(`RATE_LIMIT_DETAIL=${out.detail}`);
        console.log(`HTTP_REQUESTS=${stats.http}`);
        console.log(`RETRIES=${stats.retries}`);
        console.log(`WALL_MS=${Date.now() - wallStart}`);
        console.log("VERDICT=NOT SUITABLE");
        console.log("REASON=Etherscan rate limited the getLogs request");
        return;
      }
      console.log("ETHERSCAN_REQUEST_WORKED=NO");
      console.log(`ERROR=${out.detail}`);
      console.log(`HTTP_REQUESTS=${stats.http}`);
      console.log(`RETRIES=${stats.retries}`);
      console.log(`WALL_MS=${Date.now() - wallStart}`);
      console.log("VERDICT=NOT SUITABLE");
      console.log(`REASON=${out.detail.slice(0, 180)}`);
      return;
    }

    requestWorked = true;
    baseSupported = "YES";
    getLogsSupported = "YES";
    allLogs.push(...out.logs);

    if (out.logs.length < PAGE_SIZE) {
      truncated = false;
      break;
    }
    // Exactly PAGE_SIZE → may be more; try one more page only.
    truncated = true;
    if (page === 1 && Date.now() < deadline - 2_000) {
      page += 1;
      continue;
    }
    break;
  }

  const byKey = new Map<string, DecodedEvent>();
  for (const log of allLogs) {
    try {
      const ev = decodeLog(log);
      byKey.set(`${ev.transactionHash}:${ev.logIndex}`, ev);
    } catch (err) {
      stats.errors.push(
        `decode: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const events = [...byKey.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber - b.blockNumber,
  );

  // Topic3 filter check: all users must match wallet (case-insensitive)
  const walletLc = REF_WALLET.toLowerCase();
  const mismatched = events.filter((e) => e.user.toLowerCase() !== walletLc);
  topic3Worked =
    events.length > 0 && mismatched.length === 0
      ? "YES"
      : events.length === 0
        ? "NO"
        : "NO";

  const s = statsOf(events);
  const known = events.find((e) => e.transactionHash === KNOWN_TX.toLowerCase());
  const knownFound = Boolean(known);
  const histEvents = events.filter((e) => e.blockNumber <= HIST_BOUNDARY_BLOCK);
  const newerEvents = events.filter((e) => e.blockNumber > HIST_BOUNDARY_BLOCK);
  const histStats = statsOf(histEvents);

  // Completeness heuristics vs verified snapshot
  const historicalLooksComplete =
    knownFound &&
    histStats.total >= HIST.total &&
    histStats.uniqueTasks >= HIST.uniqueTasks;

  let completeLabel = "unknown";
  if (truncated && events.length >= PAGE_SIZE) {
    completeLabel = "possibly_truncated_at_api_cap";
  } else if (historicalLooksComplete) {
    completeLabel = "appears_complete_vs_snapshot";
  } else if (knownFound && s.total >= HIST.total) {
    completeLabel = "at_or_above_snapshot_totals";
  } else if (knownFound) {
    completeLabel = "known_tx_found_but_below_snapshot";
  } else {
    completeLabel = "incomplete_or_missing_known_tx";
  }

  const wallMs = Date.now() - wallStart;

  let verdict: "SUITABLE" | "PARTIALLY SUITABLE" | "NOT SUITABLE" = "NOT SUITABLE";
  let reason = "";
  if (
    requestWorked &&
    topic3Worked === "YES" &&
    knownFound &&
    historicalLooksComplete &&
    wallMs < GLOBAL_BUDGET_MS &&
    stats.errors.filter((e) => e.startsWith("rate")).length === 0 &&
    !truncated
  ) {
    verdict = "SUITABLE";
    reason =
      "Indexed topic3 wallet filter returned complete historical logs within budget.";
  } else if (
    requestWorked &&
    topic3Worked === "YES" &&
    knownFound &&
    s.total >= HIST.total * 0.95
  ) {
    verdict = "PARTIALLY SUITABLE";
    reason = truncated
      ? "Data looks right but may hit the 1000-result API cap / pagination limits."
      : "Filtering works and known tx found, but completeness/reliability is questionable.";
  } else if (!knownFound) {
    verdict = "NOT SUITABLE";
    reason = "Known reference transaction missing from Etherscan getLogs results.";
  } else if (topic3Worked !== "YES") {
    verdict = "NOT SUITABLE";
    reason = "Server-side topic3 wallet filtering did not produce a clean wallet set.";
  } else {
    verdict = "NOT SUITABLE";
    reason = "Results incomplete or did not meet suitability criteria.";
  }

  console.log("=== ETHERSCAN V2 BASE PoC ===");
  console.log(`ENDPOINT=${ENDPOINT}`);
  console.log(`ETHERSCAN_REQUEST_WORKED=${requestWorked ? "YES" : "NO"}`);
  console.log(`BASE_SUPPORTED_FREE=${baseSupported}`);
  console.log(`GETLOGS_SUPPORTED_FREE=${getLogsSupported}`);
  console.log(`TOPIC3_FILTER_WORKED=${topic3Worked}`);
  console.log(`TOTAL_EVENTS=${s.total}`);
  console.log(`UNIQUE_TASKS=${s.uniqueTasks}`);
  console.log(`AVG_SCORE=${s.avg}`);
  console.log(`BEST=${s.best}`);
  console.log(`WORST=${s.worst}`);
  console.log(`GE70=${s.ge70}`);
  console.log(`GE80=${s.ge80}`);
  console.log(`GE90=${s.ge90}`);
  console.log(`KNOWN_TX_FOUND=${knownFound}`);
  if (known) {
    console.log(
      `KNOWN_TX_FIELDS=block=${known.blockNumber} dataId=${known.dataId} taskId=${known.taskId} score=${known.score} simulationTime=${known.simulationTime}`,
    );
  }
  console.log(`HIST_BOUNDARY_BLOCK=${HIST_BOUNDARY_BLOCK}`);
  console.log(`EVENTS_THROUGH_BOUNDARY=${histEvents.length}`);
  console.log(`EVENTS_NEWER_THAN_BOUNDARY=${newerEvents.length}`);
  console.log(
    `HIST_STATS=total=${histStats.total} unique=${histStats.uniqueTasks} avg=${histStats.avg} best=${histStats.best} worst=${histStats.worst} ge70=${histStats.ge70} ge80=${histStats.ge80} ge90=${histStats.ge90}`,
  );
  console.log(`SNAPSHOT_REF=776/750/68.12/96/0/429/338/176`);
  console.log(`HTTP_REQUESTS=${stats.http}`);
  console.log(`RETRIES=${stats.retries}`);
  console.log(`ERRORS=${stats.errors.length ? stats.errors.join(" || ") : "none"}`);
  console.log(`WALL_MS=${wallMs}`);
  console.log(`COMPLETE_OR_TRUNCATED=${completeLabel}`);
  console.log(`RAW_LOG_COUNT=${allLogs.length}`);
  console.log(`DEDUPED_COUNT=${events.length}`);
  console.log(`MISMATCHED_USERS=${mismatched.length}`);
  console.log(`VERDICT=${verdict}`);
  console.log(`REASON=${reason}`);
}

main().catch((err) => {
  console.log("ETHERSCAN_REQUEST_WORKED=NO");
  console.log(`FATAL=${err instanceof Error ? err.message : String(err)}`);
  console.log("VERDICT=NOT SUITABLE");
  process.exit(1);
});
