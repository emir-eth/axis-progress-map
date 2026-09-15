/**
 * Audit skill assets, counts, and mapping for a complete Hub wallet.
 */
import fs from "node:fs";
import path from "node:path";
import {
  closeDatabase,
  getCachedHubAttempts,
  getHubWalletCache,
  openDatabase,
} from "../src/lib/db";
import { loadHubContributions } from "../src/lib/hub-attempts";
import { buildTaskIndex, matchHubAttempts } from "../src/lib/matcher";
import { fetchAxisTaskFamiliesWithInfo } from "../src/lib/axis";
import { buildAnalytics } from "../src/lib/analytics";
import { ASSETS, skillAsset } from "../src/lib/assets";
import { REFERENCE_WALLET } from "../src/lib/fixtures/reference-wallet";
import { computeHubSemanticCounts } from "../src/lib/hub-semantics";

const SKILLS = [
  "Pick",
  "Place",
  "Transfer",
  "Stack",
  "Open",
  "Arrange",
  "Rotate",
] as const;

async function main() {
  const publicDir = path.join(process.cwd(), "public");
  const assetReport = SKILLS.map((s) => {
    const url = skillAsset(s);
    const rel = url?.replace(/^\//, "") ?? null;
    const abs = rel ? path.join(publicDir, rel) : null;
    const original = path.join(
      publicDir,
      "assets",
      `axis-skill-${s.toLowerCase()}.png`,
    );
    return {
      skill: s,
      mappedUrl: url,
      tightExists: abs ? fs.existsSync(abs) : false,
      originalExists: fs.existsSync(original),
      tightBytes: abs && fs.existsSync(abs) ? fs.statSync(abs).size : 0,
    };
  });
  console.log("ASSETS", JSON.stringify(assetReport, null, 2));

  openDatabase();
  const wallet = REFERENCE_WALLET;
  const addr = wallet.toLowerCase() as `0x${string}`;
  const cache = getHubWalletCache(addr);
  const rows = getCachedHubAttempts(addr);
  const semantics = computeHubSemanticCounts(rows);

  const meta = await fetchAxisTaskFamiliesWithInfo();
  const index = buildTaskIndex(meta.families);
  const contributions = loadHubContributions(addr);
  const mapped = matchHubAttempts(contributions, index);
  const analytics = buildAnalytics(mapped, true);

  // Dedup check: how many mapped rows have duplicate skill names
  let dupSkillRows = 0;
  const examples: Record<string, string[]> = {};
  for (const s of SKILLS) examples[s] = [];

  let matched = 0;
  let unmatched = 0;
  for (const c of mapped) {
    if (c.metadataStatus === "mapped") matched += 1;
    else unmatched += 1;
    const skills = c.skills ?? [];
    if (new Set(skills).size !== skills.length) dupSkillRows += 1;
    for (const sk of [...new Set(skills)]) {
      if (examples[sk] && examples[sk].length < 3) {
        examples[sk].push(c.taskId);
      }
    }
  }

  // Raw skill name variants from metadata
  const nameVariants = new Map<string, number>();
  for (const c of mapped) {
    for (const sk of c.skills) {
      nameVariants.set(sk, (nameVariants.get(sk) ?? 0) + 1);
    }
  }

  console.log(
    JSON.stringify(
      {
        wallet: addr,
        cacheStatus: cache?.status,
        hubAttempts: semantics.hubAttemptCount,
        signed: semantics.trajectoryCount,
        unsigned: semantics.unsignedAttemptCount,
        matched,
        unmatched,
        dupSkillRows,
        skillCounts: Object.fromEntries(
          analytics.skills.map((s) => [s.skill, s.contributionCount]),
        ),
        examples,
        skillNameVariants: [...nameVariants.entries()].sort(
          (a, b) => b[1] - a[1],
        ),
        themes: analytics.themes.slice(0, 8),
        coverage: analytics.coverage,
        summary: analytics.summary,
        assetKeys: Object.keys(ASSETS.skills),
      },
      null,
      2,
    ),
  );
  closeDatabase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
