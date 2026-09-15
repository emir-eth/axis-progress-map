/**
 * Unit tests for Hub preparation progress helpers.
 * Usage: npx tsx scripts/test-hub-preparation.ts
 */
import assert from "node:assert/strict";

/** Mirrors HubPreparationView.hubHistoryProgressPercent (kept local to avoid CSS imports). */
function hubHistoryProgressPercent(
  fetched: number,
  total: number,
): number | null {
  if (total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((fetched / total) * 100)));
}

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

test("A) 100 / 864", () => {
  assert.equal(hubHistoryProgressPercent(100, 864), 12);
});

test("B) 400 / 864", () => {
  assert.equal(hubHistoryProgressPercent(400, 864), 46);
});

test("C) 800 / 864", () => {
  assert.equal(hubHistoryProgressPercent(800, 864), 93);
});

test("G) return visit non-zero progress", () => {
  assert.equal(hubHistoryProgressPercent(700, 864), 81);
  assert.ok(hubHistoryProgressPercent(700, 864)! > 0);
});

test("complete → 100%", () => {
  assert.equal(hubHistoryProgressPercent(864, 864), 100);
});

test("unknown total → null", () => {
  assert.equal(hubHistoryProgressPercent(0, 0), null);
});

console.log("\nhub-preparation tests done");
