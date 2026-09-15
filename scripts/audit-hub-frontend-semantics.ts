/**
 * Download Hub frontend bundle and extract trajectory/leaderboard semantics.
 * Read-only; no auth bypass.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  const html = await (await fetch("https://hub.axisrobotics.ai/")).text();
  const scripts = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(
    (m) => m[1],
  );
  console.log(JSON.stringify({ scripts }, null, 2));

  let bundle = "";
  for (const s of scripts) {
    const url = `https://hub.axisrobotics.ai${s}`;
    const txt = await (await fetch(url)).text();
    if (txt.includes("trajectories") || txt.includes("leaderboard")) {
      bundle += `\n/* FILE ${s} */\n` + txt;
    }
  }
  const out = join(tmpdir(), "axis-hub-bundle-audit.js");
  writeFileSync(out, bundle, "utf8");
  console.log(JSON.stringify({ out, bytes: bundle.length }, null, 2));

  const patterns = [
    "trajectories",
    "Trajectories",
    "TRAJECTORIES",
    "search-attempts",
    "/me/profile",
    "leaderboard",
    "tasks_done",
    "txhash",
    "has_txhash",
  ];
  const counts: Record<string, number> = {};
  for (const p of patterns) counts[p] = bundle.split(p).length - 1;
  console.log(JSON.stringify({ counts }, null, 2));

  // Extract short contexts
  function contexts(needle: string, n = 8) {
    const out: string[] = [];
    let from = 0;
    while (out.length < n) {
      const i = bundle.indexOf(needle, from);
      if (i < 0) break;
      out.push(
        bundle
          .slice(Math.max(0, i - 90), Math.min(bundle.length, i + 140))
          .replace(/\s+/g, " "),
      );
      from = i + needle.length;
    }
    return out;
  }

  console.log(
    JSON.stringify(
      {
        trajectoriesCtx: contexts("trajectories", 12),
        TrajectoriesCtx: contexts("Trajectories", 8),
        leaderboardCtx: contexts("/stats/leaderboard", 8),
        meProfileCtx: contexts("/me/profile", 6),
        searchAttemptsCtx: contexts("search-attempts", 8),
        tasksDoneCtx: contexts("tasks_done", 8),
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
