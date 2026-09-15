"use client";

import { useId, useState } from "react";
import { Info } from "lucide-react";
import type { IndexStatus } from "@/types";

interface IndexFreshnessBadgeProps {
  status: IndexStatus;
}

export function IndexFreshnessBadge({ status }: IndexFreshnessBadgeProps) {
  const [open, setOpen] = useState(false);
  const tipId = useId();

  const isFixture =
    status.dataSource === "development-fixture" ||
    status.dataSource === "verified-fixture";
  const isDisabled = status.dataSource === "ingestion-disabled";
  const isIncomplete =
    status.scanStatus === "incomplete" ||
    status.dataSource === "scan-incomplete";
  const isStale =
    status.freshness === "stale" && !isFixture && !isDisabled && !isIncomplete;

  if (isFixture) {
    return null;
  }

  if (isIncomplete || isDisabled) {
    return null;
  }

  const title = "From public Hub activity";
  const subtitle = isStale
    ? "Might be missing the newest Hub attempts"
    : null;
  const tip =
    "I pull public Hub attempts and match them to Axis task data when I can.";

  return (
    <div className="relative inline-flex max-w-full items-start gap-2 text-xs text-text-muted">
      <span
        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
          isStale ? "bg-warning" : "bg-accent"
        }`}
        aria-hidden
      />
      <div>
        <p className="text-text">{title}</p>
        {subtitle && <p className="text-text-dim">{subtitle}</p>}
      </div>
      <button
        type="button"
        className="mt-0.5 text-text-dim transition hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-expanded={open}
        aria-controls={tipId}
        onClick={() => setOpen((v) => !v)}
        title="About this data"
      >
        <Info size={13} />
      </button>
      {open && (
        <div
          id={tipId}
          role="tooltip"
          className="absolute right-0 top-full z-20 mt-2 w-72 border border-border bg-bg-elevated p-3 text-xs leading-relaxed text-text-muted shadow-lg"
        >
          <p>{tip}</p>
        </div>
      )}
    </div>
  );
}
