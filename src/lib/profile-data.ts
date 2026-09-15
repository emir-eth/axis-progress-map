/**
 * Profile data abstraction — Hub-first.
 *
 * Priority (any wallet, including reference):
 * 1) Complete Hub attempt cache → analytics; lightweight freshness check
 * 2) Incomplete Hub cache → resume pagination (bounded per request)
 * 3) No Hub cache → START real Hub page fetch (resumable)
 * 4) Dev fixture LAST RESORT only when:
 *    Hub is genuinely unavailable/failed with no usable Hub progress,
 *    AXIS_USE_DEV_FIXTURE is enabled, and the wallet is the reference wallet.
 *
 * Fixture must never prevent a successful public Hub lookup.
 *
 * Base RecordSubmitted wallet_cache/scanner is secondary verification only —
 * never auto-started on profile load.
 *
 * No global contract index. No Etherscan/Blockscout/paid APIs.
 */
import { type Address } from "viem";
import { normalizeAddress } from "@/lib/base";
import { isDevFixtureEnabled } from "@/lib/dev-fixture";
import {
  buildReferenceWalletFixture,
  isReferenceWallet,
} from "@/lib/fixtures/reference-wallet";
import { buildAnalytics } from "@/lib/analytics";
import { fetchAxisTaskFamiliesWithInfo } from "@/lib/axis";
import { buildTaskIndex, matchHubAttempts } from "@/lib/matcher";
import {
  computeHubFetchPercent,
  countCachedWalletEvents,
  countHubAttempts,
  DatabaseConfigError,
  getHubWalletCache,
  getWalletCache,
} from "@/lib/db";
import {
  countHubTxhashStats,
  ensureHubAttemptHistory,
  getHubCacheMaxAgeMs,
  getHubFetchBudgetMs,
  loadHubContributions,
  type HubEnsureResult,
  type HubFetchImpl,
} from "@/lib/hub-attempts";
import type {
  BaseVerificationStatus,
  HubCacheStatus,
  HubTxhashStats,
  IndexStatus,
  MappedContribution,
  ProfileResponse,
  ProfileTimings,
  ScanProgress,
} from "@/types";

export type ProfileLoadResult =
  | { ok: true; profile: ProfileResponse }
  | {
      ok: false;
      status: number;
      code:
        | "INVALID_ADDRESS"
        | "INTERNAL"
        | "INDEX_NOT_READY"
        | "SYNC_FAILED";
      error: string;
      details?: string;
    };

export interface ProfileLoadDeps {
  /** Override Hub fetch (tests). */
  fetchHubPages?: HubFetchImpl;
  /** Skip Axis Hub task-family metadata (tests). */
  skipMetadata?: boolean;
  /** Per-request Hub page budget (ms). */
  hubFetchBudgetMs?: number;
  /** Hub cache max age (ms). */
  hubCacheMaxAgeMs?: number;
  now?: () => number;
  /**
   * @deprecated Base RPC scan is no longer on the profile critical path.
   * Kept so older test harnesses that pass these fields still typecheck.
   */
  getLogs?: unknown;
  getBlockNumber?: unknown;
  scanBudgetMs?: number;
  fetchHubTrajectories?: (wallet: string) => Promise<number | null>;
  fetchBlockTimestamps?: unknown;
  resolveTimestamps?: boolean;
}

function emptyAnalytics(metadataAvailable = false) {
  return {
    summary: {
      onChainContributions: 0,
      uniqueTasks: 0,
      averageScore: 0,
      bestScore: 0,
    },
    coverage: {
      mappedUniqueTasks: 0,
      totalUniqueTasks: 0,
      coveragePercent: 0,
      mappedContributions: 0,
      totalContributions: 0,
    },
    skills: [],
    themes: [],
    timeline: [],
    metadataAvailable,
  };
}

function noneBaseVerification(): BaseVerificationStatus {
  return {
    status: "none",
    recordSubmittedCount: null,
    lastVerifiedAt: null,
  };
}

function hasUsableHubProgress(
  hub: Pick<HubEnsureResult, "fetchedAttempts" | "lastCompletedPage">,
  existing: Awaited<ReturnType<typeof getHubWalletCache>>,
): boolean {
  if (existing) return true;
  if (hub.fetchedAttempts > 0) return true;
  if (hub.lastCompletedPage > 0) return true;
  return false;
}

