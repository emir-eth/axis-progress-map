/**
 * EXPERIMENTAL seed feasibility test — NOT used by the app.
 *
 * Question: Can Blockscout return ONE DAY of global Axis RecordSubmitted
 * logs quickly enough to make a one-time seed practical?
 *
 * Hard limits: 60s wall · 20 HTTP requests · stop on rate limit.
 *
 * Usage: npx tsx scripts/test-blockscout-seed-day.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENDPOINT = "https://base.blockscout.com/api";
const CONTRACT = "0xF91A90baA9E044Da084df369445A59D859d640dB";
const TOPIC0 =
  "0x6d77e907890f072253fbef2eb8d17cd30e09e409799f01195372185adc5313fd";

const DAY_UTC = "2026-09-09";
const DAY_START_MS = Date.parse(`${DAY_UTC}T00:00:00.000Z`);
const DAY_END_MS = Date.parse(`${DAY_UTC}T23:59:59.999Z`);

const MAX_WALL_MS = 60_000;
const MAX_HTTP = 20;
const PAGE_CAP = 1000; // Blockscout getLogs max

interface BsLog {
  blockNumber: string;
  logIndex: string;
  transactionHash: string;
  timeStamp?: string;
}

type Verdict = "SUITABLE" | "PARTIALLY SUITABLE" | "NOT SUITABLE";

const started = Date.now();
let httpRequests = 0;
let rateLimited = false;
let hardStopReason: string | null = null;
const errors: string[] = [];

function elapsed() {
  return Date.now() - started;
}

function remainingMs() {
  return MAX_WALL_MS - elapsed();
}

function stop(reason: string): never {
  hardStopReason = reason;
  throw new Error(`STOP: ${reason}`);
}

function checkBudget() {
  if (elapsed() >= MAX_WALL_MS) stop("60s wall-time exceeded");
  if (httpRequests >= MAX_HTTP) stop("20 HTTP request budget exhausted");
}

async function bsGet(params: Record<string, string>): Promise<unknown> {
  checkBudget();
  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  httpRequests += 1;
  const controller = new AbortController();
  const t = setTimeout(
    () => controller.abort(),
    Math.max(1_000, Math.min(15_000, remainingMs())),
  );

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "AxisProgressMap-SeedFeasibility/0.1",
      },
    });

    if (res.status === 429) {
      rateLimited = true;
      stop("HTTP 429 rate limit");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      status?: string;
      message?: string;
      result?: unknown;
    };

    // Etherscan-compat error shapes
    if (
      typeof json.message === "string" &&
      /rate limit|too many|429/i.test(json.message)
    ) {
      rateLimited = true;
      stop(`Rate limit message: ${json.message}`);
    }

    return json;
  } finally {
    clearTimeout(t);
  }
}

function parseBlockHexOrDec(v: string | number): number {
  if (typeof v === "number") return v;
  if (v.startsWith("0x") || v.startsWith("0X")) return Number.parseInt(v, 16);
  return Number.parseInt(v, 10);
}

async function blockByTime(
  unixSec: number,
  closest: "before" | "after",
): Promise<number> {
  const json = (await bsGet({
    module: "block",
    action: "getblocknobytime",
    timestamp: String(unixSec),
    closest,
  })) as { status?: string; result?: string | { blockNumber?: string }; message?: string };

  const raw =
    typeof json.result === "string"
      ? json.result
      : json.result?.blockNumber ?? null;
  if (raw == null || raw === "") {
    throw new Error(
      `getblocknobytime failed: ${json.message ?? JSON.stringify(json).slice(0, 180)}`,
    );
  }
  return parseBlockHexOrDec(raw);
}

async function getLogsRange(
  fromBlock: number,
  toBlock: number,
): Promise<BsLog[]> {
  const json = (await bsGet({
    module: "logs",
    action: "getLogs",
    fromBlock: String(fromBlock),
    toBlock: String(toBlock),
    address: CONTRACT,
    topic0: TOPIC0,
  })) as {
    status?: string;
    message?: string;
    result?: BsLog[] | string;
  };

  if (typeof json.result === "string") {
    if (/rate limit|too many/i.test(json.result)) {
      rateLimited = true;
      stop(`Rate limit in result: ${json.result}`);
    }
    // Empty / error string
    if (json.status === "0") {
      errors.push(`getLogs ${fromBlock}-${toBlock}: ${json.result}`);
      return [];
    }
    throw new Error(`Unexpected string result: ${json.result.slice(0, 160)}`);
  }

  if (!Array.isArray(json.result)) {
    errors.push(
      `getLogs ${fromBlock}-${toBlock}: non-array result (${json.message ?? "unknown"})`,
    );
    return [];
  }

  return json.result;
}

function dedupeKey(log: BsLog): string {
  const tx = (log.transactionHash || "").toLowerCase();
  const li =
    log.logIndex?.startsWith("0x") || log.logIndex?.startsWith("0X")
      ? Number.parseInt(log.logIndex, 16)
      : Number.parseInt(log.logIndex || "0", 10);
  return `${tx}:${li}`;
}

function blockOf(log: BsLog): number {
  return parseBlockHexOrDec(log.blockNumber);
}

/**
 * Fetch one day with adaptive split when a window returns PAGE_CAP rows
 * (likely truncated). Respects request/time budgets.
 */
