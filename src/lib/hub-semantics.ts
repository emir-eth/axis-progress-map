/**
 * Hub activity semantics (public search-attempts).
 *
 * TRAJECTORIES (headline) = public search-attempts.total / all cached Hub rows
 * SIGNED ATTEMPTS = rows with a valid non-null/non-empty txhash
 * UNSIGNED ATTEMPTS = rows without a usable txhash
 */
import { normalizeHubTxhash } from "@/lib/hub-attempts";

export interface HubSemanticCounts {
  hubAttemptCount: number;
  /** Signed attempts (valid txhash). */
  trajectoryCount: number;
  unsignedAttemptCount: number;
}

export function hasValidHubTxhash(
  txhash: string | null | undefined,
): boolean {
  return normalizeHubTxhash(txhash) != null;
}

export function isTrajectoryContribution(c: {
  transactionHash?: string | null;
}): boolean {
  return hasValidHubTxhash(c.transactionHash ?? null);
}

/** @deprecated Prefer isSignedHubAttempt / hasValidHubTxhash naming in new code. */
export const isSignedHubAttempt = isTrajectoryContribution;

export function computeHubSemanticCounts(
  rows: Array<{ txhash?: string | null; transactionHash?: string | null }>,
): HubSemanticCounts {
  let trajectoryCount = 0;
  let unsignedAttemptCount = 0;
  for (const row of rows) {
    const raw =
      row.transactionHash != null && row.transactionHash !== ""
        ? row.transactionHash
        : row.txhash;
    if (hasValidHubTxhash(raw)) trajectoryCount += 1;
    else unsignedAttemptCount += 1;
  }
  return {
    hubAttemptCount: rows.length,
    trajectoryCount,
    unsignedAttemptCount,
  };
}

export function filterTrajectoryContributions<
  T extends { transactionHash: string | null },
>(rows: T[]): T[] {
  return rows.filter((r) => isTrajectoryContribution(r));
}

export function filterUnsignedContributions<
  T extends { transactionHash: string | null },
>(rows: T[]): T[] {
  return rows.filter((r) => !isTrajectoryContribution(r));
}
