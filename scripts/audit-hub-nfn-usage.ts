/** Find how Hub Portfolio binds me/profile stats (read-only). */
async function main() {
  const txt = await (
    await fetch("https://hub.axisrobotics.ai/assets/app-entry-Cmn2AA9h.js")
  ).text();

  // nfn is defined; find references that aren't the definition
  const def = 'nfn=()=>ns("/me/profile")';
  console.log("def at", txt.indexOf(def));

  // Search minified calls like await nfn() or nfn().then or =nfn
  for (const pat of ["nfn()", "nfn?.", "=nfn", "nfn,"]) {
    let from = 0;
    let n = 0;
    console.log(`\n=== ${pat} ===`);
    while (n < 8) {
      const k = txt.indexOf(pat, from);
      if (k < 0) break;
      // skip definition
      if (txt.slice(k - 5, k + 30).includes('ns("/me/profile")')) {
        from = k + 1;
        continue;
      }
      console.log(txt.slice(Math.max(0, k - 100), k + 200).replace(/\s+/g, " "));
      console.log("---");
      from = k + 1;
      n += 1;
    }
  }

  // Search Unverified tip near history filters - profile portfolio
  for (const s of [
    "Only on-chain verified trajectories",
    "No trajectories match",
    "Unverified",
    "Signed",
    "Unsigned",
  ]) {
    const k = txt.indexOf(s);
    console.log(`\n${s} @ ${k}`);
    if (k >= 0) console.log(txt.slice(k - 200, k + 250).replace(/\s+/g, " "));
  }

  // Look for History total display near ifn / V7e
  const k2 = txt.indexOf("V7e(");
  console.log("\nfirst V7e", txt.slice(k2, k2 + 400).replace(/\s+/g, " "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
