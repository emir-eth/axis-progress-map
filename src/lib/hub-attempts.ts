/**
 * Read-only Axis Hub attempt history — primary profile data source.
 *
 * GET https://hub.axisrobotics.ai/api/stats/search-attempts
 *   ?q=<wallet>&page=N&per_page=100
 *
 * No cookies, no Authorization, no /api/me/*.
 * Ordering (verified from live API): page 1 is newest-first by attempt_id.
 */
import type { HubAttemptContribution } from "@/types";
import {
  clearHubAttemptsForAddress,
  computeHubFetchPercent,
  countHubAttempts,
  getCachedHubAttempts,
  getHubWalletCache,
  getKnownHubAttemptIds,
  markHubWalletCacheError,
  persistHubPageProgress,
  touchHubWalletCacheFreshness,
  type HubAttemptRecord,
  type HubWalletCacheRow,
} from "@/lib/db";

export const HUB_SEARCH_ATTEMPTS_URL =
  "https://hub.axisrobotics.ai/api/stats/search-attempts";

export const HUB_PER_PAGE = 100;
export const HUB_PAGE_TIMEOUT_MS = 15_000;
/** Default freshness window for a complete Hub cache. */
export const DEFAULT_HUB_CACHE_MAX_AGE_MS = 5 * 60_000;
/** Per-request Hub page fetch budget (resumable across requests). */
export const DEFAULT_HUB_FETCH_BUDGET_MS = 45_000;

export type HubFetchImpl = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export interface HubPagePayload {
  items: unknown[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export type HubPageResult =
  | { ok: true; page: HubPagePayload; httpStatus: number }
  | {
      ok: false;
      httpStatus: number;
      rateLimited: boolean;
      retryable: boolean;
      error: string;
    };

export interface HubEnsureResult {
  status: "complete" | "incomplete";
  totalAttempts: number;
  fetchedAttempts: number;
  lastCompletedPage: number;
  totalPages: number;
  perPage: number;
  updatedAt: number | null;
  httpRequests: number;
  warnings: string[];
  rateLimited: boolean;
  stale: boolean;
  /** True when we served complete cache without refetching all pages. */
  fromCache: boolean;
  /**
   * True when a reconciliation pass already failed for this snapshot total.
   * Soft auto-resume should stop until the Hub total changes or a forced refresh.
   */
  reconciliationExhausted?: boolean;
}

/** Persisted last_error marker — one reconcile per snapshot total. */
export const HUB_RECONCILE_EXHAUSTED_PREFIX = "hub-reconcile-exhausted:";

export function isHubReconcileExhaustedForTotal(
  lastError: string | null | undefined,
  totalAttempts: number,
): boolean {
  if (!lastError?.startsWith(HUB_RECONCILE_EXHAUSTED_PREFIX)) return false;
  return lastError.includes(`total=${totalAttempts}`);
}

export function formatHubReconcileExhaustedError(
  totalAttempts: number,
  cached: number,
): string {
  return `${HUB_RECONCILE_EXHAUSTED_PREFIX} total=${totalAttempts} cached=${cached}`;
}

export function getHubCacheMaxAgeMs(): number {
  const raw = process.env.AXIS_HUB_CACHE_MAX_AGE_MS?.trim();
  if (!raw) return DEFAULT_HUB_CACHE_MAX_AGE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HUB_CACHE_MAX_AGE_MS;
}

export function getHubFetchBudgetMs(): number {
  const raw = process.env.AXIS_HUB_FETCH_BUDGET_MS?.trim();
  if (!raw) return DEFAULT_HUB_FETCH_BUDGET_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HUB_FETCH_BUDGET_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Normalize Hub txhash to 0x-prefixed form, or null. */
export function normalizeHubTxhash(
  raw: string | null | undefined,
): `0x${string}` | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const hex = s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return `0x${hex.toLowerCase()}` as `0x${string}`;
}

export function parseHubAttemptItem(
  item: unknown,
): HubAttemptRecord | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const attemptId = asNumber(row.attempt_id);
  const taskId = asString(row.task_id);
  // score may be null on Hub — keep the row; do not coerce to 0
  const score =
    row.score === null || row.score === undefined
      ? null
      : asNumber(row.score);
  if (attemptId == null || taskId == null) return null;
  if (row.score !== null && row.score !== undefined && score == null) {
    // Non-null but unparseable score → reject
    return null;
  }

  const chain =
    row.chain_data && typeof row.chain_data === "object"
      ? (row.chain_data as Record<string, unknown>)
      : null;

  const dataId =
    (chain ? asString(chain.data_id) : null) ??
    asString(row.attempt_id);

  return {
    attemptId,
    taskId,
    taskName: asString(row.task_name),
    score,
    completedAt: asString(row.completed_at),
    createdAt: asString(row.created_at),
    simulationTimeSeconds: asNumber(row.simulation_time_seconds),
    txhash: asString(row.txhash),
    theme: asString(row.theme),
    userId: asNumber(row.user_id),
    username: asString(row.username),
    operatorShort: asString(row.operator_short),
    qualityRating: asString(row.quality_rating),
    modelId: asString(row.model_id),
    dataId,
    chainTaskId: chain ? asString(chain.task_id) : null,
    chainScore: chain ? asNumber(chain.score) : null,
    chainId: chain ? asNumber(chain.chain_id) : null,
    simulationTime: chain ? asNumber(chain.simulation_time) : null,
    contractAddress: chain ? asString(chain.contract_address) : null,
    serverSignature: chain ? asString(chain.server_signature) : null,
    chainDataJson: chain ? JSON.stringify(chain) : null,
    rawJson: JSON.stringify(row),
  };
}

export function hubRecordToContribution(
  address: `0x${string}`,
  r: HubAttemptRecord,
): HubAttemptContribution {
  const simFromChain = r.simulationTime;
  const simFromSeconds =
    r.simulationTimeSeconds != null
      ? Math.round(r.simulationTimeSeconds * 1000)
      : 0;
  let timestamp: number | null = null;
  if (r.completedAt) {
    const ms = Date.parse(r.completedAt);
    if (Number.isFinite(ms)) timestamp = Math.floor(ms / 1000);
  }

  return {
    attemptId: r.attemptId,
    dataId: r.dataId ?? String(r.attemptId),
    taskId: r.taskId,
    user: address,
    score: r.score,
    simulationTime: simFromChain ?? simFromSeconds,
    blockNumber: null,
    transactionHash: normalizeHubTxhash(r.txhash),
    logIndex: 0,
    timestamp,
    taskNameHint: r.taskName,
    themeHint: r.theme,
    source: "hub",
  };
}

function parsePagePayload(body: unknown): HubPagePayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const total = asNumber(b.total);
  const page = asNumber(b.page);
  const perPage = asNumber(b.per_page);
  const totalPages = asNumber(b.total_pages);
  if (
    total == null ||
    page == null ||
    perPage == null ||
    totalPages == null ||
    !Array.isArray(b.items)
  ) {
    return null;
  }
  return {
    items: b.items,
    total,
    page,
    per_page: perPage,
    total_pages: totalPages,
  };
}

