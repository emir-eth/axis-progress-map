/**
 * Final E2E data validation — audit only, read-only against Hub + local SQLite.
 * Does not clear caches or change architecture.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, "data", "axis-index.db");
const HUB = "https://hub.axisrobotics.ai/api/stats/search-attempts";

const WALLETS = {
  A: "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD",
  B: "0x612cdfef8db47eea34b036b895fe5a6f477616d5",
  C: "0x0d1a77989c204468173ff4e37d1ce95f46e0d81e",
  EMPTY: "0x0000000000000000000000000000000000000001",
};

function norm(a: string) {
  return a.toLowerCase();
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function normalizeHubTxhash(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t || t === "0x" || t === "null" || t === "undefined") return null;
  const with0x = t.startsWith("0x") || t.startsWith("0X") ? t : `0x${t}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(with0x)) return null;
  return with0x.toLowerCase() as `0x${string}`;
}

async function hubSearch(q: string, extra: Record<string, string> = {}) {
  const u = new URL(HUB);
  u.searchParams.set("q", q);
  u.searchParams.set("page", "1");
  u.searchParams.set("per_page", "1");
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  const res = await fetch(u.toString(), {
    headers: { Accept: "application/json", "User-Agent": "AxisProgressMap-Audit/1.0" },
  });
  if (!res.ok) throw new Error(`Hub HTTP ${res.status} for ${u}`);
  return res.json() as Promise<{ total?: number; data?: unknown[] }>;
}

type HubRow = {
  attempt_id: number | null;
  task_id: string | null;
  score: number | null;
  txhash: string | null;
  theme: string | null;
  task_name: string | null;
  completed_at: string | null;
};

function titleCaseTheme(theme: string) {
  if (!theme) return theme;
  return theme.charAt(0).toUpperCase() + theme.slice(1).toLowerCase();
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error("DB missing:", DB_PATH);
    process.exit(1);
  }
  const db = new Database(DB_PATH, { readonly: true });

  console.log("=== SCHEMA ===");
  console.log(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),
  );
  console.log(
    "hub_wallet_cache cols",
    db.prepare("PRAGMA table_info(hub_wallet_cache)").all().map((c: { name: string }) => c.name),
  );
  console.log(
    "hub_attempts cols",
    db.prepare("PRAGMA table_info(hub_attempts)").all().map((c: { name: string }) => c.name),
  );

  const allCaches = db
    .prepare(
      `SELECT address, status, total_attempts, last_completed_page, total_pages, updated_at, last_error
       FROM hub_wallet_cache ORDER BY updated_at DESC`,
    )
    .all();
  console.log("\n=== ALL hub_wallet_cache ===");
  console.log(JSON.stringify(allCaches, null, 2));

  const incomplete = allCaches.filter((r: { status: string }) => r.status !== "complete");
  console.log("\n=== incomplete ===", incomplete.length);
  console.log(JSON.stringify(incomplete, null, 2));

  const report: Record<string, unknown> = {};

  for (const [label, address] of Object.entries(WALLETS)) {
    const addressLower = norm(address);
    console.log(`\n\n======== WALLET ${label} ${address} ========`);

    let hubTotal = -1;
    let hubSigned = -1;
    let hubUnsigned = -1;
    try {
      const [all, signed, unsigned] = await Promise.all([
        hubSearch(address),
        hubSearch(address, { has_txhash: "true" }),
        hubSearch(address, { has_txhash: "false" }),
      ]);
      hubTotal = Number(all.total ?? 0);
      hubSigned = Number(signed.total ?? 0);
      hubUnsigned = Number(unsigned.total ?? 0);
    } catch (e) {
      console.error("Hub fetch failed", e);
    }

    const cache = db
      .prepare(
        `SELECT address, status, total_attempts, last_completed_page, total_pages, updated_at, last_error
         FROM hub_wallet_cache WHERE address = ?`,
      )
      .get(addressLower) as
      | {
          address: string;
          status: string;
          total_attempts: number;
          last_completed_page: number;
          total_pages: number;
          updated_at: number;
          last_error: string | null;
        }
      | undefined;

    const rowCount = (
      db.prepare(`SELECT COUNT(*) as c FROM hub_attempts WHERE address = ?`).get(addressLower) as {
        c: number;
      }
    ).c;

    const uniqueAttemptIdCount = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT attempt_id) as c FROM hub_attempts WHERE address = ? AND attempt_id IS NOT NULL`,
        )
        .get(addressLower) as { c: number }
    ).c;

    const rows = db
      .prepare(
        `SELECT attempt_id, task_id, score, txhash, theme, task_name, completed_at
         FROM hub_attempts WHERE address = ?`,
      )
      .all(addressLower) as HubRow[];

    let signedRows = 0;
    let unsignedRows = 0;
    const taskIds = new Set<string>();
    const numericScores: number[] = [];
    let nullScores = 0;
    for (const r of rows) {
      if (normalizeHubTxhash(r.txhash)) signedRows += 1;
      else unsignedRows += 1;
      if (r.task_id != null && String(r.task_id).trim() !== "") {
        taskIds.add(String(r.task_id));
      }
      if (typeof r.score === "number" && Number.isFinite(r.score)) {
        numericScores.push(r.score);
      } else if (r.score == null) {
        nullScores += 1;
      } else {
        const n = Number(r.score);
        if (Number.isFinite(n)) numericScores.push(n);
        else nullScores += 1;
      }
    }

    const avg = numericScores.length
      ? round2(numericScores.reduce((a, b) => a + b, 0) / numericScores.length)
      : 0;
    const best = numericScores.length ? Math.max(...numericScores) : 0;

    const themeCounts = new Map<string, number>();
    for (const r of rows) {
      if (!r.theme) continue;
      const t = titleCaseTheme(String(r.theme));
      themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
    }

    let baseEvents = 0;
    let walletCache: unknown = null;
    try {
      baseEvents = (
        db
          .prepare(`SELECT COUNT(*) as c FROM wallet_events WHERE address = ?`)
          .get(addressLower) as { c: number }
      ).c;
      walletCache = db
        .prepare(`SELECT status, event_count, updated_at FROM wallet_cache WHERE address = ?`)
        .get(addressLower);
    } catch {
      /* table may differ */
    }

    const entry = {
      label,
      address,
      hub: {
        total: hubTotal,
        signed: hubSigned,
        unsigned: hubUnsigned,
        signedPlusUnsigned: hubSigned + hubUnsigned,
        signedPlusUnsignedMatchesTotal: hubSigned + hubUnsigned === hubTotal,
      },
      cache,
      db: {
        rowCount,
        uniqueAttemptIdCount,
        signedRows,
        unsignedRows,
        signedPlusUnsigned: signedRows + unsignedRows,
        uniqueTasks: taskIds.size,
        numericScoreCount: numericScores.length,
        nullScoreCount: nullScores,
        averageScore: avg,
        bestScore: best,
        themeCounts: Object.fromEntries(
          [...themeCounts.entries()].sort((a, b) => b[1] - a[1]),
        ),
      },
      reconciliations: {
        hubTotal_vs_dbRows: hubTotal === rowCount,
        hubTotal_vs_cacheTotalAttempts: cache
          ? hubTotal === cache.total_attempts
          : null,
        hubSigned_vs_dbSigned: hubSigned === signedRows,
        hubUnsigned_vs_dbUnsigned: hubUnsigned === unsignedRows,
        statusIsComplete: cache?.status === "complete",
        completeImpliesRowMatch:
          cache?.status === "complete" ? hubTotal === rowCount : null,
      },
      base: { wallet_events: baseEvents, wallet_cache: walletCache },
    };

    report[label] = entry;
    console.log(JSON.stringify(entry, null, 2));
  }

  const outPath = path.join(ROOT, "tmp", "final-audit-hub-db.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log("\nWrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
