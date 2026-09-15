/** Dig into me/profile consumer and leaderboard column metrics. */
async function main() {
  const url = "https://hub.axisrobotics.ai/assets/app-entry-Cmn2AA9h.js";
  const txt = await (await fetch(url)).text();

  const i = txt.indexOf('"/me/profile"');
  console.log("me/profile idx", i);
  console.log(txt.slice(i - 80, i + 200));

  // Find all string literals that look like profile fields
  const fields = [
    "trajectories",
    "trajectory_count",
    "total_trajectories",
    "completed_task",
    "tasks_completed",
    "avg_trajectory",
    "verified_percent",
    "txhash_count",
    "signed_count",
  ];
  for (const f of fields) {
    const c = txt.split(`"${f}"`).length - 1 + (txt.split(`'${f}'`).length - 1);
    console.log(`literal ${f}: ${c}`);
  }

  // has_txhash contexts
  let from = 0;
  let n = 0;
  while (n < 5) {
    const k = txt.indexOf("has_txhash", from);
    if (k < 0) break;
    console.log("\nhas_txhash", txt.slice(k - 160, k + 200).replace(/\s+/g, " "));
    from = k + 1;
    n += 1;
  }

  // Leaderboard UI strings
  for (const s of [
    "Leaderboard",
    "leaderboard",
    "Rank",
    "Approval",
    "Points",
    "operator_short",
  ]) {
    console.log(`count ${s}=${txt.split(s).length - 1}`);
  }

  // Search for ofn( or afn( call sites
  from = 0;
  n = 0;
  while (n < 8) {
    const k = txt.indexOf("ofn(", from);
    if (k < 0) break;
    console.log("\nofn(", txt.slice(k, k + 180).replace(/\s+/g, " "));
    from = k + 1;
    n += 1;
  }
  from = 0;
  n = 0;
  while (n < 8) {
    const k = txt.indexOf("afn(", from);
    if (k < 0) break;
    console.log("\nafn(", txt.slice(k, k + 180).replace(/\s+/g, " "));
    from = k + 1;
    n += 1;
  }

  // Portfolio history / stats labels in UI
  for (const s of ["Signed", "Unsigned", "Unverified", "Verified", "History"]) {
    console.log(`\nUI ${s} count=${txt.split(s).length - 1}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
