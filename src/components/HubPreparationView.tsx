"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { ASSETS } from "@/lib/assets";
import { shortenAddress } from "@/lib/format";
import { SiteNav } from "./SiteNav";

export type HubPrepMode = "syncing" | "paused" | "session-limit" | "ready";

export interface HubPreparationViewProps {
  address: string;
  /** Known Hub total (may be shown before all rows are cached). */
  hubTotal: number | null;
  fetchedAttempts: number;
  /** Retained for callers; not shown in the UI. */
  lastCompletedPage?: number | null;
  totalPages?: number | null;
  mode: HubPrepMode;
  /** True while a soft resume request is in flight. */
  syncing: boolean;
  onContinue: () => void;
}

/** Truthful Hub history progress — fetched / total. */
export function hubHistoryProgressPercent(
  fetched: number,
  total: number,
): number | null {
  if (total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((fetched / total) * 100)));
}

/**
 * Dedicated Hub-history preparation layout.
 * Shown only while Hub cache is incomplete — not the full profile shell.
 */
export function HubPreparationView({
  address,
  hubTotal,
  fetchedAttempts,
  mode,
  syncing,
  onContinue,
}: HubPreparationViewProps) {
  const total = hubTotal ?? 0;
  const pct = hubHistoryProgressPercent(fetchedAttempts, total);

  if (mode === "ready") {
    return (
      <div className="flex min-h-screen flex-col bg-bg">
        <SiteNav />
        <main className="content-shell flex flex-1 flex-col justify-center px-5 py-16 sm:px-8">
          <div className="mx-auto w-full max-w-lg motion-safe:animate-fade-in">
            <p className="eng-label text-accent">Axis contributor</p>
            <p className="mt-8 font-display text-[clamp(1.75rem,4vw,2.25rem)] font-semibold tracking-[-0.03em] text-ink">
              Ready
            </p>
            <div className="mt-8">
              <p className="eng-label text-[13px]">Activity history</p>
              <ActivityProgressRail percent={100} />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteNav />

      <main className="content-shell flex flex-1 flex-col px-5 pb-12 pt-6 sm:px-8 sm:pb-16 sm:pt-8">
        <div className="mb-8 mt-4 sm:mb-10 sm:mt-5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 border border-ink px-3.5 py-2 font-mono text-[13px] tracking-[0.14em] text-ink transition hover:bg-ink hover:text-bg focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <ArrowLeft size={14} />
            NEW WALLET
          </Link>
        </div>

        <div className="grid flex-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.42fr)] lg:items-center lg:gap-16">
          <div className="max-w-xl">
            <p className="eng-label text-accent">Axis contributor</p>
            <p className="mt-2 font-mono text-sm text-text-muted sm:text-base">
              {shortenAddress(address, 6)}
            </p>

            <h1 className="mt-8 font-display text-[clamp(1.85rem,5vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-ink">
              <span className="block">Pulling your</span>
              <span className="block">Hub history…</span>
            </h1>

            <p className="mt-5 text-[15px] leading-relaxed text-text-muted">
              First load can take a bit — I’m paging through public Hub data.
            </p>

            <div className="mt-10 border-t border-border pt-8">
              <p className="font-display text-[clamp(2.5rem,6vw,3.5rem)] font-semibold tabular-nums tracking-[-0.04em] text-accent">
                {total > 0 ? total.toLocaleString() : "—"}
              </p>
              <p className="mt-2 eng-label">Hub attempts found</p>
            </div>

            <div className="mt-8">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="eng-label text-[13px]">Activity history</p>
                {pct != null && (
                  <p className="font-mono text-[13px] tabular-nums tracking-[0.08em] text-text-muted">
                    {pct}%
                  </p>
                )}
              </div>
              <ActivityProgressRail
                percent={pct ?? 0}
                ariaValueNow={fetchedAttempts}
                ariaValueMax={total > 0 ? total : undefined}
              />
              <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-display text-2xl font-semibold tabular-nums tracking-[-0.03em] text-ink sm:text-3xl">
                  {total > 0
                    ? `${fetchedAttempts.toLocaleString()} / ${total.toLocaleString()}`
                    : fetchedAttempts > 0
                      ? fetchedAttempts.toLocaleString()
                      : "—"}
                </p>
                <p className="eng-label text-[13px]">Attempts loaded</p>
              </div>
            </div>

            <div className="mt-8 min-h-[4.5rem]">
              {mode === "syncing" && (
                <div className="flex items-center gap-2.5">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full bg-accent ${
                      syncing ? "motion-safe:animate-pulse" : ""
                    }`}
                    aria-hidden
                  />
                  <p className="font-mono text-[13px] tracking-[0.16em] text-text">
                    LOADING HUB HISTORY
                  </p>
                </div>
              )}

              {(mode === "paused" || mode === "session-limit") && (
                <div className="border border-border bg-bg-elevated px-4 py-5">
                  <p className="eng-label text-warning">Loading paused</p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onContinue}
                      disabled={syncing}
                      className="border border-ink bg-ink px-4 py-2.5 font-mono text-[13px] tracking-[0.14em] text-bg transition hover:border-accent hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      CONTINUE
                    </button>
                    <Link
                      href="/"
                      className="inline-flex items-center gap-2 border border-ink px-4 py-2.5 font-mono text-[13px] tracking-[0.14em] text-ink transition hover:bg-ink hover:text-bg"
                    >
                      <ArrowLeft size={14} />
                      NEW WALLET
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div
            className="relative mx-auto w-full max-w-[280px] opacity-45 sm:max-w-[320px] lg:mx-0 lg:max-w-none lg:opacity-55"
            aria-hidden
          >
            <Image
              src={ASSETS.robotProfile}
              alt=""
              width={900}
              height={900}
              className="relative z-[1] h-auto w-full object-contain"
              priority
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function ActivityProgressRail({
  percent,
  ariaValueNow,
  ariaValueMax,
}: {
  percent: number;
  ariaValueNow?: number;
  ariaValueMax?: number;
}) {
  const width = Math.min(100, Math.max(0, percent));
  const ticks = [0, 25, 50, 75, 100];

  return (
    <div className="mt-3">
      <div
        role="progressbar"
        aria-label="Activity history loaded"
        aria-valuemin={0}
        aria-valuemax={ariaValueMax ?? 100}
        aria-valuenow={
          ariaValueNow != null ? ariaValueNow : Math.round(width)
        }
        className="relative h-1.5 w-full bg-border"
      >
        <div
          className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${width}%` }}
        />
        <div className="pointer-events-none absolute inset-0 flex justify-between">
          {ticks.map((t) => (
            <span
              key={t}
              className="h-full w-px bg-border-strong/50"
              style={{ opacity: t === 0 || t === 100 ? 0 : 1 }}
              aria-hidden
            />
          ))}
        </div>
      </div>
    </div>
  );
}
