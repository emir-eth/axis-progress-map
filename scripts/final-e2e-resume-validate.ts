/**
 * Resume profile until complete (or max rounds), then compare Hub + independent metrics.
 */
import Database from "better-sqlite3";
import { buildTaskIndex, matchHubAttempts } from "../src/lib/matcher";
import { buildAnalytics } from "../src/lib/analytics";
import { normalizeHubTxhash } from "../src/lib/hub-attempts";
import { fetchAxisTaskFamilies } from "../src/lib/axis";
import type { HubAttemptContribution } from "../src/types";

const PROFILE_BASE = process.env.PROFILE_BASE ?? "http://127.0.0.1:3010";
const HUB = "https://hub.axisrobotics.ai/api/stats/search-attempts";
const db = new Database("data/axis-index.db", { readonly: true });

const WALLETS = {
  A: "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD",
  B: "0x612cdfef8db47eea34b036b895fe5a6f477616d5",
  C: "0x0d1a77989c204468173ff4e37d1ce95f46e0d81e",
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function hubTotals(address: string) {
  async function one(extra: Record<string, string> = {}) {
    const u = new URL(HUB);
    u.searchParams.set("q", address);
    u.searchParams.set("page", "1");
    u.searchParams.set("per_page", "1");
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    const r = await fetch(u.toString(), {
      headers: { Accept: "application/json", "User-Agent": "AxisProgressMap-Audit/1.0" },
    });
    const j = (await r.json()) as { total?: number };
    return Number(j.total ?? 0);
  }
  return {
    total: await one(),
    signed: await one({ has_txhash: "true" }),
    unsigned: await one({ has_txhash: "false" }),
  };
}

async function profile(address: string) {
  const t0 = Date.now();
  const res = await fetch(`${PROFILE_BASE}/api/profile/${address}`);
  const json = await res.json();
  return {
    status: res.status,
    ms: Date.now() - t0,
    source: res.headers.get("x-axis-data-source"),
    freshness: res.headers.get("x-axis-freshness"),
    eth: res.headers.get("x-axis-eth-getlogs"),
    json,
  };
}

function toContribs(address: string, rows: Array<Record<string, unknown>>): HubAttemptContribution[] {
  return rows.map((r) => {
    const completedAt = r.completed_at == null ? null : String(r.completed_at);
    let timestamp: number | null = null;
    if (completedAt) {
      const ms = Date.parse(completedAt);
      if (Number.isFinite(ms)) timestamp = Math.floor(ms / 1000);
    }
    let score: number | null = null;
    if (typeof r.score === "number" && Number.isFinite(r.score)) score = r.score;
    else if (r.score != null && r.score !== "") {
      const n = Number(r.score);
      if (Number.isFinite(n)) score = n;
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

async function resumeUntilComplete(label: string, address: string, maxRounds = 12) {
  const rounds = [];
  for (let i = 1; i <= maxRounds; i++) {
    const p = await profile(address);
    const hub = p.json.hubStatus;
    const scan = p.json.indexStatus?.scanStatus;
    const row = {
      round: i,
      ms: p.ms,
      source: p.source,
      freshness: p.freshness,
      eth: p.eth,
      scan,
      hubStatus: hub,
      traj: p.json.analytics?.summary?.onChainContributions,
      hubTrajectories: p.json.hubTrajectories,
      contribs: p.json.contributions?.length,
      warnings: p.json.warnings,
    };
    rounds.push(row);
    console.log(label, JSON.stringify(row));
    if (scan === "complete" && (p.json.contributions?.length ?? 0) > 0) {
      return { complete: true, rounds, profile: p };
    }
    if (scan === "complete" && p.json.empty && (hub?.totalAttempts ?? 0) === 0) {
      return { complete: true, rounds, profile: p };
    }
    // incomplete — continue
  }
  return { complete: false, rounds, profile: null as null | Awaited<ReturnType<typeof profile>> };
}

async function main() {
  console.log("Loading metadata…");
  const families = await fetchAxisTaskFamilies({ forceRefresh: true });
  const index = buildTaskIndex(families);
  const focus = ["Pick", "Place", "Transfer", "Stack", "Open", "Arrange", "Rotate"];

  for (const [label, address] of Object.entries(WALLETS)) {
    console.log(`\n======== ${label} ========`);
    const hub = await hubTotals(address);
    console.log("Hub live", hub);

    const resumed = await resumeUntilComplete(label, address);
    const addressLower = address.toLowerCase();
    const cache = db
      .prepare("SELECT * FROM hub_wallet_cache WHERE address = ?")
      .get(addressLower);
    const rows = db
      .prepare("SELECT * FROM hub_attempts WHERE address = ?")
      .all(addressLower) as Array<Record<string, unknown>>;

    const mapped = matchHubAttempts(toContribs(addressLower, rows), index);
    const analytics = buildAnalytics(mapped, true);
    let signed = 0;
    let unsigned = 0;
    let nullScores = 0;
    const numeric: number[] = [];
    for (const r of rows) {
      if (normalizeHubTxhash(r.txhash as string)) signed += 1;
      else unsigned += 1;
      if (typeof r.score === "number" && Number.isFinite(r.score)) numeric.push(r.score);
      else if (r.score == null || r.score === "") nullScores += 1;
      else {
        const n = Number(r.score);
        if (Number.isFinite(n)) numeric.push(n);
        else nullScores += 1;
      }
    }

    const api = resumed.profile?.json;
    const skillFocusIndep: Record<string, number> = {};
    const skillFocusApi: Record<string, number | null> = {};
    for (const s of focus) {
      skillFocusIndep[s] =
        analytics.skills.find((n) => n.skill.toLowerCase() === s.toLowerCase())
          ?.contributionCount ?? 0;
      skillFocusApi[s] =
        api?.analytics?.skills?.find(
          (n: { skill: string }) => n.skill.toLowerCase() === s.toLowerCase(),
        )?.contributionCount ?? null;
    }

    const report = {
      label,
      hub,
      cache,
      dbRows: rows.length,
      complete: resumed.complete,
      rounds: resumed.rounds.length,
      compare: {
        hubTotal_vs_dbRows: hub.total === rows.length,
        hubTotal_vs_traj:
          hub.total === api?.analytics?.summary?.onChainContributions,
        hubSigned_vs_db: hub.signed === signed,
        hubUnsigned_vs_db: hub.unsigned === unsigned,
        signedPlusUnsigned: signed + unsigned === rows.length,
        uniqueTasks:
          api?.analytics?.summary?.uniqueTasks === analytics.summary.uniqueTasks,
        avg: api?.analytics?.summary?.averageScore === analytics.summary.averageScore,
        best: api?.analytics?.summary?.bestScore === analytics.summary.bestScore,
        coverage:
          api?.analytics?.coverage?.coveragePercent ===
          analytics.coverage.coveragePercent,
        skillsMatch: focus.every((s) => skillFocusApi[s] === skillFocusIndep[s]),
        explorerCount: api?.contributions?.length === rows.length,
        noFixture: !String(api?.indexStatus?.dataSource ?? "").includes("fixture"),
        ethGetLogsZero: resumed.profile?.eth === "0" || resumed.profile?.eth == null,
      },
      independent: {
        signed,
        unsigned,
        nullScores,
        numericCount: numeric.length,
        avg: numeric.length ? round2(numeric.reduce((a, b) => a + b, 0) / numeric.length) : 0,
        best: numeric.length ? Math.max(...numeric) : 0,
        uniqueTasks: analytics.summary.uniqueTasks,
        coverage: analytics.coverage,
        skillFocusIndep,
        topThemes: analytics.themes.slice(0, 8),
      },
      api: api
        ? {
            source: api.indexStatus?.dataSource,
            scan: api.indexStatus?.scanStatus,
            traj: api.analytics?.summary?.onChainContributions,
            uniqueTasks: api.analytics?.summary?.uniqueTasks,
            avg: api.analytics?.summary?.averageScore,
            best: api.analytics?.summary?.bestScore,
            hubTxhash: api.hubTxhash,
            coverage: api.analytics?.coverage,
            skillFocusApi,
            themes: api.analytics?.themes?.slice(0, 8),
            contribs: api.contributions?.length,
            base: api.baseVerification,
            warnings: api.warnings,
          }
        : null,
    };
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
