/**
 * Pure helpers for Hub history auto-resume UX.
 * No network — unit-tested separately from ProfileView.
 */

import type { ProfileResponse } from "@/types";

export const PROFILE_RESUME_DELAY_MS = 2_000;
export const PROFILE_MAX_AUTO_RESUMES = 40;
/** Hub pagination sessions finish far faster than Base scans. */
export const PROFILE_MAX_SESSION_MS = 3 * 60_000; // 3 minutes

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
        return {
          ...incoming,
          hubStatus: {
            ...incoming.hubStatus,
            fetchedAttempts: fetched,
          },
        };
      }
    }
  }

  return incoming;
}
