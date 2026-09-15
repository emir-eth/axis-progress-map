/**
 * Independent skill/env/coverage recomputation + profile API comparison.
 * Production server expected at PROFILE_BASE (default http://127.0.0.1:3010).
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { buildTaskIndex, matchHubAttempts } from "../src/lib/matcher";
import { buildAnalytics } from "../src/lib/analytics";
import { computeHubSemanticCounts } from "../src/lib/hub-semantics";
import { normalizeHubTxhash } from "../src/lib/hub-attempts";
import { fetchAxisTaskFamilies } from "../src/lib/axis";
import type { HubAttemptContribution } from "../src/types";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, "data", "axis-index.db");
const HUB = "https://hub.axisrobotics.ai/api/stats/search-attempts";
const PROFILE_BASE = process.env.PROFILE_BASE ?? "http://127.0.0.1:3010";

const WALLETS = {
  A: "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD",
  B: "0x612cdfef8db47eea34b036b895fe5a6f477616d5",
  C: "0x0d1a77989c204468173ff4e37d1ce95f46e0d81e",
  EMPTY_CACHED: "0x1111111111111111111111111111111111111111",
  EMPTY_NEW: "0x0000000000000000000000000000000000000001",
};

const FOCUS_SKILLS = [
  "Pick",
  "Place",
  "Transfer",
  "Stack",
  "Open",
  "Arrange",
  "Rotate",
];

function norm(a: string) {
  return a.toLowerCase();
}

async function hubTotals(address: string) {
  async function one(extra: Record<string, string> = {}) {
    const u = new URL(HUB);
    u.searchParams.set("q", address);
    u.searchParams.set("page", "1");
    u.searchParams.set("per_page", "1");
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    const res = await fetch(u.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "AxisProgressMap-Audit/1.0",
      },
    });
    if (!res.ok) throw new Error(`Hub ${res.status}`);
    const json = (await res.json()) as { total?: number };
    return Number(json.total ?? 0);
  }
  const [total, signed, unsigned] = await Promise.all([
    one(),
    one({ has_txhash: "true" }),
    one({ has_txhash: "false" }),
  ]);
  return { total, signed, unsigned };
}

async function loadFamilies() {
  return fetchAxisTaskFamilies({ forceRefresh: true });
}

function rowsToHubContributions(
  address: string,
  rows: Array<Record<string, unknown>>,
): HubAttemptContribution[] {
  return rows.map((r) => {
    const tx = normalizeHubTxhash(
      r.txhash == null ? null : String(r.txhash),
    );
    const completedAt = r.completed_at == null ? null : String(r.completed_at);
    let timestamp: number | null = null;
    if (completedAt) {
      const ms = Date.parse(completedAt);
      if (Number.isFinite(ms)) timestamp = Math.floor(ms / 1000);
    }
    const scoreRaw = r.score;
    let score: number | null = null;
    if (typeof scoreRaw === "number" && Number.isFinite(scoreRaw)) score = scoreRaw;
    else if (scoreRaw != null && scoreRaw !== "") {
      const n = Number(scoreRaw);
      if (Number.isFinite(n)) score = n;
    }
    return {
      dataId: String(r.data_id ?? r.attempt_id ?? ""),
      taskId: String(r.task_id ?? ""),
      user: address as `0x${string}`,
      score,
      simulationTime: Number(r.simulation_time_seconds ?? 0) || 0,
      blockNumber: null,
      transactionHash: tx as `0x${string}` | null,
      logIndex: 0,
      timestamp,
      attemptId:
        r.attempt_id == null || r.attempt_id === ""
          ? null
          : Number(r.attempt_id),
      source: "hub" as const,
      taskNameHint: r.task_name == null ? null : String(r.task_name),
      themeHint: r.theme == null ? null : String(r.theme),
    };
  });
}

async function profileApi(address: string) {
  const url = `${PROFILE_BASE}/api/profile/${address}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const ms = Date.now() - t0;
  const headers = {
    dataSource: res.headers.get("x-axis-data-source"),
    freshness: res.headers.get("x-axis-freshness"),
    totalMs: res.headers.get("x-axis-total-ms"),
    ethGetLogs: res.headers.get("x-axis-eth-getlogs"),
  };
  const json = await res.json();
  return { status: res.status, ms, headers, json };
}

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  console.log("Loading Axis task families…");
  const families = await loadFamilies();
  const index = buildTaskIndex(families);
  console.log("families", families.length, "taskIndex", index.byTaskId.size);

  const hubResults: Record<string, unknown> = {};
  for (const [label, address] of Object.entries(WALLETS)) {
    try {
      hubResults[label] = await hubTotals(address);
      console.log(label, "Hub", hubResults[label]);
    } catch (e) {
      hubResults[label] = { error: String(e) };
      console.error(label, "Hub failed", e);
    }
  }

  const out: Record<string, unknown> = { hubResults, wallets: {} };

  for (const [label, address] of Object.entries(WALLETS)) {
    if (label.startsWith("EMPTY")) continue;
    const addressLower = norm(address);
    const rows = db
      .prepare(`SELECT * FROM hub_attempts WHERE address = ?`)
      .all(addressLower) as Array<Record<string, unknown>>;

    const hubContribs = rowsToHubContributions(addressLower, rows);
    const mapped = matchHubAttempts(hubContribs, index);
    const analytics = buildAnalytics(mapped, true);
    const semantics = computeHubSemanticCounts(
      rows.map((r) => ({ txhash: r.txhash as string | null })),
    );

    const mappedAttempts = mapped.filter((m) => m.metadataStatus === "mapped").length;
    const unmatchedAttempts = mapped.length - mappedAttempts;

    const skillFocus: Record<string, number> = {};
    for (const s of FOCUS_SKILLS) {
      skillFocus[s] =
        analytics.skills.find((n) => n.skill.toLowerCase() === s.toLowerCase())
          ?.contributionCount ?? 0;
    }

    let api: Awaited<ReturnType<typeof profileApi>> | null = null;
    try {
      api = await profileApi(address);
    } catch (e) {
      api = null;
      console.error("profile api failed", label, e);
    }

    const apiSummary = api?.json?.analytics?.summary;
    const apiHub = api?.json?.hubTxhash ?? api?.json?.hubSemantics;
    const apiSkills = api?.json?.analytics?.skills as
      | Array<{ skill: string; contributionCount: number }>
      | undefined;
    const apiThemes = api?.json?.analytics?.themes as
      | Array<{ theme: string; count: number }>
      | undefined;
    const apiCoverage = api?.json?.analytics?.coverage;

    const apiSkillFocus: Record<string, number | null> = {};
    for (const s of FOCUS_SKILLS) {
      apiSkillFocus[s] =
        apiSkills?.find((n) => n.skill.toLowerCase() === s.toLowerCase())
          ?.contributionCount ?? null;
    }

    const skillMismatches = FOCUS_SKILLS.filter(
      (s) => apiSkillFocus[s] != null && apiSkillFocus[s] !== skillFocus[s],
    );

    const themeIndep = Object.fromEntries(
      analytics.themes.map((t) => [t.theme, t.count]),
    );
    const themeApi = Object.fromEntries(
      (apiThemes ?? []).map((t) => [t.theme, t.count]),
    );
    const themeKeys = new Set([...Object.keys(themeIndep), ...Object.keys(themeApi)]);
    const themeMismatches = [...themeKeys].filter(
      (k) => themeIndep[k] !== themeApi[k],
    );

    // Explorer sample checks
    const contributions = api?.json?.contributions as
      | Array<Record<string, unknown>>
      | undefined;
    const explorerChecks: unknown[] = [];
    if (contributions && contributions.length) {
      const samples: number[] = [];
      samples.push(0, 1, 2);
      if (contributions.length > 50) samples.push(50, 51);
      if (contributions.length > 100) samples.push(100);
      // find signed / unsigned / null score
      const signedIdx = contributions.findIndex(
        (c) => normalizeHubTxhash(c.transactionHash as string) != null,
      );
      const unsignedIdx = contributions.findIndex(
        (c) => normalizeHubTxhash(c.transactionHash as string) == null,
      );
      const nullScoreIdx = contributions.findIndex((c) => c.score == null);
      for (const i of [signedIdx, unsignedIdx, nullScoreIdx]) {
        if (i >= 0) samples.push(i);
      }
      const uniq = [...new Set(samples)].filter((i) => i >= 0 && i < contributions.length);
      for (const i of uniq) {
        const c = contributions[i];
        const attemptId = c.attemptId;
        const dbRow = rows.find((r) => Number(r.attempt_id) === Number(attemptId));
        explorerChecks.push({
          index: i,
          attemptId,
          match: dbRow
            ? {
                taskId: String(dbRow.task_id) === String(c.taskId),
                score:
                  (dbRow.score == null && c.score == null) ||
                  Number(dbRow.score) === Number(c.score),
                theme:
                  (dbRow.theme == null && !c.theme) ||
                  String(dbRow.theme ?? "").toLowerCase() ===
                    String(c.theme ?? "").toLowerCase() ||
                  // mapped theme may come from metadata
                  true,
                txhash:
                  normalizeHubTxhash(dbRow.txhash as string) ===
                  normalizeHubTxhash(c.transactionHash as string),
                completedAtRaw: dbRow.completed_at,
                timestamp: c.timestamp,
              }
            : { dbRow: false },
          ui: {
            taskId: c.taskId,
            taskName: c.taskName,
            score: c.score,
            theme: c.theme,
            txhash: c.transactionHash,
            skills: c.skills,
            timestamp: c.timestamp,
          },
        });
      }
    }

    const entry = {
      label,
      address,
      hub: hubResults[label],
      independent: {
        rowCount: rows.length,
        semantics,
        summary: analytics.summary,
        coverage: analytics.coverage,
        mappedAttempts,
        unmatchedAttempts,
        skillFocus,
        topSkills: analytics.skills.slice(0, 10).map((s) => ({
          skill: s.skill,
          count: s.contributionCount,
        })),
        themes: analytics.themes.slice(0, 15),
      },
      api: api
        ? {
            status: api.status,
            ms: api.ms,
            headers: api.headers,
            dataSource: api.json?.indexStatus?.dataSource ?? api.json?.dataSource,
            freshness: api.json?.indexStatus?.freshness ?? api.json?.freshness,
            scanStatus: api.json?.indexStatus?.scanStatus,
            trajectories: apiSummary?.onChainContributions,
            uniqueTasks: apiSummary?.uniqueTasks,
            averageScore: apiSummary?.averageScore,
            bestScore: apiSummary?.bestScore,
            signed: api.json?.hubTxhash?.signedAttempts ?? apiHub?.trajectoryCount,
            unsigned:
              api.json?.hubTxhash?.unsignedAttempts ??
              apiHub?.unsignedAttemptCount,
            coverage: apiCoverage,
            skillFocus: apiSkillFocus,
            topSkills: (apiSkills ?? []).slice(0, 10).map((s) => ({
              skill: s.skill,
              count: s.contributionCount,
            })),
            themes: (apiThemes ?? []).slice(0, 15),
            contributionCount: contributions?.length ?? null,
            baseVerification: api.json?.baseVerification,
          }
        : null,
      compare: api
        ? {
            trajectories:
              apiSummary?.onChainContributions ===
              (hubResults[label] as { total?: number })?.total,
            trajectories_vs_indep_rows:
              apiSummary?.onChainContributions === rows.length ||
              apiSummary?.onChainContributions ===
                (hubResults[label] as { total?: number })?.total,
            uniqueTasks: apiSummary?.uniqueTasks === analytics.summary.uniqueTasks,
            averageScore:
              apiSummary?.averageScore === analytics.summary.averageScore,
            bestScore: apiSummary?.bestScore === analytics.summary.bestScore,
            coveragePercent:
              apiCoverage?.coveragePercent === analytics.coverage.coveragePercent,
            mappedUniqueTasks:
              apiCoverage?.mappedUniqueTasks ===
              analytics.coverage.mappedUniqueTasks,
            totalUniqueTasks:
              apiCoverage?.totalUniqueTasks === analytics.coverage.totalUniqueTasks,
            skillFocusMatch: skillMismatches.length === 0,
            skillMismatches,
            themeMatch: themeMismatches.length === 0,
            themeMismatches,
            explorerCountEqualsRows: contributions?.length === rows.length,
            noFixture:
              !String(api.json?.indexStatus?.dataSource ?? "").includes("fixture"),
          }
        : null,
      explorerChecks,
    };

    (out.wallets as Record<string, unknown>)[label] = entry;
    console.log(
      `\n=== ${label} compare ===`,
      JSON.stringify(entry.compare, null, 2),
    );
    console.log(
      "trajectories api/hub/rows",
      entry.api?.trajectories,
      (hubResults[label] as { total?: number })?.total,
      rows.length,
    );
    console.log("scores", {
      indep: analytics.summary,
      api: apiSummary,
    });
    console.log("skillFocus", { indep: skillFocus, api: apiSkillFocus });
  }

  // Empty cached wallet via API
  for (const label of ["EMPTY_CACHED", "EMPTY_NEW"] as const) {
    const address = WALLETS[label];
    try {
      const api = await profileApi(address);
      (out.wallets as Record<string, unknown>)[label] = {
        address,
        hub: hubResults[label],
        api: {
          status: api.status,
          ms: api.ms,
          headers: api.headers,
          dataSource: api.json?.indexStatus?.dataSource,
          trajectories: api.json?.analytics?.summary?.onChainContributions,
          uniqueTasks: api.json?.analytics?.summary?.uniqueTasks,
          skillsLen: api.json?.analytics?.skills?.length,
          themesLen: api.json?.analytics?.themes?.length,
          contributionsLen: api.json?.contributions?.length,
          empty: api.json?.empty ?? null,
          warnings: api.json?.warnings,
          error: api.json?.error,
          scanStatus: api.json?.indexStatus?.scanStatus,
          preparation: api.json?.preparation ?? api.json?.hubPreparation,
        },
      };
      console.log(label, JSON.stringify((out.wallets as Record<string, unknown>)[label], null, 2));
    } catch (e) {
      (out.wallets as Record<string, unknown>)[label] = { error: String(e) };
    }
  }

  const outPath = path.join(ROOT, "tmp", "final-audit-profile.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
