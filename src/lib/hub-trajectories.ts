/**
 * Public Axis Hub attempt totals (read-only).
 *
 * GET /api/stats/search-attempts?q=<wallet> → `total`
 * = Hub recorded attempts / Hub trajectories — NOT on-chain RecordSubmitted.
 */
const HUB_SEARCH_ATTEMPTS_URL =
  "https://hub.axisrobotics.ai/api/stats/search-attempts";

/** Keep profile load snappy — prefer null over slow Hub. */
const HUB_TIMEOUT_MS = 2_500;

export type FetchHubTrajectoriesFn = (
  wallet: string,
) => Promise<number | null>;

/**
 * Returns Hub `total` for a wallet search, or null if unavailable.
 * Never throws; never fakes 0 on failure.
 */
export async function fetchHubTrajectoriesTotal(
  wallet: string,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<number | null> {
  const timeoutMs = options?.timeoutMs ?? HUB_TIMEOUT_MS;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(HUB_SEARCH_ATTEMPTS_URL);
    url.searchParams.set("q", wallet);
    url.searchParams.set("page", "1");
    url.searchParams.set("limit", "1");

    const res = await fetchImpl(url.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; AxisProgressMap/0.1)",
      },
      cache: "no-store",
    });

    if (!res.ok) return null;

    const body: unknown = await res.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("total" in body) ||
      typeof (body as { total: unknown }).total !== "number"
    ) {
      return null;
    }

    const total = (body as { total: number }).total;
    if (!Number.isFinite(total) || total < 0) return null;
    return total;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
