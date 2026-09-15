/**
 * Unit tests for profile auto-resume decision helpers.
 * Usage: npx tsx scripts/test-profile-resume.ts
 */
import assert from "node:assert/strict";
import type { ProfileResponse } from "../src/types";
import {
  BASE_MAX_SOFT_POLLS,
  PROFILE_MAX_AUTO_RESUMES,
  PROFILE_MAX_SESSION_MS,
  isResumeSessionExhausted,
  isScanIncompleteStatus,
  mergeProfileResponse,
  shouldScheduleAutoResume,
  shouldScheduleBaseSoftPoll,
  shouldShowPrepPaused,
} from "../src/lib/profile-resume";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function stubProfile(
  partial: {
    address: string;
    scanStatus: "complete" | "incomplete";
    fetched?: number;
    total?: number;
  },
): ProfileResponse {
  const fetched = partial.fetched ?? 0;
  const total = partial.total ?? 0;
  return {
    address: partial.address as `0x${string}`,
    generatedAt: "2026-01-01T00:00:00.000Z",
    empty: false,
    contributions: [],
    analytics: {
      summary: {
        onChainContributions: fetched,
        uniqueTasks: 0,
        averageScore: 0,
        bestScore: 0,
      },
      coverage: {
        mappedUniqueTasks: 0,
        totalUniqueTasks: 0,
        coveragePercent: 0,
        mappedContributions: 0,
        totalContributions: fetched,
      },
      skills: [],
      themes: [],
      timeline: [],
      metadataAvailable: true,
    },
    warnings: [],
    timings: {
      totalMs: 1,
      sqliteMs: 0,
      metadataMs: 0,
      analyticsMs: 0,
      syncMs: 0,
      ethGetLogs: 0,
    },
    indexStatus: {
      dataSource:
        partial.scanStatus === "incomplete" ? "hub-incomplete" : "hub-cache",
      freshness: "fresh",
      lastSyncAt: null,
      lastIndexedBlock: 0,
      chainHead: null,
      blocksBehind: null,
      maxAgeMs: 60_000,
      scanStatus: partial.scanStatus,
      scanProgress: null,
      canResume: partial.scanStatus === "incomplete",
    },
    hubTrajectories: total || null,
    hubTxhash: null,
    hubStatus: {
      status: partial.scanStatus === "complete" ? "complete" : "incomplete",
      totalAttempts: total,
      fetchedAttempts: fetched,
      lastCompletedPage: 1,
      totalPages: 10,
      updatedAt: null,
    },
    baseVerification: {
      status: "none",
      recordSubmittedCount: null,
      lastVerifiedAt: null,
    },
  };
}

test("incomplete status detection", () => {
  assert.equal(
    isScanIncompleteStatus({ scanStatus: "incomplete" }),
    true,
  );
  assert.equal(
    isScanIncompleteStatus({ dataSource: "scan-incomplete" }),
    true,
  );
  assert.equal(
    isScanIncompleteStatus({ dataSource: "hub-incomplete" }),
    true,
  );
  assert.equal(
    isScanIncompleteStatus({ scanStatus: "complete", dataSource: "hub-cache" }),
    false,
  );
});

test("first incomplete response schedules auto-resume", () => {
  assert.equal(
    shouldScheduleAutoResume({
      scanStatus: "incomplete",
      canResume: true,
      autoResumeCount: 0,
      sessionElapsedMs: 0,
      pausedByUser: false,
      fetchInFlight: false,
    }),
    true,
  );
});

test("no overlapping fetch while in flight", () => {
  assert.equal(
    shouldScheduleAutoResume({
      scanStatus: "incomplete",
      canResume: true,
      autoResumeCount: 1,
      sessionElapsedMs: 5_000,
      pausedByUser: false,
      fetchInFlight: true,
    }),
    false,
  );
});

test("complete status does not schedule", () => {
  assert.equal(
    shouldScheduleAutoResume({
      scanStatus: "complete",
      canResume: false,
      autoResumeCount: 3,
      sessionElapsedMs: 10_000,
      pausedByUser: false,
      fetchInFlight: false,
    }),
    false,
  );
});

test("max auto resumes stops scheduling", () => {
  assert.equal(
    isResumeSessionExhausted(PROFILE_MAX_AUTO_RESUMES, 60_000),
    true,
  );
  assert.equal(
    shouldScheduleAutoResume({
      scanStatus: "incomplete",
      canResume: true,
      autoResumeCount: PROFILE_MAX_AUTO_RESUMES,
      sessionElapsedMs: 60_000,
      pausedByUser: false,
      fetchInFlight: false,
    }),
    false,
  );
});

test("max session duration stops scheduling", () => {
  assert.equal(
    isResumeSessionExhausted(5, PROFILE_MAX_SESSION_MS),
    true,
  );
  assert.equal(
    shouldScheduleAutoResume({
      scanStatus: "incomplete",
      canResume: true,
      autoResumeCount: 5,
      sessionElapsedMs: PROFILE_MAX_SESSION_MS,
      pausedByUser: false,
      fetchInFlight: false,
    }),
    false,
  );
});

test("user pause stops scheduling", () => {
  assert.equal(
    shouldScheduleAutoResume({
      scanStatus: "incomplete",
      canResume: true,
      autoResumeCount: 2,
      sessionElapsedMs: 10_000,
      pausedByUser: true,
      fetchInFlight: false,
    }),
    false,
  );
});

test("canResume false stops scheduling", () => {
  assert.equal(
    shouldScheduleAutoResume({
      scanStatus: "incomplete",
      canResume: false,
      autoResumeCount: 0,
      sessionElapsedMs: 0,
      pausedByUser: false,
      fetchInFlight: false,
    }),
    false,
  );
});

