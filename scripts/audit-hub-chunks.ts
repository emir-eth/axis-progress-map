/**
 * Follow Hub SPA chunk graph and extract trajectory/leaderboard strings.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  const html = await (await fetch("https://hub.axisrobotics.ai/")).text();
  const assets = new Set<string>();
  for (const m of html.matchAll(/\/assets\/[A-Za-z0-9._-]+\.js/g)) {
    assets.add(m[0]);
  }
  console.log("html assets", [...assets]);

  const queue = [...assets];
  const seen = new Set<string>();
  const interesting: Array<{ path: string; size: number; hits: Record<string, number> }> = [];
  const needles = [
    "trajectories",
    "Trajectories",
    "search-attempts",
    "/me/profile",
    "leaderboard",
    "tasks_done",
    "txhash",
  ];

  let combined = "";
  while (queue.length && seen.size < 40) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const url = `https://hub.axisrobotics.ai${path}`;
    let txt = "";
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      txt = await res.text();
    } catch {
      continue;
    }
    // discover more chunks
    for (const m of txt.matchAll(/\/assets\/[A-Za-z0-9._-]+\.js/g)) {
      if (!seen.has(m[0])) queue.push(m[0]);
    }
    for (const m of txt.matchAll(/assets\/([A-Za-z0-9._-]+\.js)/g)) {
      const p = `/assets/${m[1]}`;
      if (!seen.has(p)) queue.push(p);
    }
    const hits: Record<string, number> = {};
    let any = false;
    for (const n of needles) {
      const c = txt.split(n).length - 1;
      hits[n] = c;
      if (c > 0) any = true;
    }
    if (any) {
      interesting.push({ path, size: txt.length, hits });
      combined += `\n/* ${path} */\n` + txt;
    }
  }

  console.log(JSON.stringify({ seen: seen.size, interesting }, null, 2));

  function contexts(needle: string, n = 10) {
    const out: string[] = [];
    let from = 0;
    while (out.length < n) {
      const i = combined.indexOf(needle, from);
      if (i < 0) break;
      out.push(
        combined
          .slice(Math.max(0, i - 100), Math.min(combined.length, i + 160))
          .replace(/\s+/g, " "),
      );
      from = i + needle.length;
    }
    return out;
  }

  const report = {
    trajectories: contexts("trajectories", 15),
    Trajectories: contexts("Trajectories", 10),
    meProfile: contexts("/me/profile", 8),
    searchAttempts: contexts("search-attempts", 8),
    leaderboardApi: contexts("/stats/leaderboard", 8),
    tasksDone: contexts("tasks_done", 8),
  };
  const outPath = join(tmpdir(), "axis-hub-semantics-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log("wrote", outPath);
  // print compact
  for (const [k, v] of Object.entries(report)) {
    console.log(`\n===== ${k} (${v.length}) =====`);
    for (const s of v.slice(0, 6)) console.log(s.slice(0, 240), "\n---");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
