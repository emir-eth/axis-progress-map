import Database from "better-sqlite3";

const db = new Database("data/axis-index.db", { readonly: true });
const wallets = [
  "0x1e30c7c5495a9248facbb3642aee5da0b8f75cad",
  "0x612cdfef8db47eea34b036b895fe5a6f477616d5",
  "0x0d1a77989c204468173ff4e37d1ce95f46e0d81e",
];

for (const w of wallets) {
  const c = db.prepare("SELECT * FROM hub_wallet_cache WHERE address=?").get(w);
  const rows = db
    .prepare("SELECT COUNT(*) AS c FROM hub_attempts WHERE address=?")
    .get(w) as { c: number };
  const uniq = db
    .prepare(
      "SELECT COUNT(DISTINCT attempt_id) AS c FROM hub_attempts WHERE address=?",
    )
    .get(w) as { c: number };
  console.log(JSON.stringify({ w, cache: c, rows: rows.c, uniq: uniq.c }));
}
