import { NextResponse } from "next/server";
import { loadProfileData } from "@/lib/profile-data";
import type { ProfileErrorResponse } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** First-time wallet scans are time-bounded in profile-data; allow headroom. */
export const maxDuration = 60;

function errorResponse(
  code: ProfileErrorResponse["code"],
  error: string,
  status: number,
  extra?: Partial<ProfileErrorResponse>,
) {
  const body: ProfileErrorResponse = { error, code, ...extra };
  return NextResponse.json(body, { status });
}

/**
 * Profile API — fixture, per-wallet cache, or bounded live wallet scan.
 * Does not run global indexing, Etherscan, or Blockscout.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await context.params;
  const result = await loadProfileData(raw);

  if (!result.ok) {
    return errorResponse(result.code, result.error, result.status, {
      details: result.details,
    });
  }

  const { profile } = result;
  const dataSource = profile.indexStatus.dataSource;

  return NextResponse.json(profile, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Axis-Data-Source": dataSource,
      "X-Axis-Freshness": profile.indexStatus.freshness,
      "X-Axis-Total-Ms": String(profile.timings?.totalMs ?? 0),
      "X-Axis-Eth-GetLogs": String(profile.timings?.ethGetLogs ?? 0),
    },
  });
}
