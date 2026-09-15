/**
 * Probe alternate public Base RPCs for large eth_getLogs support.
 */
import { getAddress } from "viem";

const CONTRACT = "0xF91A90baA9E044Da084df369445A59D859d640dB";
const TOPIC =
  "0x6d77e907890f072253fbef2eb8d17cd30e09e409799f01195372185adc5313fd";
const USER = getAddress("0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD");
const START = 43_731_412;
const userTopic = `0x${USER.slice(2).toLowerCase().padStart(64, "0")}`;

const RPCs = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://1rpc.io/base",
  "https://base.meowrpc.com",
  "https://base.drpc.org",
];

async function rpc(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as {
    result?: unknown;
    error?: { message?: string; code?: number };
  };
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

async function main() {
  for (const url of RPCs) {
    try {
      const latestHex = (await rpc(url, "eth_blockNumber", [])) as string;
      const latest = parseInt(latestHex, 16);
      const t0 = Date.now();
      try {
        const logs = (await rpc(url, "eth_getLogs", [
          {
            address: CONTRACT,
            fromBlock: `0x${START.toString(16)}`,
            toBlock: latestHex,
            topics: [TOPIC, null, null, userTopic],
          },
        ])) as unknown[];
        console.log(
          `${url}: FULL OK count=${logs.length} ms=${Date.now() - t0} latest=${latest}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // try 100k
        const t1 = Date.now();
        try {
          const from = Math.max(START, latest - 100_000);
          const logs = (await rpc(url, "eth_getLogs", [
            {
              address: CONTRACT,
              fromBlock: `0x${from.toString(16)}`,
              toBlock: latestHex,
              topics: [TOPIC, null, null, userTopic],
            },
          ])) as unknown[];
          console.log(
            `${url}: full FAIL (${msg.slice(0, 80)}) | 100k OK count=${logs.length} ms=${Date.now() - t1}`,
          );
        } catch (e2) {
          console.log(
            `${url}: full FAIL (${msg.slice(0, 60)}) | 100k FAIL (${(e2 instanceof Error ? e2.message : String(e2)).slice(0, 80)})`,
          );
        }
      }
    } catch (e) {
      console.log(`${url}: unreachable`, e instanceof Error ? e.message.slice(0, 100) : e);
    }
  }
}

main().catch(console.error);
