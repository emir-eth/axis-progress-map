/** Extract Hub UI binding for portfolio Trajectories label. */
async function main() {
  const url = "https://hub.axisrobotics.ai/assets/app-entry-Cmn2AA9h.js";
  const txt = await (await fetch(url)).text();
  const needle = 'etd-stat-label",children:"Trajectories"';
  const i = txt.indexOf(needle);
  console.log("Trajectories label idx", i);
  if (i >= 0) {
    console.log(txt.slice(i - 600, i + 900).replace(/\s+/g, " "));
  }

  // Find profile field usage near Trajectories
  let from = 0;
  let n = 0;
  while (n < 12) {
    const k = txt.indexOf(".trajectories", from);
    if (k < 0) break;
    const snip = txt.slice(Math.max(0, k - 100), k + 140).replace(/\s+/g, " ");
    if (!snip.includes("completedTrajectories") && !snip.includes("MuJoCo")) {
      console.log("\n.trajectories", snip);
      n += 1;
    }
    from = k + 1;
  }

  // Leaderboard column headers
  for (const label of [
    "TRAJECTORIES",
    "Trajectories",
    "Tasks Done",
    "tasks_done",
    "has_txhash",
  ]) {
    console.log(`\ncount(${label})=${txt.split(label).length - 1}`);
  }

  const lb = txt.indexOf("ofn=");
  console.log("\nofn snippet", txt.slice(lb, lb + 200));

  // Find leaderboard table column definitions
  const colNeedle = "wallet_address";
  from = 0;
  n = 0;
  while (n < 6) {
    const k = txt.indexOf(colNeedle, from);
    if (k < 0) break;
    console.log("\nwallet_address", txt.slice(k - 120, k + 180).replace(/\s+/g, " "));
    from = k + 1;
    n += 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
