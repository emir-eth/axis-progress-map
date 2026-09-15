import { loadProfileData } from "../src/lib/profile-data";

async function main() {
  const t0 = Date.now();
  const r = await loadProfileData(
    "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD",
  );
  const ms = Date.now() - t0;
  if (!r.ok) {
    console.error(r);
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ms,
        dataSource: r.profile.indexStatus.dataSource,
        contribs: r.profile.analytics.summary.onChainContributions,
        avg: r.profile.analytics.summary.averageScore,
        ethGetLogs: r.profile.timings?.ethGetLogs,
        contribRows: r.profile.contributions.length,
      },
      null,
      2,
    ),
  );
}

main();
