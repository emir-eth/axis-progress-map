import type { AxisTaskFamily } from "@/types";

const AXIS_TASK_FAMILIES_URL = "https://hub.axisrobotics.ai/api/task-families";
const PER_PAGE = 100;
const MAX_RETRIES = 6;
const RETRY_BASE_MS = 800;
/** Keep Hub metadata paging gentle — high concurrency triggers 429s. */
const PAGE_CONCURRENCY = 2;

/** Cache Axis ended-family metadata — changes infrequently vs contribution data. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class MetadataUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetadataUnavailableError";
  }
}

interface TaskFamiliesPage {
  families?: AxisTaskFamily[];
  data?: AxisTaskFamily[];
  items?: AxisTaskFamily[];
  results?: AxisTaskFamily[];
  total_pages?: number;
  totalPages?: number;
  meta?: {
    total_pages?: number;
    totalPages?: number;
  };
  pagination?: {
    total_pages?: number;
    totalPages?: number;
    total?: number;
    page?: number;
    per_page?: number;
  };
}

interface CacheEntry {
  families: AxisTaskFamily[];
  fetchedAt: number;
}

export interface AxisMetadataFetchInfo {
  families: AxisTaskFamily[];
  cacheHit: boolean;
  coalesced: boolean;
  usedStale: boolean;
}

declare global {
  var __axisTaskFamilyCache: CacheEntry | undefined;
  var __axisTaskFamilyInflight: Promise<AxisTaskFamily[]> | undefined;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(page: number): Promise<{
  families: AxisTaskFamily[];
  totalPages: number;
  totalFamilies: number | null;
}> {
  const url = new URL(AXIS_TASK_FAMILIES_URL);
  url.searchParams.set("channel", "main");
  url.searchParams.set("status", "ended");
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("include_user_counts", "true");

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        // App already keeps a 6h in-memory TTL. Avoid Next.js Data Cache
        // collapsing/poisoning paginated Hub metadata responses.
        cache: "no-store",
      });

      if (res.status === 429) {
        if (attempt === MAX_RETRIES - 1) {
          throw new MetadataUnavailableError("Axis metadata API rate limited");
        }
        await sleep(RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250));
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = (await res.json()) as TaskFamiliesPage | AxisTaskFamily[];

      if (Array.isArray(json)) {
        return { families: json, totalPages: page, totalFamilies: json.length };
      }

      const families =
        json.families ??
        json.data ??
        json.items ??
        json.results ??
        ([] as AxisTaskFamily[]);

      const totalPages =
        json.pagination?.total_pages ??
        json.pagination?.totalPages ??
        json.total_pages ??
        json.totalPages ??
        json.meta?.total_pages ??
        json.meta?.totalPages ??
        (families.length < PER_PAGE ? page : page + 1);

      const totalFamilies =
        typeof json.pagination?.total === "number"
          ? json.pagination.total
          : null;

      return {
        families,
        totalPages: Math.max(1, totalPages),
        totalFamilies,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof MetadataUnavailableError) throw error;
      if (attempt === MAX_RETRIES - 1) break;
      await sleep(RETRY_BASE_MS * 2 ** attempt);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new MetadataUnavailableError(`Axis metadata unavailable: ${message}`);
}

async function downloadAllEndedFamilies(): Promise<AxisTaskFamily[]> {
  const first = await fetchPage(1);
  const all = [...first.families];
  const totalPages = first.totalPages;
  const expectedTotal = first.totalFamilies;
  const CONCURRENCY = PAGE_CONCURRENCY;

  for (let page = 2; page <= totalPages; page += CONCURRENCY) {
    const batch: number[] = [];
    for (let p = page; p < page + CONCURRENCY && p <= totalPages; p++) {
      batch.push(p);
    }
    const results = await Promise.all(batch.map((p) => fetchPage(p)));
    for (const next of results) {
      all.push(...next.families);
    }
  }

  const byId = new Map<string, AxisTaskFamily>();
  for (const family of all) {
    byId.set(String(family.id), family);
  }
  const unique = [...byId.values()];

  // Refuse to cache a clearly truncated download (would under-map skills).
  if (
    typeof expectedTotal === "number" &&
    expectedTotal > PER_PAGE &&
    unique.length < Math.floor(expectedTotal * 0.95)
  ) {
    throw new MetadataUnavailableError(
      `Incomplete Axis metadata download: got ${unique.length} unique families, expected ~${expectedTotal}`,
    );
  }

  return unique;
}

async function refreshMetadata(): Promise<AxisTaskFamily[]> {
  const families = await downloadAllEndedFamilies();
  globalThis.__axisTaskFamilyCache = {
    families,
    fetchedAt: Date.now(),
  };
  return families;
}

export async function fetchAxisTaskFamilies(options?: {
  forceRefresh?: boolean;
}): Promise<AxisTaskFamily[]> {
  const info = await fetchAxisTaskFamiliesWithInfo(options);
  return info.families;
}

/** Metadata fetch with cache/coalesce instrumentation. */
export async function fetchAxisTaskFamiliesWithInfo(options?: {
  forceRefresh?: boolean;
}): Promise<AxisMetadataFetchInfo> {
  const now = Date.now();
  const cached = globalThis.__axisTaskFamilyCache;

  if (
    !options?.forceRefresh &&
    cached &&
    now - cached.fetchedAt < CACHE_TTL_MS
  ) {
    return {
      families: cached.families,
      cacheHit: true,
      coalesced: false,
      usedStale: false,
    };
  }

  if (globalThis.__axisTaskFamilyInflight) {
    try {
      const families = await globalThis.__axisTaskFamilyInflight;
      return {
        families,
        cacheHit: false,
        coalesced: true,
        usedStale: false,
      };
    } catch (error) {
      if (cached) {
        return {
          families: cached.families,
          cacheHit: true,
          coalesced: true,
          usedStale: true,
        };
      }
      throw error;
    }
  }

  const inflight = refreshMetadata().finally(() => {
    globalThis.__axisTaskFamilyInflight = undefined;
  });
  globalThis.__axisTaskFamilyInflight = inflight;

  try {
    const families = await inflight;
    return {
      families,
      cacheHit: false,
      coalesced: false,
      usedStale: false,
    };
  } catch (error) {
    // Keep serving the last successful snapshot if a refresh fails.
    if (cached) {
      return {
        families: cached.families,
        cacheHit: true,
        coalesced: false,
        usedStale: true,
      };
    }
    throw error;
  }
}

export function clearAxisMetadataCache() {
  globalThis.__axisTaskFamilyCache = undefined;
  globalThis.__axisTaskFamilyInflight = undefined;
}

export function peekAxisMetadataCache(): CacheEntry | null {
  return globalThis.__axisTaskFamilyCache ?? null;
}
