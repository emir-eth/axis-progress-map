/**
 * DEVELOPMENT FIXTURE — verified historical analytics for the reference wallet.
 *
 * Source: previously verified on-chain Base scan snapshot (776 RecordSubmitted
 * events) + Axis Hub metadata matching run. Full per-event JSON was not present
 * in the repo, so `contributions` is intentionally empty. Do not invent records.
 *
 * Served only when AXIS_USE_DEV_FIXTURE is enabled and the address matches.
 */
import type { ProfileAnalytics, ProfileResponse } from "@/types";

export const REFERENCE_WALLET =
  "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD" as const;

/** Verified snapshot totals (do not invent). */
export const REFERENCE_SNAPSHOT = {
  contributions: 776,
  uniqueTasks: 750,
  averageScore: 68.12,
  bestScore: 96,
  mappedUniqueTasks: 569,
  coveragePercent: 75.87,
  mappedContributions: 587,
} as const;

const MAPPED = REFERENCE_SNAPSHOT.mappedContributions;

function theme(themeName: string, count: number) {
  return {
    theme: themeName,
    count,
    percentage: Math.round((count / MAPPED) * 10000) / 100,
  };
}

function skill(name: string, contributionCount: number) {
  return {
    skill: name,
    contributionCount,
    /** Not recorded in the verified summary snapshot. */
    uniqueTasks: 0,
    topEnvironments: [] as { theme: string; count: number }[],
    recentTasks: [] as {
      taskId: string;
      taskName: string | null;
      score: number;
      timestamp: number | null;
    }[],
  };
}

const analytics: ProfileAnalytics = {
  summary: {
    onChainContributions: REFERENCE_SNAPSHOT.contributions,
    uniqueTasks: REFERENCE_SNAPSHOT.uniqueTasks,
    averageScore: REFERENCE_SNAPSHOT.averageScore,
    bestScore: REFERENCE_SNAPSHOT.bestScore,
  },
  coverage: {
    mappedUniqueTasks: REFERENCE_SNAPSHOT.mappedUniqueTasks,
    totalUniqueTasks: REFERENCE_SNAPSHOT.uniqueTasks,
    coveragePercent: REFERENCE_SNAPSHOT.coveragePercent,
    mappedContributions: REFERENCE_SNAPSHOT.mappedContributions,
    totalContributions: REFERENCE_SNAPSHOT.contributions,
  },
  skills: [
    skill("Pick", 583),
    skill("Place", 583),
    skill("Transfer", 103),
    skill("Stack", 76),
    skill("Open", 57),
    skill("Arrange", 12),
    skill("Rotate", 4),
  ],
  themes: [
    theme("kitchen", 287),
    theme("home", 192),
    theme("office", 49),
    theme("bathroom", 29),
    theme("play", 21),
    theme("workshop", 5),
    theme("general", 3),
  ],
  /** Daily timeline was not retained in the verified summary snapshot. */
  timeline: [],
  metadataAvailable: true,
};

export function buildReferenceWalletFixture(): ProfileResponse {
  return {
    address: REFERENCE_WALLET,
    generatedAt: new Date().toISOString(),
    /** Full event list not available in-repo; do not invent rows. */
    contributions: [],
    analytics,
    warnings: [],
    indexStatus: {
      dataSource: "development-fixture",
      freshness: "cached",
      lastSyncAt: null,
      lastIndexedBlock: 0,
      chainHead: null,
      blocksBehind: null,
      maxAgeMs: 0,
    },
    /** Populated by profile loader when Hub public lookup succeeds. */
    hubTrajectories: null,
    hubStatus: null,
    hubTxhash: null,
    baseVerification: {
      status: "none",
      recordSubmittedCount: null,
      lastVerifiedAt: null,
    },
    empty: false,
    timings: {
      totalMs: 0,
      sqliteMs: 0,
      metadataMs: 0,
      analyticsMs: 0,
      syncMs: 0,
      ethGetLogs: 0,
    },
  };
}

export function isReferenceWallet(address: string): boolean {
  return address.toLowerCase() === REFERENCE_WALLET.toLowerCase();
}
