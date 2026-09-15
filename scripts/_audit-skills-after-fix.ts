import Database from "better-sqlite3";
import { fetchAxisTaskFamilies } from "../src/lib/axis";
import { buildTaskIndex, matchHubAttempts } from "../src/lib/matcher";
import { buildAnalytics } from "../src/lib/analytics";
import { normalizeHubTxhash } from "../src/lib/hub-attempts";
import type { HubAttemptContribution } from "../src/types";

const PROFILE_BASE = "http://127.0.0.1:3010";
const db = new Database("data/axis-index.db", { readonly: true });
const focus = ["Pick", "Place", "Transfer", "Stack", "Open", "Arrange", "Rotate"];
const wallets = {
  A: "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD",
  B: "0x612cdfef8db47eea34b036b895fe5a6f477616d5",
  C: "0x0d1a77989c204468173ff4e37d1ce95f46e0d81e",
};

function toContribs(address: string, rows: Array<Record<string, unknown>>): HubAttemptContribution[] {
  return rows.map((r) => {
    let score: number | null = null;
    if (typeof r.score === "number" && Number.isFinite(r.score)) score = r.score;
    else if (r.score != null && r.score !== "") {
      const n = Number(r.score);
      if (Number.isFinite(n)) score = n;
    }
    let timestamp: number | null = null;
    if (r.completed_at) {
      const ms = Date.parse(String(r.completed_at));
      if (Number.isFinite(ms)) timestamp = Math.floor(ms / 1000);
    }
    return {
      dataId: String(r.data_id ?? r.attempt_id ?? ""),
      taskId: String(r.task_id ?? ""),
      user: address as `0x${string}`,
      score,
      simulationTime: Number(r.simulation_time_seconds ?? 0) || 0,
      blockNumber: null,
      transactionHash: normalizeHubTxhash(r.txhash as string) as `0x${string}` | null,
      logIndex: 0,
      timestamp,
      attemptId: r.attempt_id == null ? null : Number(r.attempt_id),
      source: "hub" as const,
      taskNameHint: r.task_name == null ? null : String(r.task_name),
      themeHint: r.theme == null ? null : String(r.theme),
    };
  });
}

async function main() {
  const families = await fetchAxisTaskFamilies({ forceRefresh: true });
  const index = buildTaskIndex(families);
  console.log({ families: families.length, index: index.byTaskId.size });

  for (const [label, address] of Object.entries(wallets)) {
    const res = await fetch(`${PROFILE_BASE}/api/profile/${address}`);
    const api = await res.json();
    const rows = db
      .prepare("SELECT * FROM hub_attempts WHERE address = ?")
      .all(address.toLowerCase()) as Array<Record<string, unknown>>;
    const mapped = matchHubAttempts(toContribs(address.toLowerCase(), rows), index);
    const analytics = buildAnalytics(mapped, true);

    const skillMismatches = focus.filter((s) => {
      const a =
        analytics.skills.find((n) => n.skill.toLowerCase() === s.toLowerCase())
          ?.contributionCount ?? 0;
      const b =
        api.analytics.skills.find(
          (n: { skill: string }) => n.skill.toLowerCase() === s.toLowerCase(),
        )?.contributionCount ?? 0;
      return a !== b;
    });

    const unmapped = (api.contributions as Array<{ metadataStatus: string; taskId: string }>).filter(
      (c) => c.metadataStatus === "unmapped",
    );
    let unmappedButFresh = 0;
    for (const c of unmapped) {
      if (index.byTaskId.has(String(c.taskId))) unmappedButFresh += 1;
    }

    // explorer sample date check
    const samples = [];
    for (const idx of [0, 1, 50, 100, rows.length - 1]) {
      if (idx < 0 || idx >= (api.contributions?.length ?? 0)) continue;
      const c = api.contributions[idx];
      const dbRow = rows.find((r) => Number(r.attempt_id) === Number(c.attemptId));
      const raw = dbRow?.completed_at ? String(dbRow.completed_at) : null;
      const expectedTs = raw && Number.isFinite(Date.parse(raw)) ? Math.floor(Date.parse(raw) / 1000) : null;
      samples.push({
        idx,
        attemptId: c.attemptId,
        dbCompletedAt: raw,
        apiTimestamp: c.timestamp,
        match: expectedTs === c.timestamp,
        scoreMatch: dbRow ? (dbRow.score == null && c.score == null) || Number(dbRow.score) === Number(c.score) : false,
        txMatch:
          dbRow != null &&
          normalizeHubTxhash(dbRow.txhash as string) ===
            normalizeHubTxhash(c.transactionHash as string),
      });
    }

    console.log(
      JSON.stringify(
        {
          label,
          traj: api.analytics.summary.onChainContributions,
          hubTxhash: api.hubTxhash,
          coverageApi: api.analytics.coverage,
          coverageIndep: analytics.coverage,
          coverageMatch:
            api.analytics.coverage.coveragePercent === analytics.coverage.coveragePercent &&
            api.analytics.coverage.mappedUniqueTasks === analytics.coverage.mappedUniqueTasks,
          skillMismatches,
          skillFocusApi: Object.fromEntries(
            focus.map((s) => [
              s,
              api.analytics.skills.find(
                (n: { skill: string }) => n.skill.toLowerCase() === s.toLowerCase(),
              )?.contributionCount ?? 0,
            ]),
          ),
          skillFocusIndep: Object.fromEntries(
            focus.map((s) => [
              s,
              analytics.skills.find((n) => n.skill.toLowerCase() === s.toLowerCase())
                ?.contributionCount ?? 0,
            ]),
          ),
          themesMatch:
            JSON.stringify(api.analytics.themes.map((t: { theme: string; count: number }) => [t.theme, t.count])) ===
            JSON.stringify(analytics.themes.map((t) => [t.theme, t.count])),
          unmappedButFresh,
          base: api.baseVerification,
          explorerSamples: samples,
          noFixture: !String(api.indexStatus.dataSource).includes("fixture"),
        },
        null,
        2,
      ),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
