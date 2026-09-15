/**
 * Read-only audit: reference wallet Hub cache vs API total.
 * Limited Hub GETs for reconciliation only.
 */
import Database from "better-sqlite3";
import path from "node:path";
import {
  closeDatabase,
  getCachedHubAttempts,
  getHubWalletCache,
  openDatabase,
} from "../src/lib/db";
import {
  HUB_SEARCH_ATTEMPTS_URL,
  normalizeHubTxhash,
  parseHubAttemptItem,
} from "../src/lib/hub-attempts";
import { REFERENCE_WALLET } from "../src/lib/fixtures/reference-wallet";

const ADDR = REFERENCE_WALLET.toLowerCase();
const MAX_HTTP = 10;
const MAX_MS = 90_000;

async function main() {
  openDatabase();
  const db = new Database(path.join(process.cwd(), "data", "axis-index.db"), {
    readonly: true,
  });

  const cache = getHubWalletCache(ADDR);
  const rows = getCachedHubAttempts(ADDR);
  const ids = new Set(rows.map((r) => r.attemptId));
  let withTx = 0;
  let withoutTx = 0;
  for (const r of rows) {
    if (normalizeHubTxhash(r.txhash)) withTx += 1;
    else withoutTx += 1;
  }

  console.log(
    JSON.stringify(
      {
        phase: "cache",
        cache,
        uniqueRows: rows.length,
        uniqueAttemptIds: ids.size,
        withTx,
        withoutTx,
        sum: withTx + withoutTx,
      },
      null,
      2,
    ),
  );

  const started = Date.now();
  let http = 0;
  async function getPage(page: number, perPage = 100) {
    if (http >= MAX_HTTP) throw new Error("HTTP limit");
    if (Date.now() - started > MAX_MS) throw new Error("time limit");
    http += 1;
    const url = new URL(HUB_SEARCH_ATTEMPTS_URL);
    url.searchParams.set("q", REFERENCE_WALLET);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    const t0 = Date.now();
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    const body = await res.json();
    return {
      status: res.status,
      ms: Date.now() - t0,
      total: body.total as number,
      page: body.page as number,
      per_page: body.per_page as number,
      total_pages: body.total_pages as number,
      itemCount: Array.isArray(body.items) ? body.items.length : 0,
      items: (body.items ?? []) as unknown[],
    };
  }

  // Page 1 metadata + per-page sizes for all pages (up to 9 + maybe extras)
  const page1 = await getPage(1);
  const totalPages = page1.total_pages;
  const apiTotal = page1.total;
  const pageStats: Array<{
    page: number;
    itemCount: number;
    parsedOk: number;
    parseFail: number;
    newIds: number;
    alreadyCached: number;
    ids: number[];
  }> = [];

  const liveIds = new Set<number>();
  let parseFailTotal = 0;
  const crossPageDup = new Map<number, number[]>();

  async function ingest(pageNum: number, items: unknown[]) {
    let parsedOk = 0;
    let parseFail = 0;
    let newIds = 0;
    let alreadyCached = 0;
    const pageIds: number[] = [];
    for (const item of items) {
      const parsed = parseHubAttemptItem(item);
      if (!parsed) {
        parseFail += 1;
        parseFailTotal += 1;
        continue;
      }
      parsedOk += 1;
      pageIds.push(parsed.attemptId);
      if (crossPageDup.has(parsed.attemptId)) {
        crossPageDup.get(parsed.attemptId)!.push(pageNum);
      } else {
        crossPageDup.set(parsed.attemptId, [pageNum]);
      }
      if (!liveIds.has(parsed.attemptId)) {
        liveIds.add(parsed.attemptId);
        newIds += 1;
      }
      if (ids.has(parsed.attemptId)) alreadyCached += 1;
    }
    pageStats.push({
      page: pageNum,
      itemCount: items.length,
      parsedOk,
      parseFail,
      newIds,
      alreadyCached,
      ids: pageIds,
    });
  }

  await ingest(1, page1.items);

  for (let p = 2; p <= totalPages && http < MAX_HTTP; p++) {
    const pg = await getPage(p);
    await ingest(p, pg.items);
  }

  const idsOnlyOnApi = [...liveIds].filter((id) => !ids.has(id));
  const idsOnlyInCache = [...ids].filter((id) => !liveIds.has(id));
  const multiPageIds = [...crossPageDup.entries()].filter(
    ([, pages]) => pages.length > 1,
  );

  // Sum of page item counts vs unique
  const sumPageItems = pageStats.reduce((a, p) => a + p.itemCount, 0);
  const sumParsed = pageStats.reduce((a, p) => a + p.parsedOk, 0);

  console.log(
    JSON.stringify(
      {
        phase: "reconcile",
        http,
        runtimeMs: Date.now() - started,
        apiTotal,
        totalPages,
        pageStats: pageStats.map(({ ids: _ids, ...rest }) => rest),
        sumPageItems,
        sumParsed,
        parseFailTotal,
        liveUniqueIds: liveIds.size,
        cachedUniqueIds: ids.size,
        gapApiTotalVsLiveUnique: apiTotal - liveIds.size,
        gapApiTotalVsCached: apiTotal - ids.size,
        idsOnlyOnApiSample: idsOnlyOnApi.slice(0, 10),
        idsOnlyOnApiCount: idsOnlyOnApi.length,
        idsOnlyInCacheCount: idsOnlyInCache.length,
        idsOnlyInCacheSample: idsOnlyInCache.slice(0, 10),
        crossPageDuplicateAttemptIds: multiPageIds.length,
        crossPageDupSample: multiPageIds.slice(0, 5).map(([id, pages]) => ({
          id,
          pages,
        })),
      },
      null,
      2,
    ),
  );

  // Probe public leaderboard-ish endpoints (read-only, no auth)
  const probes: Array<{ url: string; status: number; preview: string }> = [];
  const probeUrls = [
    `https://hub.axisrobotics.ai/api/stats/leaderboard?q=${REFERENCE_WALLET}`,
    `https://hub.axisrobotics.ai/api/stats/leaderboard?search=${REFERENCE_WALLET}`,
    `https://hub.axisrobotics.ai/api/stats/leaderboard?wallet=${REFERENCE_WALLET}`,
    `https://hub.axisrobotics.ai/api/leaderboard?q=${REFERENCE_WALLET}`,
    `https://hub.axisrobotics.ai/api/stats/search-attempts?q=${REFERENCE_WALLET}&page=1&per_page=1`,
    `https://hub.axisrobotics.ai/api/me/profile`,
  ];
  for (const u of probeUrls) {
    if (http >= MAX_HTTP) break;
    if (Date.now() - started > MAX_MS) break;
    http += 1;
    try {
      const res = await fetch(u, {
        headers: { Accept: "application/json" },
        credentials: "omit",
      });
      const text = await res.text();
      probes.push({
        url: u.replace(REFERENCE_WALLET, "<wallet>"),
        status: res.status,
        preview: text.slice(0, 280),
      });
    } catch (e) {
      probes.push({
        url: u,
        status: 0,
        preview: String(e),
      });
    }
  }

  console.log(JSON.stringify({ phase: "api_probes", http, probes }, null, 2));

  db.close();
  closeDatabase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
