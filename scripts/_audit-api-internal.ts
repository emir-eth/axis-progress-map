async function main() {
  const addr = "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD";
  const res = await fetch("http://127.0.0.1:3010/api/profile/" + addr);
  const j = await res.json();
  const contribs = j.contributions || [];
  const mapped = contribs.filter(
    (c: { metadataStatus: string }) => c.metadataStatus === "mapped",
  ).length;
  const unmapped = contribs.length - mapped;
  const bySkill = new Map<string, number>();
  for (const c of contribs) {
    if (c.metadataStatus !== "mapped") continue;
    const skills = [...new Set((c.skills || []).filter(Boolean))];
    for (const s of skills as string[]) {
      bySkill.set(s, (bySkill.get(s) || 0) + 1);
    }
  }
  const focus = [
    "Pick",
    "Place",
    "Transfer",
    "Stack",
    "Open",
    "Arrange",
    "Rotate",
  ];
  const fromContribs: Record<string, number> = {};
  const fromAnalytics: Record<string, number> = {};
  for (const s of focus) {
    fromContribs[s] = bySkill.get(s) || 0;
    fromAnalytics[s] =
      j.analytics.skills.find((x: { skill: string }) => x.skill === s)
        ?.contributionCount ?? 0;
  }
  const uniqTasks = new Set(contribs.map((c: { taskId: string }) => c.taskId));
  const mappedTasks = new Set(
    contribs
      .filter((c: { metadataStatus: string }) => c.metadataStatus === "mapped")
      .map((c: { taskId: string }) => c.taskId),
  );
  const covIndep =
    Math.round((mappedTasks.size / uniqTasks.size) * 10000) / 100;
  const themesFrom = new Map<string, number>();
  for (const c of contribs) {
    if (!c.theme) continue;
    const t =
      String(c.theme).charAt(0).toUpperCase() +
      String(c.theme).slice(1).toLowerCase();
    themesFrom.set(t, (themesFrom.get(t) || 0) + 1);
  }
  console.log(
    JSON.stringify(
      {
        traj: j.analytics.summary.onChainContributions,
        hubTxhash: j.hubTxhash,
        contribs: contribs.length,
        mapped,
        unmapped,
        coverageApi: j.analytics.coverage,
        coverageFromContribs: {
          mappedUniqueTasks: mappedTasks.size,
          totalUniqueTasks: uniqTasks.size,
          coveragePercent: covIndep,
        },
        skillsInternalMatch: focus.every(
          (s) => fromContribs[s] === fromAnalytics[s],
        ),
        fromContribs,
        fromAnalytics,
        themesApi: j.analytics.themes.slice(0, 5),
        themesFromContribs: [...themesFrom.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5),
        dataSource: j.indexStatus.dataSource,
        warnings: j.warnings,
        base: j.baseVerification,
        sampleDates: contribs.slice(0, 3).map((c: {
          attemptId: number;
          timestamp: number | null;
          completed_at?: string;
        }) => ({
          attemptId: c.attemptId,
          timestamp: c.timestamp,
          iso:
            c.timestamp != null
              ? new Date(c.timestamp * 1000).toISOString()
              : null,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
