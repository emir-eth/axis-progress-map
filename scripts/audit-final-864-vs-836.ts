/**
 * Read-only: extract Hub Portfolio UI evidence for profile trajectories field.
 * No cache/UI/code modifications.
 */
async function main() {
  const url = "https://hub.axisrobotics.ai/assets/app-entry-Cmn2AA9h.js";
  const txt = await (await fetch(url)).text();

  // Find nfn usage (me/profile)
  let from = 0;
  let n = 0;
  console.log("=== nfn call sites ===");
  while (n < 15) {
    const k = txt.indexOf("nfn(", from);
    if (k < 0) break;
    const snip = txt.slice(k, k + 250).replace(/\s+/g, " ");
    if (!snip.includes("completion")) {
      console.log(snip);
      console.log("---");
      n += 1;
    }
    from = k + 1;
  }

  // Search for profile response property access patterns near Portfolio stats
  for (const needle of [
    "nfn()",
    "await nfn",
    ".then(",
    "hydrateFromPortfolio",
    "portfolio-stat",
    "etd-stat",
    "History",
    "ifn(",
  ]) {
    console.log(`\ncount ${needle}=${txt.split(needle).length - 1}`);
  }

  // Look for number formatting of large profile stats
  // Previous audits observed field name trajectories on /api/me/profile
  // Search case-insensitive trajectories in various encodings
  const lower = txt.toLowerCase();
  console.log("\ntrajectories lowercase count", lower.split("trajectories").length - 1);

  // Find Portfolio page component that shows history total
  from = 0;
  n = 0;
  while (n < 10) {
    const k = txt.indexOf("ifn(", from);
    if (k < 0) break;
    console.log("\nifn(", txt.slice(k, k + 300).replace(/\s+/g, " "));
    from = k + 1;
    n += 1;
  }

  // Public totals for reference
  const wallet = "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD";
  for (const qs of [
    `q=${wallet}&page=1&per_page=1`,
    `q=${wallet}&page=1&per_page=1&has_txhash=true`,
    `q=${wallet}&page=1&per_page=1&has_txhash=false`,
  ]) {
    const u = `https://hub.axisrobotics.ai/api/stats/search-attempts?${qs}`;
    const res = await fetch(u, { headers: { Accept: "application/json" } });
    const j = await res.json();
    console.log("\nAPI", qs.replace(wallet, "<w>"), "total=", j.total);
  }

  const me = await fetch("https://hub.axisrobotics.ai/api/me/profile", {
    headers: { Accept: "application/json" },
  });
  console.log("\n/api/me/profile status", me.status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
