/** Identify the unparseable Hub row on page 8 (1 HTTP). */
import {
  HUB_SEARCH_ATTEMPTS_URL,
  parseHubAttemptItem,
} from "../src/lib/hub-attempts";
import { REFERENCE_WALLET } from "../src/lib/fixtures/reference-wallet";

async function main() {
  const url = new URL(HUB_SEARCH_ATTEMPTS_URL);
  url.searchParams.set("q", REFERENCE_WALLET);
  url.searchParams.set("page", "8");
  url.searchParams.set("per_page", "100");
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    credentials: "omit",
  });
  const body = (await res.json()) as {
    total: number;
    page: number;
    items: Record<string, unknown>[];
  };
  console.log(
    JSON.stringify(
      {
        status: res.status,
        total: body.total,
        page: body.page,
        itemCount: body.items?.length ?? 0,
      },
      null,
      2,
    ),
  );

  const rejects: unknown[] = [];
  for (let i = 0; i < (body.items?.length ?? 0); i++) {
    const item = body.items[i];
    const parsed = parseHubAttemptItem(item);
    if (!parsed) {
      rejects.push({
        idx: i,
        attempt_id: item.attempt_id,
        attempt_id_type: typeof item.attempt_id,
        task_id: item.task_id,
        task_id_type: typeof item.task_id,
        score: item.score,
        score_type: typeof item.score,
        txhash: item.txhash,
        completed_at: item.completed_at,
        username: item.username,
        keys: Object.keys(item).sort(),
      });
    }
  }
  console.log(JSON.stringify({ rejectCount: rejects.length, rejects }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
