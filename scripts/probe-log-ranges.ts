/**
 * Probe whether the configured RPC accepts large eth_getLogs ranges.
 * Run: npx tsx scripts/probe-log-ranges.ts
 */
import { createPublicClient, http, getAddress } from "viem";
import { base } from "viem/chains";

const CONTRACT = "0xF91A90baA9E044Da084df369445A59D859d640dB" as const;
const TOPIC =
  "0x6d77e907890f072253fbef2eb8d17cd30e09e409799f01195372185adc5313fd" as const;
const USER = getAddress("0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD");
const START = 43_731_412n;
const RPC = process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org";

async function main() {
  const client = createPublicClient({
    chain: base,
    transport: http(RPC, { timeout: 60_000, retryCount: 0 }),
  });
  const latest = await client.getBlockNumber();
  const userTopic =
    `0x${USER.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`;

  console.log("rpc:", RPC);
  console.log("latest:", latest.toString());
  console.log("range:", START.toString(), "→", latest.toString());

  const ranges = [
    { label: "full", from: START, to: latest },
    { label: "1M", from: latest - 1_000_000n, to: latest },
    { label: "100k", from: latest - 100_000n, to: latest },
    { label: "50k", from: latest - 50_000n, to: latest },
    { label: "10k", from: latest - 10_000n, to: latest },
  ];

  for (const r of ranges) {
    const from = r.from < START ? START : r.from;
    const t0 = Date.now();
    try {
      const logs = await client.request({
        method: "eth_getLogs",
        params: [
          {
            address: CONTRACT,
            fromBlock: `0x${from.toString(16)}`,
            toBlock: `0x${r.to.toString(16)}`,
            topics: [TOPIC, null, null, userTopic],
          },
        ],
      });
      console.log(
        `${r.label}: OK count=${Array.isArray(logs) ? logs.length : "?"} ms=${Date.now() - t0}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`${r.label}: FAIL ms=${Date.now() - t0} :: ${msg.slice(0, 200)}`);
    }
  }

  // Batch eth_getBlockByNumber probe
  const t1 = Date.now();
  try {
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "eth_getBlockByNumber",
        params: ["0x2f4b2e4", false],
      },
    ];
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    const json = await res.json();
    console.log(
      "batch probe:",
      res.status,
      Array.isArray(json) ? `array len=${json.length}` : typeof json,
      `ms=${Date.now() - t1}`,
    );
  } catch (e) {
    console.log("batch probe FAIL", e instanceof Error ? e.message : e);
  }
}

main().catch(console.error);