/** True when Hub never successfully returned/persisted a page. */
function hubGenuinelyUnavailable(hub: HubEnsureResult): boolean {
  if (hub.rateLimited) return true;
  if (hub.fetchedAttempts > 0 || hub.lastCompletedPage > 0) return false;
  return hub.warnings.some((w) =>
    /Hub HTTP|Hub rate|Hub transient|Hub response|unavailable|aborted|failed|ECONN|ENOTFOUND|fetch failed/i.test(
      w,
    ),
  );
}

function allowReferenceFixtureFallback(address: Address): boolean {
  return isDevFixtureEnabled() && isReferenceWallet(address);
}

async function buildFixtureProfile(
  address: Address,
  baseVerification: BaseVerificationStatus,
  timings: ProfileTimings,
  started: number,
  deps: ProfileLoadDeps,
): Promise<ProfileResponse> {
  const profile = buildReferenceWalletFixture();
  profile.address = address;
  profile.baseVerification = baseVerification;
  profile.timings = {
    ...timings,
    totalMs: Date.now() - started,
  };
  if (deps.fetchHubTrajectories) {
    try {
      profile.hubTrajectories = await deps.fetchHubTrajectories(address);
    } catch {
      profile.hubTrajectories = null;
    }
  }
  return profile;
}

/** Read-only Base verification snapshot — never starts a scan. */
export async function readBaseVerification(
  addressLower: string,
): Promise<BaseVerificationStatus> {
  const cache = await getWalletCache(addressLower);
  if (!cache) return noneBaseVerification();
  if (cache.status === "complete") {
    return {
      status: "complete",
      recordSubmittedCount: await countCachedWalletEvents(addressLower),
      lastVerifiedAt: new Date(cache.updatedAt).toISOString(),
    };
  }
  return {
    status: "incomplete",
    recordSubmittedCount: await countCachedWalletEvents(addressLower),
    lastVerifiedAt: new Date(cache.updatedAt).toISOString(),
  };
}

function toHubStatus(result: HubEnsureResult): HubCacheStatus {
  return {
    status: result.status,
    totalAttempts: result.totalAttempts,
    fetchedAttempts: result.fetchedAttempts,
    lastCompletedPage: result.lastCompletedPage,
    totalPages: result.totalPages,
    updatedAt:
      result.updatedAt != null
        ? new Date(result.updatedAt).toISOString()
        : null,
    stale: result.stale,
  };
}

function hubScanProgress(result: HubEnsureResult): ScanProgress {
  return {
    fromBlock: 0,
    lastScannedBlock: result.lastCompletedPage,
    targetBlock: Math.max(result.totalPages, 1),
    percent: computeHubFetchPercent(
      result.fetchedAttempts,
      result.totalAttempts,
    ),
  };
}

async function mapAndAnalyzeHub(
  address: Address,
  deps: ProfileLoadDeps,
  timings: ProfileTimings,
): Promise<{
  mapped: MappedContribution[];
  analytics: ReturnType<typeof buildAnalytics>;
  warnings: string[];
  metadataAvailable: boolean;
}> {
  const contributions = await loadHubContributions(address);
  const warnings: string[] = [];
  let metadataAvailable = false;
  let mapped: MappedContribution[];

  if (deps.skipMetadata) {
    mapped = matchHubAttempts(contributions, buildTaskIndex([]));
  } else {
    const metaStarted = Date.now();
    try {
      const meta = await fetchAxisTaskFamiliesWithInfo();
      timings.metadataMs = Date.now() - metaStarted;
      metadataAvailable = true;
      mapped = matchHubAttempts(
        contributions,
        buildTaskIndex(meta.families),
      );
      if (meta.usedStale) {
        warnings.push(
          "Axis Hub metadata served from a stale in-memory cache.",
        );
      }
    } catch (err) {
      timings.metadataMs = Date.now() - metaStarted;
      warnings.push(
        `Axis Hub metadata unavailable: ${
          err instanceof Error ? err.message : String(err)
        }. Showing Hub attempts without skill/environment mapping.`,
      );
      mapped = matchHubAttempts(contributions, buildTaskIndex([]));
    }
  }

  // Primary analytics use ALL Hub attempts (public Hub activity).
  // Average/best scores ignore null scores inside buildAnalytics.
  const analyticsStarted = Date.now();
  const analytics = buildAnalytics(mapped, metadataAvailable);
  timings.analyticsMs = Date.now() - analyticsStarted;

  // Explorer receives all Hub attempts; UI defaults to ALL.
  return { mapped, analytics, warnings, metadataAvailable };
}