test("prep pause hidden while loading or resume scheduled", () => {
  assert.equal(
    shouldShowPrepPaused({
      softPaused: true,
      sessionExhausted: false,
      softLoading: true,
      resumeScheduled: false,
      canResume: false,
    }),
    false,
  );
  assert.equal(
    shouldShowPrepPaused({
      softPaused: false,
      sessionExhausted: false,
      softLoading: false,
      resumeScheduled: true,
      canResume: false,
    }),
    false,
  );
  assert.equal(
    shouldShowPrepPaused({
      softPaused: true,
      sessionExhausted: false,
      softLoading: false,
      resumeScheduled: false,
      canResume: true,
    }),
    true,
  );
  assert.equal(
    shouldShowPrepPaused({
      softPaused: false,
      sessionExhausted: false,
      softLoading: false,
      resumeScheduled: false,
      canResume: false,
    }),
    true,
  );
});

test("merge rejects wrong wallet", () => {
  const prev = stubProfile({
    address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    scanStatus: "incomplete",
    fetched: 100,
    total: 500,
  });
  const next = stubProfile({
    address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    scanStatus: "incomplete",
    fetched: 200,
    total: 500,
  });
  assert.equal(
    mergeProfileResponse(prev, next, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    null,
  );
});

test("merge keeps fetched monotonic for same total", () => {
  const addr = "0xcccccccccccccccccccccccccccccccccccccccc";
  const prev = stubProfile({
    address: addr,
    scanStatus: "incomplete",
    fetched: 1400,
    total: 1959,
  });
  const stale = stubProfile({
    address: addr,
    scanStatus: "incomplete",
    fetched: 1300,
    total: 1959,
  });
  const merged = mergeProfileResponse(prev, stale, addr);
  assert.ok(merged);
  assert.equal(merged!.hubStatus!.fetchedAttempts, 1400);
});

test("merge does not max across different Hub totals", () => {
  const addr = "0xdddddddddddddddddddddddddddddddddddddddd";
  const prev = stubProfile({
    address: addr,
    scanStatus: "incomplete",
    fetched: 1400,
    total: 1959,
  });
  const next = stubProfile({
    address: addr,
    scanStatus: "incomplete",
    fetched: 100,
    total: 2000,
  });
  const merged = mergeProfileResponse(prev, next, addr);
  assert.ok(merged);
  assert.equal(merged!.hubStatus!.fetchedAttempts, 100);
  assert.equal(merged!.hubStatus!.totalAttempts, 2000);
});

test("merge keeps complete profile over stale incomplete", () => {
  const addr = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const complete = stubProfile({
    address: addr,
    scanStatus: "complete",
    fetched: 864,
    total: 864,
  });
  const incomplete = stubProfile({
    address: addr,
    scanStatus: "incomplete",
    fetched: 800,
    total: 864,
  });
  const merged = mergeProfileResponse(complete, incomplete, addr);
  assert.equal(merged, complete);
});

test("merge does not regress Base complete to verifying", () => {
  const addr = "0xffffffffffffffffffffffffffffffffffffffff";
  const prev = stubProfile({
    address: addr,
    scanStatus: "complete",
    fetched: 10,
    total: 10,
  });
  prev.baseVerification = {
    status: "complete",
    recordSubmittedCount: 836,
    lastVerifiedAt: "2026-09-01T00:00:00.000Z",
  };
  const stale = stubProfile({
    address: addr,
    scanStatus: "complete",
    fetched: 10,
    total: 10,
  });
  stale.baseVerification = {
    status: "incomplete",
    recordSubmittedCount: 100,
    lastVerifiedAt: null,
  };
  const merged = mergeProfileResponse(prev, stale, addr);
  assert.ok(merged);
  assert.equal(merged!.baseVerification.status, "complete");
  assert.equal(merged!.baseVerification.recordSubmittedCount, 836);
});

test("Base soft poll schedules for incomplete and none only", () => {
  assert.equal(
    shouldScheduleBaseSoftPoll({
      hubScanIncomplete: false,
      baseStatus: "incomplete",
      softPollCount: 0,
      pausedByUser: false,
      fetchInFlight: false,
    }),
    true,
  );
  assert.equal(
    shouldScheduleBaseSoftPoll({
      hubScanIncomplete: false,
      baseStatus: "none",
      softPollCount: 0,
      pausedByUser: false,
      fetchInFlight: false,
    }),
    true,
  );
  assert.equal(
    shouldScheduleBaseSoftPoll({
      hubScanIncomplete: false,
      baseStatus: "complete",
      softPollCount: 0,
      pausedByUser: false,
      fetchInFlight: false,
    }),
    false,
  );
  assert.equal(
    shouldScheduleBaseSoftPoll({
      hubScanIncomplete: true,
      baseStatus: "incomplete",
      softPollCount: 0,
      pausedByUser: false,
      fetchInFlight: false,
    }),
    false,
  );
  assert.equal(
    shouldScheduleBaseSoftPoll({
      hubScanIncomplete: false,
      baseStatus: "incomplete",
      softPollCount: BASE_MAX_SOFT_POLLS,
      pausedByUser: false,
      fetchInFlight: false,
    }),
    false,
  );
  assert.equal(
    shouldScheduleBaseSoftPoll({
      hubScanIncomplete: false,
      baseStatus: "incomplete",
      softPollCount: 1,
      pausedByUser: false,
      fetchInFlight: true,
    }),
    false,
  );
});

console.log("\nprofile-resume tests done");
