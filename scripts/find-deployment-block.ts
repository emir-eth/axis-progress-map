/**
 * Binary-search eth_getCode for the earliest block where the Axis
 * contribution contract has bytecode. Verifies previous block is empty.
 *
 * Run: npx tsx scripts/find-deployment-block.ts
 */
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";

const CONTRACT =
  "0xF91A90baA9E044Da084df369445A59D859d640dB" as Address;

const RPC = process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const client = createPublicClient({
    chain: base,
    transport: http(RPC, { timeout: 45_000, retryCount: 0 }),
  });

  async function getCode(blockNumber: bigint): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const code = await client.getCode({ address: CONTRACT, blockNumber });
        return code ?? "0x";
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (attempt === 5) throw error;
        console.warn(`getCode retry @${blockNumber}: ${msg.slice(0, 120)}`);
        await sleep(400 * 2 ** attempt);
      }
    }
    throw new Error("unreachable");
  }

  const latest = await client.getBlockNumber();
  console.log("latest block:", latest.toString());
  console.log("rpc:", RPC);

  const latestCode = await getCode(latest);
  if (!latestCode || latestCode === "0x") {
    throw new Error("Contract has no bytecode at latest block — aborting");
  }
  console.log("bytecode present at latest: yes (", latestCode.length, "chars)");

  let lo = 0n;
  let hi = latest;
  let firstWithCode: bigint | null = null;

  while (lo <= hi) {
    const mid = lo + (hi - lo) / 2n;
    const code = await getCode(mid);
    const hasCode = !!code && code !== "0x";
    console.log(
      `probe block ${mid.toString()}: ${hasCode ? "HAS CODE" : "empty"}`,
    );
    if (hasCode) {
      firstWithCode = mid;
      hi = mid - 1n;
    } else {
      lo = mid + 1n;
    }
  }

  if (firstWithCode == null) {
    throw new Error("Could not find any block with contract code");
  }

  // Verify boundary
  if (firstWithCode > 0n) {
    const prev = await getCode(firstWithCode - 1n);
    const at = await getCode(firstWithCode);
    const prevEmpty = !prev || prev === "0x";
    const atHas = !!at && at !== "0x";
    console.log("\n=== VERIFICATION ===");
    console.log("deployment block:", firstWithCode.toString());
    console.log("previous block:", (firstWithCode - 1n).toString(), "empty?", prevEmpty);
    console.log("deployment block has code?", atHas);
    if (!prevEmpty || !atHas) {
      throw new Error("Boundary verification failed");
    }
  } else {
    console.log("deployment block is genesis (0)");
  }

  console.log("\nVERIFIED_DEPLOYMENT_BLOCK=", firstWithCode.toString());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