function buildIndexStatus(partial: {
  dataSource: IndexStatus["dataSource"];
  freshness: IndexStatus["freshness"];
  lastSyncAt: string | null;
  lastIndexedBlock?: number;
  chainHead?: number | null;
  maxAgeMs?: number;
  scanStatus?: IndexStatus["scanStatus"];
  scanProgress?: ScanProgress | null;
  canResume?: boolean;
}): IndexStatus {
  return {
    dataSource: partial.dataSource,
    freshness: partial.freshness,
    lastSyncAt: partial.lastSyncAt,
    lastIndexedBlock: partial.lastIndexedBlock ?? 0,
    chainHead: partial.chainHead ?? null,
    blocksBehind: null,
    maxAgeMs: partial.maxAgeMs ?? getHubCacheMaxAgeMs(),
    scanStatus: partial.scanStatus,
    scanProgress: partial.scanProgress ?? null,
    canResume: partial.canResume,
  };
}

function incompleteHubProfile(options: {
  address: Address;
  started: number;
  timings: ProfileTimings;
  warnings: string[];
  hub: HubEnsureResult;
  baseVerification: BaseVerificationStatus;
}): ProfileResponse {
  const { address, started, timings, warnings, hub, baseVerification } =
    options;
  timings.totalMs = Date.now() - started;
  const hubStatus = toHubStatus(hub);
  return {
    address,
    generatedAt: new Date().toISOString(),
    contributions: [],
    analytics: emptyAnalytics(false),
    warnings,
    indexStatus: buildIndexStatus({
      dataSource: "hub-incomplete",
      freshness: "stale",
      lastSyncAt: hubStatus.updatedAt,
      scanStatus: "incomplete",
      scanProgress: hubScanProgress(hub),
      canResume: !hub.rateLimited && !hub.reconciliationExhausted,
    }),
    empty: true,
    hubTrajectories: hub.totalAttempts > 0 ? hub.totalAttempts : null,
    hubStatus,
    hubTxhash: null,
    baseVerification,
    timings,
  };
}

/**
 * Resolve profile data for a wallet (Hub-first).
 */
