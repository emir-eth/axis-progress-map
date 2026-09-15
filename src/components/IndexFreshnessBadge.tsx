"use client";

import { useId, useState } from "react";
import { Info } from "lucide-react";
import { formatHubActivityFreshnessLabelLocalized } from "@/lib/i18n";
import type { IndexStatus } from "@/types";
import { useLocale } from "./LocaleProvider";

interface IndexFreshnessBadgeProps {
  status: IndexStatus;
  /** Test override — production uses Date.now(). */
  nowMs?: number;
}

export function IndexFreshnessBadge({
  status,
  nowMs,
}: IndexFreshnessBadgeProps) {
  const { locale, messages: m } = useLocale();
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

  const title = formatHubActivityFreshnessLabelLocalized({
    locale,
    freshness: status.freshness,
    lastVerifiedAt: status.lastSyncAt,
    nowMs,
  });
  const subtitle = isStale ? m.freshness.staleSub : null;

  return (
    <div className="relative inline-flex max-w-full items-start gap-2 text-xs text-text-muted">
      <span
        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
          isStale ? "bg-warning" : "bg-accent"
        }`}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="uppercase tracking-[0.12em] text-text">{title}</p>
        {subtitle && <p className="text-text-dim">{subtitle}</p>}
      </div>
      <button
        type="button"
        className="mt-0.5 shrink-0 text-text-dim transition hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-expanded={open}
        aria-controls={tipId}
        onClick={() => setOpen((v) => !v)}
        title={m.freshness.aboutData}
      >
        <Info size={13} />
      </button>
      {open && (
        <div
          id={tipId}
          role="tooltip"
          className="absolute right-0 top-full z-20 mt-2 w-72 border border-border bg-bg-elevated p-3 text-xs leading-relaxed text-text-muted shadow-lg"
        >
          <p>{m.freshness.tip}</p>
        </div>
      )}
    </div>
  );
}
