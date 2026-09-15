/**
 * Slim Base helpers kept for address validation and shared constants.
 * Per-wallet eth_getLogs scanning lives in lib/wallet-scan.ts.
 * Legacy global indexing lives in lib/indexer.ts (CLI only).
 */
import { getAddress, isAddress, type Address } from "viem";

export const AXIS_CONTRIBUTION_CONTRACT =
  "0xF91A90baA9E044Da084df369445A59D859d640dB" as const;

export const RECORD_SUBMITTED_TOPIC =
  "0x6d77e907890f072253fbef2eb8d17cd30e09e409799f01195372185adc5313fd" as const;

/**
 * Verified via eth_getCode binary search (scripts/find-deployment-block.ts):
 * block 43731411 empty, 43731412 has bytecode.
 */
export const DEFAULT_AXIS_START_BLOCK = 43_731_412;

export function normalizeAddress(input: string): Address {
  const trimmed = input.trim();
  if (!isAddress(trimmed)) {
    throw new Error("INVALID_ADDRESS");
  }
  return getAddress(trimmed);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getAxisStartBlock(): number {
  return parsePositiveInt(process.env.AXIS_START_BLOCK, DEFAULT_AXIS_START_BLOCK);
}
