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

export function baseScanTxUrl(hash: string): string {
  const normalized = hash.startsWith("0x") ? hash : `0x${hash}`;
  return `https://basescan.org/tx/${normalized}`;
}

export function baseScanAddressUrl(address: string): string {
  return `https://basescan.org/address/${address}`;
}
