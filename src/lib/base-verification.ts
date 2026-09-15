/**
 * Secondary Base RecordSubmitted verification.
 *
 * Hub remains the primary profile data source. This module only maintains
 * wallet_cache / wallet_events for an independent on-chain check, using the
 * existing resumable scanner + Turso persistence.
 */
import { type Address } from "viem";
import {
  countCachedWalletEvents,
  getWalletCache,
  markWalletCacheRefreshFailed,
  persistIncompleteRangeProgress,
  saveCompleteWalletCache,
  upsertWalletEvents,
} from "@/lib/db";
import type { BaseVerificationStatus } from "@/types";
import {
  getSafeChainHead,
  getWalletScanBudgetMs,
  getWalletScanStartBlock,
  RateLimitedError,
  RpcUnavailableError,
  scanWalletBlockRange,
  type GetBlockNumberFn,
  type GetLogsFn,
} from "@/lib/wallet-scan";

/** Leave headroom under Vercel maxDuration=60s for Hub + JSON. */
export const BASE_VERIFICATION_REQUEST_CAP_MS = 55_000;

export interface EnsureBaseVerificationOptions {
  budgetMs?: number;
  getLogs?: GetLogsFn;
  getBlockNumber?: GetBlockNumberFn;
  now?: () => number;
  resolveTimestamps?: boolean;
  /** Skip live RPC and only read Turso (tests / no remaining budget). */
  readOnly?: boolean;
}

function snapshot(
  status: BaseVerificationStatus["status"],
  count: number | null,
  updatedAtMs: number | null,
): BaseVerificationStatus {
  return {
    status,
    recordSubmittedCount: count,
    lastVerifiedAt:
      updatedAtMs != null ? new Date(updatedAtMs).toISOString() : null,
  };
}

export async function readBaseVerification(
  addressLower: string,
): Promise<BaseVerificationStatus> {
  const cache = await getWalletCache(addressLower);
  if (!cache) {
    return snapshot("none", null, null);
  }
  const count = await countCachedWalletEvents(addressLower);
  if (cache.status === "complete") {
    return snapshot("complete", count, cache.updatedAt);
  }
  return snapshot("incomplete", count, cache.updatedAt);
}

/**
 * Resume or start a budgeted Base verification scan for one wallet.
 * Never throws into Hub profile construction — RPC failures degrade gracefully.
 */
export async function ensureBaseVerification(
  address: Address,
  options: EnsureBaseVerificationOptions = {},
): Promise<BaseVerificationStatus & { ethGetLogs: number }> {
  const addressLower = address.toLowerCase();
  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? getWalletScanBudgetMs();

  if (options.readOnly || budgetMs < 800) {
    const read = await readBaseVerification(addressLower);
    return { ...read, ethGetLogs: 0 };
  }

  let ethGetLogs = 0;

  try {
    const cache = await getWalletCache(addressLower);
    const safeHead = await getSafeChainHead(options.getBlockNumber);

    // Complete cache → incremental tip-up. Never demote to incomplete mid-refresh.
    if (cache?.status === "complete") {
      const fromBlock = cache.lastScannedBlock + 1;
      if (fromBlock > safeHead) {
        return {
          ...(await readBaseVerification(addressLower)),
          ethGetLogs: 0,
        };
      }

      const scan = await scanWalletBlockRange({
        user: address,
        fromBlock,
        toBlock: safeHead,
        deadlineMs: now() + budgetMs,
        getLogs: options.getLogs,
        resolveTimestamps: options.resolveTimestamps,
        onRangeComplete: async ({ toBlock, records }) => {
          await upsertWalletEvents(addressLower, records);
          await saveCompleteWalletCache(addressLower, toBlock, now());
        },
      });
      ethGetLogs = scan.stats.ethGetLogs;

      if (scan.scannedThroughBlock >= fromBlock) {
        await saveCompleteWalletCache(
          addressLower,
          scan.scannedThroughBlock,
          now(),
        );
      }

      return {
        ...(await readBaseVerification(addressLower)),
        ethGetLogs,
      };
    }

    // Cold start or resume incomplete historical scan.
    const startBlock = getWalletScanStartBlock();
    const fromBlock = cache ? cache.lastScannedBlock + 1 : startBlock;
    const targetBlock = cache?.targetBlock ?? safeHead;

    if (fromBlock > targetBlock) {
      await saveCompleteWalletCache(addressLower, targetBlock, now());
      return {
        ...(await readBaseVerification(addressLower)),
        ethGetLogs: 0,
      };
    }

    const scan = await scanWalletBlockRange({
      user: address,
      fromBlock,
      toBlock: targetBlock,
      deadlineMs: now() + budgetMs,
      getLogs: options.getLogs,
      resolveTimestamps: options.resolveTimestamps,
      onRangeComplete: async ({ toBlock, records }) => {
        await persistIncompleteRangeProgress(
          addressLower,
          records,
          toBlock,
          targetBlock,
          now(),
        );
      },
    });
    ethGetLogs = scan.stats.ethGetLogs;

    if (scan.completed) {
      await saveCompleteWalletCache(
        addressLower,
        scan.scannedThroughBlock,
        now(),
      );
    }

    return {
      ...(await readBaseVerification(addressLower)),
      ethGetLogs,
    };
  } catch (err) {
    if (
      err instanceof RateLimitedError ||
      err instanceof RpcUnavailableError ||
      err instanceof Error
    ) {
      try {
        await markWalletCacheRefreshFailed(
          addressLower,
          err instanceof Error ? err.message : String(err),
          now(),
        );
      } catch {
        /* ignore secondary persist failure */
      }
    }
    const read = await readBaseVerification(addressLower);
    return { ...read, ethGetLogs };
  }
}

/** How much of the request budget remains for secondary Base work. */
export function remainingBaseVerificationBudgetMs(
  requestStartedMs: number,
  requestedBudgetMs?: number,
  nowMs: number = Date.now(),
): number {
  const remaining = Math.max(
    0,
    BASE_VERIFICATION_REQUEST_CAP_MS - (nowMs - requestStartedMs),
  );
  const wanted = requestedBudgetMs ?? getWalletScanBudgetMs();
  return Math.min(wanted, remaining);
}
