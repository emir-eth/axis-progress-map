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

test("fresh successful Hub verification → FROM PUBLIC HUB ACTIVITY", () => {
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "fresh",
      lastVerifiedAt: new Date(NOW - 60_000).toISOString(),
      nowMs: NOW,
    }),
    "FROM PUBLIC HUB ACTIVITY",
  );
});

test("persisted cached response → UPDATED relative time", () => {
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 2 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    "UPDATED 2 MIN AGO",
  );
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 18 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    "UPDATED 18 MIN AGO",
  );
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 3 * 60 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    "UPDATED 3 HOURS AGO",
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

test("sufficiently old data uses compact date", () => {
  assert.equal(
    formatHubActivityFreshnessLabel({
      freshness: "cached",
      lastVerifiedAt: "2026-09-10T12:00:00.000Z",
      nowMs: NOW,
    }),
    "UPDATED SEP 10, 2026",
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

test("fresh ignores a newer clock — never invents 'now' as Hub time", () => {
  // Even if lastVerifiedAt is hours old, a successful verify this request says public Hub.
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
