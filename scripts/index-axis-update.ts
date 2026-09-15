/**
 * EXPERIMENTAL — not used by the app profile path.
 * Manual incremental Axis index update.
 * Usage: npm run index:axis:update
 */
import { countAxisRecords, getIndexState, openDatabase } from "../src/lib/db";
import { syncAxisIndex } from "../src/lib/indexer";

async function main() {
  openDatabase();
  const before = getIndexState();
  console.log("Before:", before);
  console.log("Events:", countAxisRecords());

  const result = await syncAxisIndex({ force: true });
  const after = getIndexState();

  console.log("\n=== SYNC RESULT ===");
  console.log(result);
  console.log("After:", after);
  console.log("Events:", countAxisRecords());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
