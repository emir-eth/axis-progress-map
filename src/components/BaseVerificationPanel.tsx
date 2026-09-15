"use client";

import type { BaseVerificationStatus } from "@/types";

interface BaseVerificationPanelProps {
  status: BaseVerificationStatus;
}

export function BaseVerificationPanel({ status }: BaseVerificationPanelProps) {
  if (status.status === "complete") {
    const count = status.recordSubmittedCount ?? 0;
    return (
      <div className="border-y border-border py-6">
        <p className="eng-label text-accent">Verified</p>
        <p className="mt-2 font-display text-3xl tabular-nums tracking-tight text-ink">
          {count.toLocaleString()}
        </p>
        <p className="mt-2 text-sm text-text-muted">
          {count === 1 ? "Base record" : "Base records"}
        </p>
      </div>
    );
  }

  if (status.status === "incomplete") {
    return (
      <div className="border-y border-border py-6">
        <p className="eng-label text-accent">Verifying</p>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          Scanning public Base records…
        </p>
      </div>
    );
  }

  return (
    <div className="border-y border-border py-6">
      <p className="eng-label">Not available</p>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">
        Base verification could not be completed.
      </p>
    </div>
  );
}