/**
 * Fetch one Hub search-attempts page (public, unauthenticated).
 * At most one retry on transient 500/502/503.
 */
export async function fetchHubAttemptsPage(
  wallet: string,
  page: number,
  options?: {
    perPage?: number;
    fetchImpl?: HubFetchImpl;
    timeoutMs?: number;
    /** When true, skip the single retry (used after first failure). */
    isRetry?: boolean;
  },
): Promise<HubPageResult> {
  const perPage = options?.perPage ?? HUB_PER_PAGE;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? HUB_PAGE_TIMEOUT_MS;
  const url = new URL(HUB_SEARCH_ATTEMPTS_URL);
  url.searchParams.set("q", wallet);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; AxisProgressMap/0.1)",
      },
      cache: "no-store",
      credentials: "omit",
    });

    if (res.status === 429) {
      return {
        ok: false,
        httpStatus: 429,
        rateLimited: true,
        retryable: false,
        error: "Hub rate limited (429)",
      };
    }

    if (res.status === 500 || res.status === 502 || res.status === 503) {
      if (!options?.isRetry) {
        await sleep(400 + Math.floor(Math.random() * 400));
        return fetchHubAttemptsPage(wallet, page, {
          ...options,
          isRetry: true,
        });
      }
      return {
        ok: false,
        httpStatus: res.status,
        rateLimited: false,
        retryable: true,
        error: `Hub transient error (${res.status})`,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        rateLimited: false,
        retryable: false,
        error: `Hub HTTP ${res.status}`,
      };
    }

    const body: unknown = await res.json();
    const parsed = parsePagePayload(body);
    if (!parsed) {
      return {
        ok: false,
        httpStatus: res.status,
        rateLimited: false,
        retryable: false,
        error: "Hub response missing expected pagination fields",
      };
    }
    return { ok: true, page: parsed, httpStatus: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!options?.isRetry) {
      await sleep(300);
      return fetchHubAttemptsPage(wallet, page, {
        ...options,
        isRetry: true,
      });
    }
    return {
      ok: false,
      httpStatus: 0,
      rateLimited: false,
      retryable: true,
      error: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

function recordsFromPage(items: unknown[]): HubAttemptRecord[] {
  const out: HubAttemptRecord[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    const parsed = parseHubAttemptItem(item);
    if (!parsed) continue;
    if (seen.has(parsed.attemptId)) continue;
    seen.add(parsed.attemptId);
    out.push(parsed);
  }
  return out;
}

async function snapshotFromCache(
  cache: HubWalletCacheRow,
  extras?: Partial<HubEnsureResult>,
): Promise<HubEnsureResult> {
  const fetched = await countHubAttempts(cache.address);
  return {
    status: cache.status,
    totalAttempts: cache.totalAttempts,
    fetchedAttempts: fetched,
    lastCompletedPage: cache.lastCompletedPage,
    totalPages: cache.totalPages,
    perPage: cache.perPage,
    updatedAt: cache.updatedAt,
    httpRequests: 0,
    warnings: [],
    rateLimited: false,
    stale: false,
    fromCache: true,
    ...extras,
  };
}

/** Cached unique rows must equal the Hub snapshot total to be complete. */
export async function isHubCacheCountReconciled(
  addressLower: string,
  totalAttempts: number,
): Promise<boolean> {
  if (totalAttempts < 0) return false;
  return (await countHubAttempts(addressLower)) === totalAttempts;
}

async function markHubIncompleteMismatch(
  addressLower: string,
  opts: {
    totalAttempts: number;
    totalPages: number;
    lastCompletedPage: number;
    nowMs: number;
    warning?: string;
  },
): Promise<void> {
  await persistHubPageProgress(addressLower, {
    records: [],
    totalAttempts: opts.totalAttempts,
    totalPages: opts.totalPages,
    lastCompletedPage: opts.lastCompletedPage,
    perPage: HUB_PER_PAGE,
    status: "incomplete",
    nowMs: opts.nowMs,
  });
  if (opts.warning) {
    await markHubWalletCacheError(addressLower, opts.warning, opts.nowMs);
  }
}

/**
 * Ensure Hub history for a wallet is built/resumed/refreshed within a deadline.
 * Saves each successful page immediately. Never discards prior pages.
 *
 * Completion requires unique cached rows === search-attempts total (not merely
 * visiting every page number). One bounded reconciliation pass is allowed.
 *
 * API ordering: newest-first — incremental refresh walks from page 1 until
 * known attempt_ids are reached.
 */
export async function ensureHubAttemptHistory(
  wallet: `0x${string}`,
  options?: {
    deadlineMs?: number;
    fetchImpl?: HubFetchImpl;
    now?: () => number;
    maxAgeMs?: number;
    /** Force a freshness check even if within max age. */
    forceFreshnessCheck?: boolean;
  },
): Promise<HubEnsureResult> {
  const addressLower = wallet.toLowerCase();
  const now = options?.now ?? Date.now;
  const deadline =
    options?.deadlineMs ?? now() + getHubFetchBudgetMs();
  const maxAgeMs = options?.maxAgeMs ?? getHubCacheMaxAgeMs();
  const fetchImpl = options?.fetchImpl;
  const warnings: string[] = [];
  let httpRequests = 0;
  let rateLimited = false;
  let reconciliationUsed = false;
  let reconciliationExhausted = false;

  const remaining = () => Math.max(0, deadline - now());

  const fetchPage = async (page: number) => {
    httpRequests += 1;
    return fetchHubAttemptsPage(wallet, page, {
      fetchImpl,
      timeoutMs: Math.min(HUB_PAGE_TIMEOUT_MS, Math.max(1_000, remaining())),
    });
  };

  /**
   * Hub search totals are not strictly append-only (attempts can disappear /
   * reshuffle). Append-only upsert then leaves orphan rows so
   * cached_count > live_total and the wallet can never finalize complete.
   * Rebuild from page 1 when overcount is detected.
   */
  const rebuildBecauseOvercount = async (
    liveTotal: number,
    livePages: number,
    reason: string,
  ): Promise<boolean> => {
    const before = await countHubAttempts(addressLower);
    if (before <= liveTotal) {
      return await finalizeComplete(liveTotal, livePages, livePages);
    }
    warnings.push(
      `Hub cache overcount (${before} rows vs live total ${liveTotal}); rebuilding (${reason}).`,
    );
    await clearHubAttemptsForAddress(addressLower, now());
    reconciliationUsed = false;
    reconciliationExhausted = false;

    let lastPage = 0;
    let currentTotal = liveTotal;
    let currentPages = livePages;
    for (
      let p = 1;
      p <= currentPages && remaining() > HUB_PAGE_TIMEOUT_MS;
      p++
    ) {
      const res = await fetchPage(p);
      if (!res.ok) {
        if (res.rateLimited) rateLimited = true;
        await markHubWalletCacheError(addressLower, res.error, now());
        warnings.push(res.error);
        break;
      }
      currentTotal = res.page.total;
      currentPages = res.page.total_pages;
      // If Hub total rose mid-rebuild above what we cleared for, keep going;
      // if it fell further, continue and finalize against the latest total.
      if (await countHubAttempts(addressLower) > currentTotal) {
        // Should not happen mid-rebuild from empty — safety abort to incomplete.
        warnings.push(
          `Hub rebuild produced overcount mid-pass (cached=${await countHubAttempts(addressLower)} total=${currentTotal}).`,
        );
        break;
      }
      await persistHubPageProgress(addressLower, {
        records: recordsFromPage(res.page.items),
        totalAttempts: currentTotal,
        totalPages: currentPages,
        lastCompletedPage: p,
        perPage: HUB_PER_PAGE,
        status: "incomplete",
        lastError: null,
        nowMs: now(),
      });
      lastPage = p;
    }

    if (await finalizeComplete(currentTotal, currentPages, Math.max(lastPage, 0))) {
      return true;
    }
    const cached = await countHubAttempts(addressLower);
    if (cached > currentTotal) {
      await markHubIncompleteMismatch(addressLower, {
        totalAttempts: currentTotal,
        totalPages: currentPages,
        lastCompletedPage: Math.max(lastPage, 0),
        nowMs: now(),
        warning: formatHubReconcileExhaustedError(currentTotal, cached),
      });
      reconciliationExhausted = true;
      return false;
    }
    // Under-count: leave incomplete for resume (do not mark exhausted).
    await persistHubPageProgress(addressLower, {
      records: [],
      totalAttempts: currentTotal,
      totalPages: currentPages,
      lastCompletedPage: Math.max(lastPage, 0),
      perPage: HUB_PER_PAGE,
      status: "incomplete",
      lastError: null,
      nowMs: now(),
    });
    return false;
  };

  const finalizeComplete = async (
    totalAttempts: number,
    totalPages: number,
    lastCompletedPage: number,
  ): Promise<boolean> => {
    const fetched = await countHubAttempts(addressLower);
    if (fetched === totalAttempts) {
      await persistHubPageProgress(addressLower, {
        records: [],
        totalAttempts,
        totalPages,
        lastCompletedPage: Math.max(lastCompletedPage, totalPages),
        perPage: HUB_PER_PAGE,
        status: "complete",
        lastError: null,
        nowMs: now(),
      });
      return true;
    }
    return false;
  };

  /**
   * One bounded full-page re-ingest. Preserves existing rows (upsert).
   * No second pass — caller must leave incomplete if still mismatched.
   */
  const reconcileOnce = async (
    totalAttempts: number,
    totalPages: number,
  ): Promise<boolean> => {
    if (reconciliationUsed) return false;
    reconciliationUsed = true;

    // Already exhausted for this snapshot — do not refetch forever.
    const prior = await getHubWalletCache(addressLower);
    if (
      !options?.forceFreshnessCheck &&
      isHubReconcileExhaustedForTotal(prior?.lastError, totalAttempts)
    ) {
      reconciliationExhausted = true;
      warnings.push(
        "Hub reconciliation already exhausted for this snapshot total; not refetching.",
      );
      return false;
    }

    warnings.push(
      "Hub cache count did not match search-attempts total; running one reconciliation pass.",
    );

    let lastPage = 0;
    let liveTotal = totalAttempts;
    let livePages = totalPages;
    for (
      let p = 1;
      p <= livePages && remaining() > HUB_PAGE_TIMEOUT_MS;
      p++
    ) {
      const res = await fetchPage(p);
      if (!res.ok) {
        if (res.rateLimited) rateLimited = true;
        await markHubWalletCacheError(addressLower, res.error, now());
        warnings.push(res.error);
        break;
      }
      liveTotal = res.page.total;
      livePages = res.page.total_pages;
      await persistHubPageProgress(addressLower, {
        records: recordsFromPage(res.page.items),
        totalAttempts: liveTotal,
        totalPages: livePages,
        lastCompletedPage: p,
        perPage: HUB_PER_PAGE,
        status: "incomplete",
        nowMs: now(),
      });
      lastPage = p;
    }

    if (
      lastPage >= livePages &&
      await finalizeComplete(liveTotal, livePages, lastPage)
    ) {
      return true;
    }

    const cached = await countHubAttempts(addressLower);
    // Count already matches even if page cursor is short — treat as complete.
    if (await finalizeComplete(liveTotal, livePages, Math.max(lastPage, livePages))) {
      return true;
    }

    const exhaustedMsg = formatHubReconcileExhaustedError(liveTotal, cached);
    await markHubIncompleteMismatch(addressLower, {
      totalAttempts: liveTotal,
      totalPages: livePages,
      lastCompletedPage: Math.max(lastPage, 0),
      nowMs: now(),
      warning: exhaustedMsg,
    });
    reconciliationExhausted = true;
    warnings.push(
      "Hub reconciliation exhausted: cached unique attempts still differ from search-attempts total.",
    );
    return false;
  };

  let cache = await getHubWalletCache(addressLower);

  // Heal: unique rows already match snapshot total → complete regardless of
  // page cursor (prevents ~99% stuck when last_completed_page < total_pages).
  if (
    cache &&
    cache.totalAttempts > 0 &&
    await isHubCacheCountReconciled(addressLower, cache.totalAttempts)
  ) {
    if (
      cache.status !== "complete" ||
      cache.lastCompletedPage < cache.totalPages
    ) {
      await finalizeComplete(
        cache.totalAttempts,
        cache.totalPages,
        Math.max(cache.lastCompletedPage, cache.totalPages),
      );
      cache = (await getHubWalletCache(addressLower))!;
    }
  }

  // Complete-but-mismatched caches must not be trusted — repair first.
  if (
    cache?.status === "complete" &&
    !await isHubCacheCountReconciled(addressLower, cache.totalAttempts)
  ) {
    warnings.push(
      `Hub cache marked complete with ${await countHubAttempts(addressLower)} rows vs total ${cache.totalAttempts}; reconciling.`,
    );
    await markHubIncompleteMismatch(addressLower, {
      totalAttempts: cache.totalAttempts,
      totalPages: cache.totalPages,
      lastCompletedPage: cache.lastCompletedPage,
      nowMs: now(),
    });
    const ok = await reconcileOnce(cache.totalAttempts, cache.totalPages);
    cache = (await getHubWalletCache(addressLower))!;
    return {
      status: ok ? "complete" : "incomplete",
      totalAttempts: cache.totalAttempts,
      fetchedAttempts: await countHubAttempts(addressLower),
      lastCompletedPage: cache.lastCompletedPage,
      totalPages: cache.totalPages,
      perPage: HUB_PER_PAGE,
      updatedAt: cache.updatedAt,
      httpRequests,
      warnings,
      rateLimited,
      stale: !ok,
      fromCache: false,
      reconciliationExhausted: ok ? false : reconciliationExhausted,
    };
  }

  // ── Complete + fresh + reconciled → serve immediately ────────────────
  if (
    cache?.status === "complete" &&
    await isHubCacheCountReconciled(addressLower, cache.totalAttempts) &&
    !options?.forceFreshnessCheck &&
    now() - cache.updatedAt <= maxAgeMs
  ) {
    return await snapshotFromCache(cache, { stale: false, fromCache: true });
  }

  // ── Complete + stale → lightweight freshness (page 1) ────────────────
  if (
    cache?.status === "complete" &&
    await isHubCacheCountReconciled(addressLower, cache.totalAttempts)
  ) {
    if (remaining() < 800) {
      return await snapshotFromCache(cache, {
        stale: true,
        warnings: ["Hub freshness check deferred — request budget exhausted."],
      });
    }

    const page1 = await fetchPage(1);
    if (!page1.ok) {
      if (page1.rateLimited) rateLimited = true;
      await markHubWalletCacheError(addressLower, page1.error, now());
      return await snapshotFromCache(cache, {
        stale: true,
        httpRequests,
        rateLimited,
        warnings: [
          `Hub freshness check failed (${page1.error}). Serving complete cached Hub history.`,
        ],
      });
    }

    const liveTotal = page1.page.total;
    const livePages = page1.page.total_pages;
    const pageRecords = recordsFromPage(page1.page.items);

    // Orphan / reshuffled Hub rows: cached unique attempts exceed live total.
    if (await countHubAttempts(addressLower) > liveTotal) {
      const ok = await rebuildBecauseOvercount(
        liveTotal,
        livePages,
        "freshness-overcount",
      );
      cache = (await getHubWalletCache(addressLower))!;
      return {
        status: ok ? "complete" : "incomplete",
        totalAttempts: liveTotal,
        fetchedAttempts: await countHubAttempts(addressLower),
        lastCompletedPage: cache?.lastCompletedPage ?? 0,
        totalPages: livePages,
        perPage: HUB_PER_PAGE,
        updatedAt: cache?.updatedAt ?? null,
        httpRequests,
        warnings,
        rateLimited,
        stale: !ok,
        fromCache: false,
        reconciliationExhausted: ok ? false : reconciliationExhausted,
      };
    }

    if (liveTotal === cache.totalAttempts) {
      await persistHubPageProgress(addressLower, {
        records: pageRecords,
        totalAttempts: liveTotal,
        totalPages: livePages,
        lastCompletedPage: Math.max(cache.lastCompletedPage, 1),
        perPage: HUB_PER_PAGE,
        status: "incomplete",
        nowMs: now(),
      });
      if (await finalizeComplete(liveTotal, livePages, Math.max(cache.lastCompletedPage, 1))) {
        await touchHubWalletCacheFreshness(addressLower, now());
        cache = (await getHubWalletCache(addressLower))!;
        return await snapshotFromCache(cache, {
          httpRequests,
          stale: false,
          // Hub was contacted and verified this request — not a silent cache hit.
          fromCache: false,
          warnings,
        });
      }
      const ok = await reconcileOnce(liveTotal, livePages);
      cache = (await getHubWalletCache(addressLower))!;
      return {
        status: ok ? "complete" : "incomplete",
        totalAttempts: liveTotal,
        fetchedAttempts: await countHubAttempts(addressLower),
        lastCompletedPage: cache.lastCompletedPage,
        totalPages: livePages,
        perPage: HUB_PER_PAGE,
        updatedAt: cache.updatedAt,
        httpRequests,
        warnings,
        rateLimited,
        stale: !ok,
        fromCache: false,
      };
    }

    if (liveTotal < cache.totalAttempts) {
      warnings.push(
        `Hub reported a lower total (${liveTotal}) than cached (${cache.totalAttempts}). Keeping cached rows.`,
      );
      // Prefer rebuild when rows already exceed the new live total.
      if (await countHubAttempts(addressLower) > liveTotal) {
        const ok = await rebuildBecauseOvercount(
          liveTotal,
          livePages,
          "hub-total-decreased",
        );
        cache = (await getHubWalletCache(addressLower))!;
        return {
          status: ok ? "complete" : "incomplete",
          totalAttempts: liveTotal,
          fetchedAttempts: await countHubAttempts(addressLower),
          lastCompletedPage: cache?.lastCompletedPage ?? 0,
          totalPages: livePages,
          perPage: HUB_PER_PAGE,
          updatedAt: cache?.updatedAt ?? null,
          httpRequests,
          warnings,
          rateLimited,
          stale: !ok,
          fromCache: false,
          reconciliationExhausted: ok ? false : reconciliationExhausted,
        };
      }
      await persistHubPageProgress(addressLower, {
        records: pageRecords,
        totalAttempts: liveTotal,
        totalPages: livePages,
        lastCompletedPage: cache.lastCompletedPage,
        perPage: HUB_PER_PAGE,
        status: "incomplete",
        nowMs: now(),
      });
      if (await finalizeComplete(liveTotal, livePages, cache.lastCompletedPage)) {
        cache = (await getHubWalletCache(addressLower))!;
        return await snapshotFromCache(cache, { httpRequests, warnings, stale: false });
      }
      const ok = await reconcileOnce(liveTotal, livePages);
      cache = (await getHubWalletCache(addressLower))!;
      return {
        status: ok ? "complete" : "incomplete",
        totalAttempts: liveTotal,
        fetchedAttempts: await countHubAttempts(addressLower),
        lastCompletedPage: cache.lastCompletedPage,
        totalPages: livePages,
        perPage: HUB_PER_PAGE,
        updatedAt: cache.updatedAt,
        httpRequests,
        warnings,
        rateLimited,
        stale: !ok,
        fromCache: false,
      };
    }

    // liveTotal > cached: newest-first incremental merge from page 1
    const known = await getKnownHubAttemptIds(addressLower);
    let lastPage = 0;
    let hitBoundary = false;

    const ingestPage = async (pageNum: number, items: unknown[]) => {
      const records = recordsFromPage(items);
      let newCount = 0;
      for (const r of records) {
        if (!known.has(r.attemptId)) {
          known.add(r.attemptId);
          newCount += 1;
        }
      }
      if (records.length > 0 && newCount === 0) hitBoundary = true;
      await persistHubPageProgress(addressLower, {
        records,
        totalAttempts: liveTotal,
        totalPages: livePages,
        lastCompletedPage: Math.max(cache!.lastCompletedPage, pageNum),
        perPage: HUB_PER_PAGE,
        status: "incomplete",
        nowMs: now(),
      });
      lastPage = pageNum;
      return newCount;
    };

    await ingestPage(1, page1.page.items);
    for (
      let p = 2;
      p <= livePages && !hitBoundary && remaining() > HUB_PAGE_TIMEOUT_MS;
      p++
    ) {
      const res = await fetchPage(p);
      if (!res.ok) {
        if (res.rateLimited) {
          rateLimited = true;
          await markHubWalletCacheError(addressLower, res.error, now());
          warnings.push(res.error);
          break;
        }
        await markHubWalletCacheError(addressLower, res.error, now());
        warnings.push(res.error);
        break;
      }
      await ingestPage(p, res.page.items);
      if (hitBoundary) break;
    }

    let complete =
      hitBoundary &&
      await isHubCacheCountReconciled(addressLower, liveTotal)
        ? await finalizeComplete(
            liveTotal,
            livePages,
            Math.max(lastPage, cache.lastCompletedPage),
          )
        : lastPage >= livePages
          ? await finalizeComplete(
              liveTotal,
              livePages,
              Math.max(lastPage, cache.lastCompletedPage),
            )
          : false;

    if (!complete && (lastPage >= livePages || hitBoundary)) {
      complete = await reconcileOnce(liveTotal, livePages);
    }

    cache = (await getHubWalletCache(addressLower))!;
    return {
      status: complete ? "complete" : "incomplete",
      totalAttempts: liveTotal,
      fetchedAttempts: await countHubAttempts(addressLower),
      lastCompletedPage: cache.lastCompletedPage,
      totalPages: livePages,
      perPage: HUB_PER_PAGE,
      updatedAt: cache.updatedAt,
      httpRequests,
      warnings,
      rateLimited,
      stale: !complete,
      fromCache: false,
      reconciliationExhausted: complete ? false : reconciliationExhausted,
    };
  }

  // ── Incomplete or missing → build / resume ───────────────────────────
  let lastCompleted = cache?.lastCompletedPage ?? 0;
  let totalAttempts = cache?.totalAttempts ?? 0;
  let totalPages = cache?.totalPages ?? 0;

  // Incomplete + orphan overcount vs known Hub total → rebuild.
  if (
    cache &&
    totalAttempts > 0 &&
    await countHubAttempts(addressLower) > totalAttempts &&
    remaining() > HUB_PAGE_TIMEOUT_MS
  ) {
    const ok = await rebuildBecauseOvercount(
      totalAttempts,
      Math.max(totalPages, 1),
      "incomplete-overcount",
    );
    cache = (await getHubWalletCache(addressLower))!;
    return {
      status: ok ? "complete" : "incomplete",
      totalAttempts: cache?.totalAttempts ?? totalAttempts,
      fetchedAttempts: await countHubAttempts(addressLower),
      lastCompletedPage: cache?.lastCompletedPage ?? 0,
      totalPages: cache?.totalPages ?? totalPages,
      perPage: HUB_PER_PAGE,
      updatedAt: cache?.updatedAt ?? null,
      httpRequests,
      warnings,
      rateLimited,
      stale: !ok,
      fromCache: false,
      reconciliationExhausted: ok ? false : reconciliationExhausted,
    };
  }

  if (lastCompleted === 0 || !cache) {
    if (remaining() < HUB_PAGE_TIMEOUT_MS) {
      return {
        status: "incomplete",
        totalAttempts,
        fetchedAttempts: await countHubAttempts(addressLower),
        lastCompletedPage: lastCompleted,
        totalPages,
        perPage: HUB_PER_PAGE,
        updatedAt: cache?.updatedAt ?? null,
        httpRequests,
        warnings: ["Hub fetch budget exhausted before page 1."],
        rateLimited: false,
        stale: true,
        fromCache: false,
      };
    }

    const page1 = await fetchPage(1);
    if (!page1.ok) {
      if (page1.rateLimited) rateLimited = true;
      if (cache) await markHubWalletCacheError(addressLower, page1.error, now());
      return {
        status: "incomplete",
        totalAttempts,
        fetchedAttempts: await countHubAttempts(addressLower),
        lastCompletedPage: lastCompleted,
        totalPages,
        perPage: HUB_PER_PAGE,
        updatedAt: cache?.updatedAt ?? null,
        httpRequests,
        warnings: [page1.error],
        rateLimited,
        stale: true,
        fromCache: false,
      };
    }

    totalAttempts = page1.page.total;
    totalPages = page1.page.total_pages;
    const records = recordsFromPage(page1.page.items);
    await persistHubPageProgress(addressLower, {
      records,
      totalAttempts,
      totalPages,
      lastCompletedPage: 1,
      perPage: HUB_PER_PAGE,
      status: "incomplete",
      nowMs: now(),
    });
    lastCompleted = 1;

    if (totalPages <= 1) {
      if (await finalizeComplete(totalAttempts, totalPages, 1)) {
        cache = (await getHubWalletCache(addressLower))!;
        return await snapshotFromCache(cache, {
          httpRequests,
          fromCache: false,
          stale: false,
        });
      }
      const ok = await reconcileOnce(totalAttempts, totalPages);
      cache = (await getHubWalletCache(addressLower))!;
      return {
        status: ok ? "complete" : "incomplete",
        totalAttempts,
        fetchedAttempts: await countHubAttempts(addressLower),
        lastCompletedPage: cache.lastCompletedPage,
        totalPages,
        perPage: HUB_PER_PAGE,
        updatedAt: cache.updatedAt,
        httpRequests,
        warnings,
        rateLimited,
        stale: !ok,
        fromCache: false,
      };
    }
  }

  // Resume remaining pages sequentially (max concurrency 1 for reliability)
  for (
    let p = lastCompleted + 1;
    p <= totalPages && remaining() > HUB_PAGE_TIMEOUT_MS;
    p++
  ) {
    const res = await fetchPage(p);
    if (!res.ok) {
      if (res.rateLimited) {
        rateLimited = true;
        await markHubWalletCacheError(addressLower, res.error, now());
        warnings.push(res.error);
        break;
      }
      await markHubWalletCacheError(addressLower, res.error, now());
      warnings.push(res.error);
      break;
    }

    totalAttempts = res.page.total;
    totalPages = res.page.total_pages;
    const records = recordsFromPage(res.page.items);
    await persistHubPageProgress(addressLower, {
      records,
      totalAttempts,
      totalPages,
      lastCompletedPage: p,
      perPage: HUB_PER_PAGE,
      status: "incomplete",
      nowMs: now(),
    });
    lastCompleted = p;
  }

  cache = await getHubWalletCache(addressLower);
  let complete = false;
  if (
    totalAttempts > 0 &&
    await isHubCacheCountReconciled(addressLower, totalAttempts)
  ) {
    complete = await finalizeComplete(
      totalAttempts,
      totalPages,
      Math.max(lastCompleted, totalPages),
    );
  } else if (totalPages > 0 && lastCompleted >= totalPages) {
    complete = await finalizeComplete(totalAttempts, totalPages, lastCompleted);
    if (!complete) {
      complete = await reconcileOnce(totalAttempts, totalPages);
    }
  }

  cache = await getHubWalletCache(addressLower);
  return {
    status: complete ? "complete" : "incomplete",
    totalAttempts: cache?.totalAttempts ?? totalAttempts,
    fetchedAttempts: await countHubAttempts(addressLower),
    lastCompletedPage: cache?.lastCompletedPage ?? lastCompleted,
    totalPages: cache?.totalPages ?? totalPages,
    perPage: HUB_PER_PAGE,
    updatedAt: cache?.updatedAt ?? null,
    httpRequests,
    warnings,
    rateLimited,
    stale: !complete,
    fromCache: false,
    reconciliationExhausted: complete ? false : reconciliationExhausted,
  };
}

export async function loadHubContributions(
  address: `0x${string}`,
): Promise<HubAttemptContribution[]> {
  const addressLower = address.toLowerCase();
  const rows = await getCachedHubAttempts(addressLower);
  return rows.map((r) => hubRecordToContribution(address, r));
}

export function hubProgressPercent(result: HubEnsureResult): number {
  return computeHubFetchPercent(result.fetchedAttempts, result.totalAttempts);
}

export async function countHubTxhashStats(addressLower: string): Promise<{
  hubAttemptCount: number;
  trajectoryCount: number;
  unsignedAttemptCount: number;
  withTxhash: number;
  withoutTxhash: number;
}> {
  const rows = await getCachedHubAttempts(addressLower);
  let trajectoryCount = 0;
  let unsignedAttemptCount = 0;
  for (const r of rows) {
    if (normalizeHubTxhash(r.txhash)) trajectoryCount += 1;
    else unsignedAttemptCount += 1;
  }
  return {
    hubAttemptCount: rows.length,
    trajectoryCount,
    unsignedAttemptCount,
    withTxhash: trajectoryCount,
    withoutTxhash: unsignedAttemptCount,
  };
}
