const RPC = "https://mainnet.base.org";

async function probe(n: number) {
  const start = 51059000;
  const body = Array.from({ length: n }, (_, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: "eth_getBlockByNumber",
    params: [`0x${(start + i).toString(16)}`, false],
  }));
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { error?: unknown; message?: string } | unknown[];
  console.log(
    `n=${n}`,
    Array.isArray(j) ? `array:${j.length}` : `object:${JSON.stringify(j).slice(0, 120)}`,
  );
}

async function main() {
  for (const n of [3, 10, 20, 25, 40]) {
    await probe(n);
  }
}

main().catch(console.error);
