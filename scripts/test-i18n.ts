/**
 * EN/TR localization helpers — no React, no network.
 * Usage: npx tsx scripts/test-i18n.ts
 */
import assert from "node:assert/strict";
import {
  formatHubActivityFreshnessLabelLocalized,
  getMessages,
  isLocale,
  LOCALE_STORAGE_KEY,
} from "../src/lib/i18n";
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

test("default dictionaries expose matching key shapes", () => {
  const en = getMessages("en");
  const tr = getMessages("tr");
  assert.equal(en.profile.trajectories, "Trajectories");
  assert.equal(tr.profile.trajectories, "Trajectories");
  assert.equal(en.nav.how, "HOW");
  assert.equal(tr.nav.how, "NASIL ÇALIŞIR");
  assert.ok(tr.landing.headline1.includes("Axis"));
  assert.ok(/[çğıöşüİ]/i.test(tr.freshness.fromPublicHub));
});

test("isLocale + storage key", () => {
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("tr"), true);
  assert.equal(isLocale("de"), false);
  assert.equal(LOCALE_STORAGE_KEY, "axis-locale");
});

test("freshness EN matches legacy formatter", () => {
  const opts = {
    freshness: "cached" as const,
    lastVerifiedAt: new Date(NOW - 2 * 60_000).toISOString(),
    nowMs: NOW,
  };
  assert.equal(
    formatHubActivityFreshnessLabel(opts),
    formatHubActivityFreshnessLabelLocalized({ locale: "en", ...opts }),
  );
  assert.equal(
    formatHubActivityFreshnessLabelLocalized({ locale: "en", ...opts }),
    "UPDATED 2 MIN AGO",
  );
});

test("freshness TR relative + date", () => {
  assert.equal(
    formatHubActivityFreshnessLabelLocalized({
      locale: "tr",
      freshness: "fresh",
      lastVerifiedAt: new Date(NOW - 60_000).toISOString(),
      nowMs: NOW,
    }),
    "HERKESE AÇIK HUB VERİLERİNDEN",
  );
  assert.equal(
    formatHubActivityFreshnessLabelLocalized({
      locale: "tr",
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 2 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    "2 DK ÖNCE GÜNCELLENDİ",
  );
  assert.equal(
    formatHubActivityFreshnessLabelLocalized({
      locale: "tr",
      freshness: "cached",
      lastVerifiedAt: new Date(NOW - 3 * 60 * 60_000).toISOString(),
      nowMs: NOW,
    }),
    "3 SAAT ÖNCE GÜNCELLENDİ",
  );
  assert.equal(
    formatHubActivityFreshnessLabelLocalized({
      locale: "tr",
      freshness: "cached",
      lastVerifiedAt: "2026-09-10T12:00:00.000Z",
      nowMs: NOW,
    }),
    "10 EYL 2026'DA GÜNCELLENDİ",
  );
});

test("Turkish plurals avoid görevler", () => {
  const tr = getMessages("tr");
  assert.equal(tr.coverage.unmatched(1).startsWith("1 görev"), true);
  assert.equal(tr.coverage.unmatched(12).includes("görevler"), false);
  assert.ok(tr.coverage.unmatched(12).includes("12 görev"));
});

test("share card labels include Turkish glyphs", () => {
  const tr = getMessages("tr");
  assert.ok(tr.card.uniqueTasks.includes("Benzersiz"));
  assert.ok(/[şŞİığüöç]/.test(tr.card.bestScore + tr.card.fromPublicHub));
  assert.equal(tr.share.generate, "KART OLUŞTUR");
});

test("EN and TR metric labels differ but Trajectories key stays product term", () => {
  const en = getMessages("en");
  const tr = getMessages("tr");
  assert.equal(en.profile.trajectories, tr.profile.trajectories);
  assert.notEqual(en.profile.uniqueTasks, tr.profile.uniqueTasks);
  assert.notEqual(en.profile.signedAttempts, tr.profile.signedAttempts);
});

console.log("\ni18n tests done");