async function fetchDayLogs(
  fromBlock: number,
  toBlock: number,
): Promise<{
  logs: BsLog[];
  splittingRequired: boolean;
  windows: number;
}> {
  const queue: Array<{ from: number; to: number }> = [{ from: fromBlock, to: toBlock }];
  const seen = new Map<string, BsLog>();
  let splittingRequired = false;
  let windows = 0;

  while (queue.length > 0) {
    checkBudget();
    const { from, to } = queue.shift()!;
    windows += 1;
    const batch = await getLogsRange(from, to);

    if (batch.length >= PAGE_CAP && from < to) {
      splittingRequired = true;
      const mid = Math.floor((from + to) / 2);
      // Re-queue halves; do not keep possibly truncated full-window batch alone
      queue.unshift({ from: mid + 1, to });
      queue.unshift({ from, to: mid });
      continue;
    }

    for (const log of batch) {
      seen.set(dedupeKey(log), log);
    }
  }

  return {
    logs: [...seen.values()],
    splittingRequired,
    windows,
  };
}

async function main() {
  let fromBlock = 0;
  let toBlock = 0;
  let totalLogs = 0;
  let splittingRequired = false;
  let windows = 0;
  let complete: "YES" | "NO" | "UNCERTAIN" = "UNCERTAIN";
  let verdict: Verdict = "NOT SUITABLE";
  let samplePath: string | null = null;

  try {
    console.log(
      JSON.stringify({
        phase: "start",
        day: DAY_UTC,
        endpoint: ENDPOINT,
        maxWallMs: MAX_WALL_MS,
        maxHttp: MAX_HTTP,
      }),
    );

    // Lightweight date → block via Blockscout (2 requests)
    const startUnix = Math.floor(DAY_START_MS / 1000);
    const endUnix = Math.floor(DAY_END_MS / 1000);
    fromBlock = await blockByTime(startUnix, "after");
    toBlock = await blockByTime(endUnix, "before");

    if (fromBlock > toBlock) {
      // Edge: flip closest if API returns inverted
      const a = fromBlock;
      fromBlock = Math.min(a, toBlock);
      toBlock = Math.max(a, toBlock);
    }

    console.log(
      JSON.stringify({
        phase: "block_range",
        fromBlock,
        toBlock,
        span: toBlock - fromBlock + 1,
        httpRequests,
        elapsedMs: elapsed(),
      }),
    );

    const result = await fetchDayLogs(fromBlock, toBlock);
    totalLogs = result.logs.length;
    splittingRequired = result.splittingRequired;
    windows = result.windows;

    // Completeness heuristics
    if (rateLimited || hardStopReason) {
      complete = "NO";
    } else if (splittingRequired && result.logs.length > 0) {
      // Split until each window < PAGE_CAP — likely complete for the day
      complete = "YES";
    } else if (!splittingRequired && result.logs.length < PAGE_CAP) {
      complete = "YES";
    } else if (!splittingRequired && result.logs.length >= PAGE_CAP) {
      // Hit cap without split chance (single block?) — uncertain
      complete = "UNCERTAIN";
    } else {
      complete = "UNCERTAIN";
    }

    // Sort by block for sample file
    const sorted = [...result.logs].sort(
      (a, b) => blockOf(a) - blockOf(b) || dedupeKey(a).localeCompare(dedupeKey(b)),
    );

    samplePath = path.join(
      os.tmpdir(),
      `axis-blockscout-seed-${DAY_UTC}.json`,
    );
    fs.writeFileSync(
      samplePath,
      JSON.stringify(
        {
          day: DAY_UTC,
          contract: CONTRACT,
          topic0: TOPIC0,
          fromBlock,
          toBlock,
          totalLogs,
          logs: sorted.map((l) => ({
            transactionHash: l.transactionHash,
            logIndex: l.logIndex,
            blockNumber: l.blockNumber,
            timeStamp: l.timeStamp ?? null,
          })),
        },
        null,
        2,
      ),
      "utf8",
    );

    // Verdict for one-day seed practicality
    if (
      !rateLimited &&
      !hardStopReason &&
      complete === "YES" &&
      httpRequests <= MAX_HTTP &&
      elapsed() < MAX_WALL_MS
    ) {
      verdict =
        httpRequests <= 8 && elapsed() < 20_000
          ? "SUITABLE"
          : "PARTIALLY SUITABLE";
    } else if (totalLogs > 0 && !rateLimited) {
      verdict = "PARTIALLY SUITABLE";
    } else {
      verdict = "NOT SUITABLE";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!hardStopReason && msg.startsWith("STOP:")) {
      hardStopReason = msg.slice(5).trim();
    } else if (!hardStopReason) {
      hardStopReason = msg;
      errors.push(msg);
    }
    if (rateLimited || /rate limit|60s|20 HTTP/i.test(hardStopReason ?? "")) {
      verdict = "NOT SUITABLE";
      complete = "NO";
    } else if (totalLogs > 0) {
      verdict = "PARTIALLY SUITABLE";
      complete = "UNCERTAIN";
    } else {
      verdict = "NOT SUITABLE";
      complete = "NO";
    }
  }

  // Rough full-seed practicality note (from deployment ~43731412 to ~head)
  const daySpan = Math.max(1, toBlock - fromBlock + 1);
  const approxDaysSinceDeploy =
    fromBlock > 0 ? Math.max(1, Math.round((fromBlock - 43_731_412) / daySpan)) : null;

  const report = {
    phase: "final",
    endpoint: `${ENDPOINT}?module=logs&action=getLogs (+ module=block&action=getblocknobytime)`,
    day: DAY_UTC,
    fromBlock,
    toBlock,
    totalLogs,
    httpRequests,
    wallTimeMs: elapsed(),
    rateLimited,
    hardStopReason,
    errors: errors.slice(0, 5),
    paginationOrSplittingRequired: splittingRequired,
    windowsFetched: windows,
    appearsComplete: complete,
    verdict,
    samplePath,
    estimatedFullSeedNote:
      approxDaysSinceDeploy == null
        ? "Could not estimate — day range incomplete."
        : `One day used ~${httpRequests} HTTP / ${elapsed()}ms for ${totalLogs} logs. Roughly ~${approxDaysSinceDeploy} similar days from deployment would multiply cost; at this rate full seed ≈ ${approxDaysSinceDeploy * httpRequests} requests and ~${Math.round((approxDaysSinceDeploy * elapsed()) / 60000)} minutes if linear (optimistic; rate limits make this worse).`,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
