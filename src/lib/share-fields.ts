import type { ProfileAnalytics } from "@/types";

/** Derive optional share fields — omit when unavailable (no fake zeros). */
export function deriveShareFields(
  analytics: ProfileAnalytics,
  extras?: {
    hubTxhash?: {
      hubAttemptCount?: number;
      trajectoryCount?: number;
      unsignedAttemptCount?: number;
      withTxhash?: number;
      withoutTxhash?: number;
    } | null;
    baseRecordCount?: number | null;
  },
) {
  const { summary, coverage, skills, themes, metadataAvailable } = analytics;

  const topSkill =
    metadataAvailable && skills.length > 0
      ? [...skills].sort((a, b) => b.contributionCount - a.contributionCount)[0]
          ?.skill
      : undefined;

  const topEnvironment =
    themes.length > 0
      ? [...themes].sort((a, b) => b.count - a.count)[0]?.theme
      : undefined;

  const showCoverage =
    metadataAvailable &&
    coverage.totalUniqueTasks > 0 &&
    Number.isFinite(coverage.coveragePercent);

  const signed =
    extras?.hubTxhash?.trajectoryCount ?? extras?.hubTxhash?.withTxhash;
  const unsigned =
    extras?.hubTxhash?.unsignedAttemptCount ??
    extras?.hubTxhash?.withoutTxhash;

  return {
    contributionCount: summary.onChainContributions,
    uniqueTasks: summary.uniqueTasks,
    averageScore: summary.averageScore,
    bestScore: summary.bestScore,
    topSkill: topSkill || undefined,
    topEnvironment: topEnvironment
      ? topEnvironment.charAt(0).toUpperCase() + topEnvironment.slice(1)
      : undefined,
    metadataCoverage: showCoverage ? coverage.coveragePercent : undefined,
    signedAttempts: signed != null && signed >= 0 ? signed : undefined,
    unsignedAttempts: unsigned != null && unsigned >= 0 ? unsigned : undefined,
    baseRecords:
      extras?.baseRecordCount != null && extras.baseRecordCount > 0
        ? extras.baseRecordCount
        : undefined,
  };
}