export async function loadProfileData(
  rawAddress: string,
  deps: ProfileLoadDeps = {},
): Promise<ProfileLoadResult> {
  const started = Date.now();
  const now = deps.now ?? Date.now;
  const timings: ProfileTimings = {
    totalMs: 0,
    sqliteMs: 0,
    metadataMs: 0,
    analyticsMs: 0,
    syncMs: 0,
    ethGetLogs: 0,
  };

  let address: Address;
  try {
    address = normalizeAddress(rawAddress);
  } catch {
    return {
      ok: false,
      status: 400,
      code: "INVALID_ADDRESS",
      error:
        "Invalid wallet address. Enter a valid public Base/Ethereum address.",
    };
  }

  const addressLower = address.toLowerCase();

  let baseVerification: BaseVerificationStatus;
  let existing: Awaited<ReturnType<typeof getHubWalletCache>>;
  try {
    baseVerification = await readBaseVerification(addressLower);
    const sqliteStarted = Date.now();
    existing = await getHubWalletCache(addressLower);
    timings.sqliteMs += Date.now() - sqliteStarted;
  } catch (err) {
    if (err instanceof DatabaseConfigError) {
      return {
        ok: false,
        status: 503,
        code: "INDEX_NOT_READY",
        error:
          "Progress map storage is temporarily unavailable. Please try again shortly.",
      };
    }
    const msg = err instanceof Error ? err.message : "storage error";
    return {
      ok: false,
      status: 503,
      code: "SYNC_FAILED",
      error:
        "Progress map storage is temporarily unavailable. Please try again shortly.",
      details: process.env.NODE_ENV === "production" ? undefined : msg,
    };
  }

  const budgetMs = deps.hubFetchBudgetMs ?? getHubFetchBudgetMs();
  const maxAgeMs = deps.hubCacheMaxAgeMs ?? getHubCacheMaxAgeMs();
  const deadline = started + budgetMs;

  // Always attempt real Hub history first — never short-circuit to fixture.
  const syncStarted = Date.now();
  let hub: HubEnsureResult;
  try {
    hub = await ensureHubAttemptHistory(address, {
      deadlineMs: deadline,
      fetchImpl: deps.fetchHubPages,
      now,
      maxAgeMs,
    });
  } catch (err) {
    timings.syncMs = Date.now() - syncStarted;
    const msg = err instanceof Error ? err.message : String(err);
    const cachedComplete = existing?.status === "complete";
    if (cachedComplete && existing) {
      hub = {
        status: "complete",
        totalAttempts: existing.totalAttempts,
        fetchedAttempts: existing.totalAttempts,
        lastCompletedPage: existing.lastCompletedPage,
        totalPages: existing.totalPages,
        perPage: existing.perPage,
        updatedAt: existing.updatedAt,
        httpRequests: 0,
        warnings: [`Hub refresh failed (${msg}). Serving cached Hub history.`],
        rateLimited: false,
        stale: true,
        fromCache: true,
      };
    } else if (existing) {
      // Incomplete/partial Hub cache always wins over fixture.
      return {
        ok: true,
        profile: incompleteHubProfile({
          address,
          started,
          timings,
          warnings: [
            `Hub activity history unavailable (${msg}). Progress is preserved.`,
          ],
          hub: {
            status: "incomplete",
            totalAttempts: existing.totalAttempts,
            fetchedAttempts: await countHubAttempts(addressLower),
            lastCompletedPage: existing.lastCompletedPage,
            totalPages: existing.totalPages,
            perPage: existing.perPage,
            updatedAt: existing.updatedAt,
            httpRequests: 0,
            warnings: [],
            rateLimited: false,
            stale: true,
            fromCache: true,
          },
          baseVerification,
        }),
      };
    } else if (allowReferenceFixtureFallback(address)) {
      return {
        ok: true,
        profile: await buildFixtureProfile(
          address,
          baseVerification,
          timings,
          started,
          deps,
        ),
      };
    } else {
      return {
        ok: true,
        profile: incompleteHubProfile({
          address,
          started,
          timings,
          warnings: [
            `Hub activity history unavailable (${msg}). No fabricated data is shown.`,
          ],
          hub: {
            status: "incomplete",
            totalAttempts: 0,
            fetchedAttempts: 0,
            lastCompletedPage: 0,
            totalPages: 0,
            perPage: 100,
            updatedAt: null,
            httpRequests: 0,
            warnings: [],
            rateLimited: false,
            stale: true,
            fromCache: false,
          },
          baseVerification,
        }),
      };
    }
  }
  timings.syncMs = Date.now() - syncStarted;

  if (hub.status !== "complete") {
    const cacheNow = existing ?? (await getHubWalletCache(addressLower));
    // Real Hub progress / cache row → preparation/resume (never fixture).
    if (hasUsableHubProgress(hub, cacheNow)) {
      return {
        ok: true,
        profile: incompleteHubProfile({
          address,
          started,
          timings,
          warnings: hub.warnings,
          hub,
          baseVerification,
        }),
      };
    }

    // No Hub progress at all — fixture only if Hub is genuinely unavailable.
    if (
      allowReferenceFixtureFallback(address) &&
      hubGenuinelyUnavailable(hub)
    ) {
      return {
        ok: true,
        profile: await buildFixtureProfile(
          address,
          baseVerification,
          timings,
          started,
          deps,
        ),
      };
    }

    return {
      ok: true,
      profile: incompleteHubProfile({
        address,
        started,
        timings,
        warnings: hub.warnings,
        hub,
        baseVerification,
      }),
    };
  }

  // ── Complete Hub history → full profile ──────────────────────────────
  const { mapped, analytics, warnings: metaWarnings } = await mapAndAnalyzeHub(
    address,
    deps,
    timings,
  );
  // Headline Trajectories = public Hub search-attempts.total
  analytics.summary.onChainContributions = hub.totalAttempts;
  const warnings = [...hub.warnings, ...metaWarnings];
  const txStats: HubTxhashStats = await countHubTxhashStats(addressLower);

  timings.totalMs = Date.now() - started;
  const hubStatus = toHubStatus(hub);
  const profile: ProfileResponse = {
    address,
    generatedAt: new Date().toISOString(),
    contributions: mapped,
    analytics,
    warnings,
    indexStatus: buildIndexStatus({
      dataSource: "hub-cache",
      freshness: hub.stale ? "stale" : hub.fromCache ? "cached" : "fresh",
      lastSyncAt: hubStatus.updatedAt,
      scanStatus: "complete",
      canResume: false,
    }),
    empty: mapped.length === 0,
    hubTrajectories: hub.totalAttempts,
    hubStatus,
    hubTxhash: txStats,
    baseVerification,
    timings,
  };
  return { ok: true, profile };
}
