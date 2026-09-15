import { isAddress, getAddress } from "viem";

export function isValidWalletAddress(value: string): boolean {
  return isAddress(value.trim());
}

export function checksumAddress(value: string): `0x${string}` {
  return getAddress(value.trim());
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function formatScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "—";
  return Number.isInteger(score) ? String(score) : score.toFixed(2);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDate(timestamp: number | null): string {
  if (timestamp == null) return "—";
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Concise table date (no time). */
export function formatDateShort(timestamp: number | null): string {
  if (timestamp == null) return "—";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Full ISO string for tooltips; undefined when missing. */
export function formatTimestampIso(timestamp: number | null): string | undefined {
  if (timestamp == null) return undefined;
  return new Date(timestamp * 1000).toISOString();
}

const MONTHS_SHORT = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

/**
 * Top-right Hub freshness label.
 *
 * - fresh → just verified against public Hub this request
 * - cached / stale → real persisted Hub verification time (never page-load time)
 */
export function formatHubActivityFreshnessLabel(opts: {
  freshness: "fresh" | "cached" | "stale";
  /** ISO string from hub_wallet_cache.updated_at (via lastSyncAt / hubStatus.updatedAt). */
  lastVerifiedAt: string | null | undefined;
  nowMs?: number;
}): string {
  if (opts.freshness === "fresh") {
    return "FROM PUBLIC HUB ACTIVITY";
  }

  const raw = opts.lastVerifiedAt?.trim();
  if (!raw) {
    // No real timestamp available — do not invent one.
    return "FROM PUBLIC HUB ACTIVITY";
  }

  const then = Date.parse(raw);
  if (!Number.isFinite(then)) {
    return "FROM PUBLIC HUB ACTIVITY";
  }

  const now = opts.nowMs ?? Date.now();
  const deltaMs = Math.max(0, now - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (deltaMs < minute) {
    return "UPDATED JUST NOW";
  }
  if (deltaMs < hour) {
    const mins = Math.floor(deltaMs / minute);
    return `UPDATED ${mins} MIN AGO`;
  }
  if (deltaMs < day) {
    const hours = Math.floor(deltaMs / hour);
    return `UPDATED ${hours} HOUR${hours === 1 ? "" : "S"} AGO`;
  }

  const d = new Date(then);
  const month = MONTHS_SHORT[d.getUTCMonth()] ?? "JAN";
  const dayNum = d.getUTCDate();
  const year = d.getUTCFullYear();
  return `UPDATED ${month} ${dayNum}, ${year}`;
}

export function baseScanTxUrl(hash: string): string {
  const normalized = hash.startsWith("0x") ? hash : `0x${hash}`;
  return `https://basescan.org/tx/${normalized}`;
}

export function baseScanAddressUrl(address: string): string {
  return `https://basescan.org/address/${address}`;
}
