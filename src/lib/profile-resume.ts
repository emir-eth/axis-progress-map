/**
 * Pure helpers for Hub history auto-resume UX.
 * No network — unit-tested separately from ProfileView.
 */

import type { BaseVerificationStatus, ProfileResponse } from "@/types";

export const PROFILE_RESUME_DELAY_MS = 2_000;
export const PROFILE_MAX_AUTO_RESUMES = 40;
/** Hub pagination sessions finish far faster than Base scans. */
export const PROFILE_MAX_SESSION_MS = 3 * 60_000; // 3 minutes

/** Soft-continue delay for secondary Base verification (Hub already complete). */
export const BASE_SOFT_POLL_DELAY_MS = 4_000;
/**
 * Cap soft Base passes per profile session. Each pass may spend up to the
 * server Base budget; this is NOT an overlapping request storm.
 */
export const BASE_MAX_SOFT_POLLS = 90;

export interface ResumeDecisionInput {
  scanStatus?: "complete" | "incomplete";
  canResume?: boolean;
  dataSource?: string;
  autoResumeCount: number;
  sessionElapsedMs: number;
  pausedByUser: boolean;
  fetchInFlight: boolean;
}

export function isScanIncompleteStatus(input: {
  scanStatus?: "complete" | "incomplete";
  dataSource?: string;
}): boolean {
  return (
    input.scanStatus === "incomplete" ||
    input.dataSource === "scan-incomplete" ||
    input.dataSource === "hub-incomplete"
  );
}

export function isResumeSessionExhausted(
  autoResumeCount: number,
  sessionElapsedMs: number,
  maxResumes = PROFILE_MAX_AUTO_RESUMES,
  maxSessionMs = PROFILE_MAX_SESSION_MS,
): boolean {
  return autoResumeCount >= maxResumes || sessionElapsedMs >= maxSessionMs;
}

/**
 * Whether ProfileView should schedule another soft profile fetch.
 */
export function shouldScheduleAutoResume(input: ResumeDecisionInput): boolean {
  if (input.pausedByUser) return false;
  if (input.fetchInFlight) return false;
  if (!isScanIncompleteStatus(input)) return false;
  if (input.canResume === false) return false;
  if (
    isResumeSessionExhausted(input.autoResumeCount, input.sessionElapsedMs)
  ) {
    return false;
  }
  return true;
}

/**
 * Whether the preparation UI should show an actionable paused state.
 * Automatic work still possible (in flight, scheduled, or resumable) → syncing.
 */
export function shouldShowPrepPaused(input: {
  softPaused: boolean;
  sessionExhausted: boolean;
  softLoading: boolean;
  resumeScheduled: boolean;
  canResume?: boolean;
}): boolean {
  if (input.softLoading || input.resumeScheduled) return false;
  if (input.softPaused) return true;
  if (input.sessionExhausted) return true;
  if (input.canResume === false) return true;
  return false;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function baseStatusRank(status: BaseVerificationStatus["status"]): number {
  if (status === "complete") return 2;
  if (status === "incomplete") return 1;
  return 0;
}

/**
 * Keep Base verification UI monotonic across out-of-order soft responses.
 * Complete never regresses to Verifying / Not available.
 */
export function mergeBaseVerificationStatus(
  previous: BaseVerificationStatus | null | undefined,
  incoming: BaseVerificationStatus,
): BaseVerificationStatus {
  if (!previous) return incoming;

  if (baseStatusRank(previous.status) > baseStatusRank(incoming.status)) {
    return previous;
  }

  if (
    previous.status === "complete" &&
    incoming.status === "complete"
  ) {
    const prevCount = previous.recordSubmittedCount ?? 0;
    const nextCount = incoming.recordSubmittedCount ?? 0;
    return {
      ...incoming,
      recordSubmittedCount: Math.max(prevCount, nextCount),
      lastVerifiedAt:
        nextCount >= prevCount
          ? incoming.lastVerifiedAt ?? previous.lastVerifiedAt
          : previous.lastVerifiedAt ?? incoming.lastVerifiedAt,
    };
  }

  if (
    previous.status === "incomplete" &&
    incoming.status === "incomplete"
  ) {
    const prevCount = previous.recordSubmittedCount ?? 0;
    const nextCount = incoming.recordSubmittedCount ?? 0;
    return {
      ...incoming,
      recordSubmittedCount:
        previous.recordSubmittedCount == null &&
        incoming.recordSubmittedCount == null
          ? null
          : Math.max(prevCount, nextCount),
    };
  }

  return incoming;
}

/** Whether ProfileView should soft-continue secondary Base verification. */
export function shouldScheduleBaseSoftPoll(input: {
  hubScanIncomplete: boolean;
  baseStatus: BaseVerificationStatus["status"];
  softPollCount: number;
  pausedByUser: boolean;
  fetchInFlight: boolean;
  maxSoftPolls?: number;
}): boolean {
  if (input.pausedByUser) return false;
  if (input.fetchInFlight) return false;
  if (input.hubScanIncomplete) return false;
  if (input.baseStatus === "complete") return false;
  // incomplete: resume checkpoint; none: retry when prior pass lacked budget/RPC
  if (input.baseStatus !== "incomplete" && input.baseStatus !== "none") {
    return false;
  }
  const max = input.maxSoftPolls ?? BASE_MAX_SOFT_POLLS;
  if (input.softPollCount >= max) return false;
  return true;
}

/**
 * Apply an incoming profile response without regressing preparation progress
 * or replacing a complete profile with a stale incomplete freshness response.
 *
 * Returns null when the response belongs to a different wallet than expected.
 */
export function mergeProfileResponse(
  previous: ProfileResponse | null,
  incoming: ProfileResponse,
  expectedAddress: string,
): ProfileResponse | null {
  if (!sameAddress(incoming.address, expectedAddress)) {
    return null;
  }

  if (!previous || !sameAddress(previous.address, incoming.address)) {
    return incoming;
  }

  const prevIncomplete = isScanIncompleteStatus({
    scanStatus: previous.indexStatus.scanStatus,
    dataSource: previous.indexStatus.dataSource,
  });
  const nextIncomplete = isScanIncompleteStatus({
    scanStatus: incoming.indexStatus.scanStatus,
    dataSource: incoming.indexStatus.dataSource,
  });

  // Keep a usable complete snapshot visible during ordinary freshness work.
  if (!prevIncomplete && nextIncomplete) {
    return previous;
  }

  let merged: ProfileResponse = incoming;

  if (
    prevIncomplete &&
    nextIncomplete &&
    previous.hubStatus &&
    incoming.hubStatus
  ) {
    const prevTotal = previous.hubStatus.totalAttempts;
    const nextTotal = incoming.hubStatus.totalAttempts;
    // Same Hub total snapshot → fetched must be monotonic.
    if (prevTotal > 0 && prevTotal === nextTotal) {
      const fetched = Math.max(
        previous.hubStatus.fetchedAttempts,
        incoming.hubStatus.fetchedAttempts,
      );
      if (fetched !== incoming.hubStatus.fetchedAttempts) {
        merged = {
          ...incoming,
          hubStatus: {
            ...incoming.hubStatus,
            fetchedAttempts: fetched,
          },
        };
      }
    }
  }

  return {
    ...merged,
    baseVerification: mergeBaseVerificationStatus(
      previous.baseVerification,
      merged.baseVerification,
    ),
  };
}
