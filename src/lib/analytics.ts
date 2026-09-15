import type {
  DailyBucket,
  MappedContribution,
  MetadataCoverage,
  ProfileAnalytics,
  ProfileSummary,
  SkillNode,
  ThemeStat,
} from "@/types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function titleCaseTheme(theme: string): string {
  if (!theme) return theme;
  return theme.charAt(0).toUpperCase() + theme.slice(1).toLowerCase();
}

function numericScores(contributions: MappedContribution[]): number[] {
  return contributions
    .map((c) => c.score)
    .filter((s): s is number => typeof s === "number" && Number.isFinite(s));
}

export function computeSummary(
  contributions: MappedContribution[],
): ProfileSummary {
  const uniqueTasks = new Set(contributions.map((c) => c.taskId));
  const scores = numericScores(contributions);
  const sum = scores.reduce((a, b) => a + b, 0);

  return {
    // Caller may overwrite with public search-attempts.total when available.
    onChainContributions: contributions.length,
    uniqueTasks: uniqueTasks.size,
    averageScore: scores.length ? round2(sum / scores.length) : 0,
    bestScore: scores.length ? Math.max(...scores) : 0,
  };
}

export function computeCoverage(
  contributions: MappedContribution[],
): MetadataCoverage {
  const uniqueTaskIds = [...new Set(contributions.map((c) => c.taskId))];
  const mappedTaskIds = new Set(
    contributions
      .filter((c) => c.metadataStatus === "mapped")
      .map((c) => c.taskId),
  );
  const mappedContributions = contributions.filter(
    (c) => c.metadataStatus === "mapped",
  ).length;

  const totalUniqueTasks = uniqueTaskIds.length;
  const mappedUniqueTasks = mappedTaskIds.size;
  const coveragePercent =
    totalUniqueTasks === 0
      ? 0
      : round2((mappedUniqueTasks / totalUniqueTasks) * 100);

  return {
    mappedUniqueTasks,
    totalUniqueTasks,
    coveragePercent,
    mappedContributions,
    totalContributions: contributions.length,
  };
}

export function computeSkills(contributions: MappedContribution[]): SkillNode[] {
  const mapped = contributions.filter((c) => c.metadataStatus === "mapped");
  const bySkill = new Map<
    string,
    {
      contributions: MappedContribution[];
      tasks: Set<string>;
      themes: Map<string, number>;
    }
  >();

  for (const c of mapped) {
    // One attempt contributes at most +1 per distinct skill (overlapping OK).
    const uniqueSkills = [...new Set(c.skills.filter(Boolean))];
    for (const skill of uniqueSkills) {
      let entry = bySkill.get(skill);
      if (!entry) {
        entry = { contributions: [], tasks: new Set(), themes: new Map() };
        bySkill.set(skill, entry);
      }
      entry.contributions.push(c);
      entry.tasks.add(c.taskId);
      if (c.theme) {
        const theme = titleCaseTheme(c.theme);
        entry.themes.set(theme, (entry.themes.get(theme) ?? 0) + 1);
      }
    }
  }

  const nodes: SkillNode[] = [...bySkill.entries()].map(([skill, entry]) => {
    const topEnvironments = [...entry.themes.entries()]
      .map(([theme, count]) => ({ theme, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const recentTasks = [...entry.contributions]
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, 8)
      .map((c) => ({
        taskId: c.taskId,
        taskName: c.taskName,
        score: c.score,
        timestamp: c.timestamp,
      }));

    return {
      skill,
      contributionCount: entry.contributions.length,
      uniqueTasks: entry.tasks.size,
      topEnvironments,
      recentTasks,
    };
  });

  return nodes.sort((a, b) => b.contributionCount - a.contributionCount);
}

export function computeThemes(contributions: MappedContribution[]): ThemeStat[] {
  // Prefer mapped metadata themes; include Hub theme hints for unmapped rows.
  const eligible = contributions.filter((c) => c.theme);
  const counts = new Map<string, number>();
  for (const c of eligible) {
    const theme = titleCaseTheme(c.theme as string);
    counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }

  const total = eligible.length || 1;
  return [...counts.entries()]
    .map(([theme, count]) => ({
      theme,
      count,
      percentage: round2((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

export function computeTimeline(
  contributions: MappedContribution[],
): DailyBucket[] {
  const byDay = new Map<
    string,
    { count: number; scoreSum: number; scoredCount: number }
  >();

  for (const c of contributions) {
    if (c.timestamp == null) continue;
    const date = new Date(c.timestamp * 1000).toISOString().slice(0, 10);
    const entry = byDay.get(date) ?? {
      count: 0,
      scoreSum: 0,
      scoredCount: 0,
    };
    entry.count += 1;
    if (typeof c.score === "number" && Number.isFinite(c.score)) {
      entry.scoreSum += c.score;
      entry.scoredCount += 1;
    }
    byDay.set(date, entry);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { count, scoreSum, scoredCount }]) => ({
      date,
      count,
      averageScore: scoredCount ? round2(scoreSum / scoredCount) : 0,
    }));
}

export function buildAnalytics(
  contributions: MappedContribution[],
  metadataAvailable: boolean,
): ProfileAnalytics {
  return {
    summary: computeSummary(contributions),
    coverage: computeCoverage(contributions),
    skills: metadataAvailable ? computeSkills(contributions) : [],
    themes: computeThemes(contributions),
    timeline: computeTimeline(contributions),
    metadataAvailable,
  };
}
