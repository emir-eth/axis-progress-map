/**
 * Bounded reconciliation: API attempt IDs vs cache for stuck Hub wallets.
 * Max ~19 pages per wallet, concurrency 1, no Base.
 */
import {
  closeDatabase,
  getCachedHubAttempts,
  getHubWalletCache,
  openDatabase,
} from "../src/lib/db";
import {
  HUB_SEARCH_ATTEMPTS_URL,
  parseHubAttemptItem,
} from "../src/lib/hub-attempts";

const WALLETS = [
  "0x612cdfef8db47eea34b036b895fe5a6f477616d5",
  "0x0d1a77989c204468173ff4e37d1ce95f46e0d81e",
] as const;

type Diagnose = {
  attempt_id: unknown;
  attempt_id_type: string;
  task_id: unknown;
  task_id_type: string;
  score: unknown;
  score_type: string;
  unusual: string[];
  parseOk: boolean;
  rejectReason: string | null;
};

function diagnoseRow(item: Record<string, unknown>): Diagnose {
  const unusual: string[] = [];
  for (const [k, v] of Object.entries(item)) {
    if (v === null) unusual.push(`${k}=null`);
    else if (v === undefined) unusual.push(`${k}=undefined`);
    else if (v === "") unusual.push(`${k}=empty`);
  }
  const attemptId = item.attempt_id;
  const taskId = item.task_id;
  const score = item.score;

  let rejectReason: string | null = null;
  const parsed = parseHubAttemptItem(item);
  if (!parsed) {
    if (attemptId == null) rejectReason = "missing/invalid attempt_id";
    else if (taskId == null || taskId === "")
      rejectReason = "missing/invalid task_id (currently required)";
    else if (score !== null && score !== undefined) {
      const n = typeof score === "number" ? score : Number(score);
      if (!Number.isFinite(n)) rejectReason = "unparseable non-null score";
      else rejectReason = "unknown parse reject";
    } else rejectReason = "unknown parse reject";
  }

  return {
    attempt_id: attemptId,
    attempt_id_type: typeof attemptId,
    task_id: taskId,
    task_id_type: typeof taskId,
    score,
    score_type: score === null ? "null" : typeof score,
    unusual,
    parseOk: parsed != null,
    rejectReason,
  };
}

async function fetchAllPages(wallet: string) {
  const url0 = new URL(HUB_SEARCH_ATTEMPTS_URL);
  url0.searchParams.set("q", wallet);
  url0.searchParams.set("page", "1");
  url0.searchParams.set("per_page", "100");
  const res1 = await fetch(url0.toString(), {
    headers: { Accept: "application/json" },
    credentials: "omit",
  });
  const body1 = (await res1.json()) as {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
    items: Record<string, unknown>[];
  };

  const pages = [body1];
  let http = 1;
  for (let p = 2; p <= body1.total_pages; p++) {
    const url = new URL(HUB_SEARCH_ATTEMPTS_URL);
    url.searchParams.set("q", wallet);
    url.searchParams.set("page", String(p));
    url.searchParams.set("per_page", "100");
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    http += 1;
    const body = (await res.json()) as typeof body1;
    pages.push(body);
  }

  const allItems: Record<string, unknown>[] = [];
  const pageSizes: number[] = [];
  const idPages = new Map<number, number[]>();
  let nullAttemptId = 0;
  for (const pg of pages) {
    pageSizes.push(pg.items?.length ?? 0);
    for (const item of pg.items ?? []) {
      allItems.push(item);
      const id = item.attempt_id;
      if (typeof id !== "number" || !Number.isFinite(id)) {
        nullAttemptId += 1;
        continue;
      }
      const list = idPages.get(id) ?? [];
      list.push(pg.page);
      idPages.set(id, list);
    }
  }

  const uniqueIds = [...idPages.keys()];
  const crossPageDups = [...idPages.entries()].filter(([, ps]) => ps.length > 1);

  return {
    http,
    apiTotal: body1.total,
    totalPages: body1.total_pages,
    pageSizes,
    rowsReturned: allItems.length,
    uniqueIds,
    uniqueCount: uniqueIds.length,
    nullAttemptId,
    crossPageDupCount: crossPageDups.length,
    crossPageDupSample: crossPageDups.slice(0, 5).map(([id, ps]) => ({
      id,
      pages: ps,
    })),
    allItems,
    idPages,
  };
}

async function main() {
  openDatabase();
  const reports = [];

  for (const wallet of WALLETS) {
    const cache = getHubWalletCache(wallet);
    const cached = getCachedHubAttempts(wallet);
    const cachedIds = new Set(cached.map((r) => r.attemptId));

    const live = await fetchAllPages(wallet);
    const apiIdSet = new Set(live.uniqueIds);
    const missingFromCache = live.uniqueIds.filter((id) => !cachedIds.has(id));
    const onlyInCache = [...cachedIds].filter((id) => !apiIdSet.has(id));

    const missingRows = live.allItems.filter((item) => {
      const id = item.attempt_id;
      return typeof id === "number" && missingFromCache.includes(id);
    });

    // Also find rows that fail parse among ALL live items
    const parseFails: Diagnose[] = [];
    for (const item of live.allItems) {
      const d = diagnoseRow(item);
      if (!d.parseOk) parseFails.push(d);
    }

    const missingDiagnoses = missingRows.map((item) => diagnoseRow(item));

    reports.push({
      wallet,
      cache,
      cachedCount: cached.length,
      apiTotal: live.apiTotal,
      apiRowsReturned: live.rowsReturned,
      apiUniqueIds: live.uniqueCount,
      gapTotalVsUnique: live.apiTotal - live.uniqueCount,
      pageSizes: live.pageSizes,
      http: live.http,
      nullAttemptId: live.nullAttemptId,
      crossPageDupCount: live.crossPageDupCount,
      crossPageDupSample: live.crossPageDupSample,
      missingFromCacheCount: missingFromCache.length,
      missingFromCacheIds: missingFromCache.slice(0, 50),
      onlyInCacheCount: onlyInCache.length,
      onlyInCacheSample: onlyInCache.slice(0, 20),
      missingDiagnoses,
      parseFailCount: parseFails.length,
      parseFails: parseFails.slice(0, 20),
      countMatchesTotal: cached.length === live.apiTotal,
      pagesVisitedGap:
        (cache?.totalPages ?? 0) - (cache?.lastCompletedPage ?? 0),
    });
  }

  console.log(JSON.stringify(reports, null, 2));
  closeDatabase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
