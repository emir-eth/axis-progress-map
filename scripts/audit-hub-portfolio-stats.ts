/** Find portfolio profile Trajectories binding from me/profile fields. */
async function main() {
  const url = "https://hub.axisrobotics.ai/assets/app-entry-Cmn2AA9h.js";
  const txt = await (await fetch(url)).text();

  for (const needle of [
    "completed_tasks",
    "approval_rate",
    "perfect_rate",
    "nfn()",
    'children:"Verified"',
    'children:"Avg Score"',
    "uportfolio",
    "Portfolio",
  ]) {
    console.log(`\n===== ${needle} count=${txt.split(needle).length - 1} =====`);
    let from = 0;
    let n = 0;
    while (n < 4) {
      const k = txt.indexOf(needle, from);
      if (k < 0) break;
      const snip = txt.slice(Math.max(0, k - 140), k + 200).replace(/\s+/g, " ");
      // skip mujoco noise
      if (!snip.includes("MuJoCo") && !snip.includes("completedTrajectories")) {
        console.log(snip);
        console.log("---");
        n += 1;
      }
      from = k + needle.length;
    }
  }

  // Look for profile.trajectories or e.trajectories style
  const re = /[a-zA-Z0-9_$?]+\.trajectories/g;
  const seen = new Set<string>();
  for (const m of txt.matchAll(re)) {
    const s = m[0];
    if (s.includes("completed")) continue;
    seen.add(s);
  }
  console.log("\nunique *.trajectories identifiers", [...seen].slice(0, 30));

  // Search for portfolio stats render near "Trajectories" that is NOT slots
  let from = 0;
  let n = 0;
  while (n < 8) {
    const k = txt.indexOf('children:"Trajectories"', from);
    if (k < 0) break;
    console.log("\nTrajectories@", k, txt.slice(k - 250, k + 350).replace(/\s+/g, " "));
    from = k + 1;
    n += 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
