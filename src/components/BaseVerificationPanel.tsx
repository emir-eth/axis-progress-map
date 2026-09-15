"use client";

import type { BaseVerificationStatus } from "@/types";

interface BaseVerificationPanelProps {
  status: BaseVerificationStatus;
}

export function BaseVerificationPanel({ status }: BaseVerificationPanelProps) {
  if (status.status === "complete") {
    return (
      <div className="border-y border-border py-6">
        <p className="eng-label text-[13px]">Base verification</p>
        <p className="mt-1 font-display text-3xl tabular-nums text-ink">
          {status.recordSubmittedCount?.toLocaleString() ?? "—"}
        </p>
        <p className="mt-3 text-sm text-text-muted">
          On-chain Base records found
        </p>
      </div>
    );
  }

  if (status.status === "incomplete") {
    return (
      <div className="border-y border-border py-6">
        <p className="eng-label text-[13px]">Base verification</p>
        <p className="mt-2 text-sm text-text-muted">
          Verification in progress
          {status.recordSubmittedCount != null &&
          status.recordSubmittedCount > 0
            ? ` · ${status.recordSubmittedCount.toLocaleString()} found so far`
            : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="border-y border-border py-6">
      <p className="eng-label text-[13px]">Base verification</p>
      <p className="mt-2 text-sm text-text-muted">Not yet verified</p>
    </div>
  );
}
