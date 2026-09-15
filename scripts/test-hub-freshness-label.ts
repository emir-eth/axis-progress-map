/**
 * Hub freshness label tests — no live Hub / Turso required.
 * Usage: npx tsx scripts/test-hub-freshness-label.ts
 */
import assert from "node:assert/strict";
import { formatHubActivityFreshnessLabel } from "../src/lib/format";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const NOW = Date.parse("2026-09-15T15:00:00.000Z");

test("live Hub verification → FROM PUBLIC HUB ACTIVITY", () => {
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "fresh",
      lastVerifiedAt: new Date(NOW - 60_000).toISOString(),
      nowMs: NOW,
    }),
    "FROM PUBLIC HUB ACTIVITY",
  );
});

test("cached 2-minute-old data → UPDATED 2 MIN AGO", () => {
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 2 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    "UPDATED 2 MIN AGO",
  );
});

test("cached 18-minute-old data → UPDATED 18 MIN AGO", () => {
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 18 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    "UPDATED 18 MIN AGO",
  );
});

test("cached multi-hour data → UPDATED N HOURS AGO", () => {
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 3 * 60 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    "UPDATED 3 HOURS AGO",
  );
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 1 * 60 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    "UPDATED 1 HOUR AGO",
  );
});

test("old cached data → UPDATED DATE", () => {
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: "2026-09-10T12:00:00.000Z",
      nowMs: NOW,
    }),
    "UPDATED SEP 10, 2026",
  );
});

test("cached <1 minute → FROM PUBLIC HUB ACTIVITY (never JUST NOW)", () => {
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 15_000).toISOString(),
      nowMs: NOW,
    }),
    "FROM PUBLIC HUB ACTIVITY",
  );
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 1).toISOString(),
      nowMs: NOW,
    }),
    "FROM PUBLIC HUB ACTIVITY",
  );
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "stale",
      lastVerifiedAt: new Date(NOW - 30_000).toISOString(),
      nowMs: NOW,
    }),
    "FROM PUBLIC HUB ACTIVITY",
  );
});

test("no UPDATED JUST NOW output for any freshness branch", () => {
  const samples = [
    formatHubActivityFreshnessLabel({
      freshness: "fresh",
      lastVerifiedAt: new Date(NOW).toISOString(),
      nowMs: NOW,
    }),
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 5_000).toISOString(),
      nowMs: NOW,
    }),
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 2 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    formatHubActivityFreshnessLabel({
      freshness: "stale",
      lastVerifiedAt: new Date(NOW - 45 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: null,
      nowMs: NOW,
    }),
  ];
  for (const label of samples) {
    assert.equal(label.includes("JUST NOW"), false, label);
  }
});

test("browser refresh alone does not fake Hub verification (cached stays cached)", () => {
  // Page reload within the Hub cache max-age window serves Turso with
  // freshness:"cached" (fromCache:true) — Hub was not contacted.
  // The label may prefer FROM PUBLIC HUB ACTIVITY for <1min ages, but that
  // is display-only: callers still pass freshness:"cached", not "fresh".
  const cachedRecent = formatHubActivityFreshnessLabel({
    freshness: "cached",
    lastVerifiedAt: new Date(NOW - 20_000).toISOString(),
    nowMs: NOW,
  });
  const liveVerify = formatHubActivityFreshnessLabel({
    freshness: "fresh",
    lastVerifiedAt: new Date(NOW - 20_000).toISOString(),
    nowMs: NOW,
  });
  assert.equal(cachedRecent, "FROM PUBLIC HUB ACTIVITY");
  assert.equal(liveVerify, "FROM PUBLIC HUB ACTIVITY");
  // Classification remains the caller's responsibility — formatter never
  // upgrades cached→fresh; both inputs are honored as provided.
  assert.notEqual(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 5 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    formatHubActivityFreshnessLabel({
      freshness: "fresh",
      lastVerifiedAt: new Date(NOW - 5 * 60_000).toISOString(),
      nowMs: NOW,
    }),
  );
});

test("failed refresh (stale) retains previous freshness timestamp", () => {
  const previous = new Date(NOW - 45 * 60_000).toISOString();
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "stale",
      lastVerifiedAt: previous,
      nowMs: NOW,
    }),
    "UPDATED 45 MIN AGO",
  );
});

test("no fake/current timestamp substitution when lastVerifiedAt missing", () => {
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: null,
      nowMs: NOW,
    }),
    "FROM PUBLIC HUB ACTIVITY",
  );
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "stale",
      lastVerifiedAt: "not-a-date",
      nowMs: NOW,
    }),
    "FROM PUBLIC HUB ACTIVITY",
  );
});

test("wallet switching does not leak freshness state (pure per-call)", () => {
  const walletA = formatHubActivityFreshnessLabel({
    freshness: "cached",
    lastVerifiedAt: new Date(NOW - 5 * 60_000).toISOString(),
    nowMs: NOW,
  });
  const walletB = formatHubActivityFreshnessLabel({
    freshness: "fresh",
    lastVerifiedAt: new Date(NOW - 5 * 60_000).toISOString(),
    nowMs: NOW,
  });
  const walletAAgain = formatHubActivityFreshnessLabel({
    freshness: "cached",
    lastVerifiedAt: new Date(NOW - 5 * 60_000).toISOString(),
    nowMs: NOW,
  });
  assert.equal(walletA, "UPDATED 5 MIN AGO");
  assert.equal(walletB, "FROM PUBLIC HUB ACTIVITY");
  assert.equal(walletAAgain, "UPDATED 5 MIN AGO");
  assert.notEqual(walletA, walletB);
});

test("fresh ignores older clock — never invents 'now' as Hub time", () => {
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "fresh",
      lastVerifiedAt: new Date(NOW - 5 * 60 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    "FROM PUBLIC HUB ACTIVITY",
  );
});

console.log("\nhub-freshness-label tests done");
