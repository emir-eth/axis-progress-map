"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, RefreshCw } from "lucide-react";
import type { ProfileErrorResponse, ProfileResponse } from "@/types";
import { formatPercent, formatScore, shortenAddress } from "@/lib/format";
import { ASSETS } from "@/lib/assets";
import {
  PROFILE_RESUME_DELAY_MS,
  isResumeSessionExhausted,
  isScanIncompleteStatus,
  mergeProfileResponse,
  shouldScheduleAutoResume,
  shouldShowPrepPaused,
} from "@/lib/profile-resume";
import { SiteNav } from "./SiteNav";
import { SiteFooter } from "./SiteFooter";
import { MapTransition } from "./MapTransition";
import { SkillDistribution } from "./SkillDistribution";
import { Environments } from "./Environments";
import { ContributionHistory } from "./ContributionHistory";
import { ContributionExplorer } from "./ContributionExplorer";
import { IndexFreshnessBadge } from "./IndexFreshnessBadge";
import { DataCoverage } from "./DataCoverage";
import { MethodologySection } from "./MethodologySection";
import { BaseVerificationPanel } from "./BaseVerificationPanel";
import { ShareCardCta } from "./ShareCardCta";
import {
  HubPreparationView,
  type HubPrepMode,
} from "./HubPreparationView";

interface ProfileViewProps {
  address: string;
}

function SectionHeader({
  code,
  title,
  subtitle,
  spacious,
}: {
  code: string;
  title: string;
  subtitle?: string;
  spacious?: boolean;
}) {
  return (
    <div
      className={`border-b border-border pb-4 ${
        spacious ? "mb-10 sm:mb-12" : "mb-8"
      }`}
    >
      <p className="font-mono text-[11px] tracking-[0.2em] text-accent">
        {code}
      </p>
      <h2 className="mt-2 font-display text-xl tracking-tight text-ink sm:text-2xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-muted">
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function ProfileView({ address }: ProfileViewProps) {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<ProfileErrorResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [pausedAuto, setPausedAuto] = useState(false);
  const [softLoading, setSoftLoading] = useState(false);
  /** Soft resume failed while incomplete data is still on screen. */
  const [softPaused, setSoftPaused] = useState(false);
  /** Brief “report ready” beat before showing the full profile. */
  const [readyFlash, setReadyFlash] = useState(false);
  /** Re-arms auto-resume after soft timeout/abort of the current request. */
  const [resumeEpoch, setResumeEpoch] = useState(0);
  /** After short MapTransition, show prep shell even before first response. */
  const [transitionSettled, setTransitionSettled] = useState(false);
  /** True while an auto-resume timer is armed (keep SYNCING, not PAUSED). */
  const [resumeScheduled, setResumeScheduled] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  /** Monotonic id so superseded aborts are ignored; timeout of current request re-arms. */
  const fetchGenRef = useRef(0);
  const addressRef = useRef(address);
  const resumeCountRef = useRef(0);
  const sessionStartRef = useRef<number | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const wasIncompleteRef = useRef(false);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef<ProfileResponse | null>(null);

  addressRef.current = address;

  const clearResumeTimer = () => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  };

  const settleTransition = useCallback(() => {
    setTransitionSettled(true);
  }, []);

  const fetchProfile = useCallback(
    async (opts?: { soft?: boolean; allowStale?: boolean }) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const requestAddress = addressRef.current;
      const fetchGen = ++fetchGenRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const soft = opts?.soft === true;
      if (!soft) {
        setError(null);
        // Only clear when hard-loading a wallet with no usable prior snapshot
        // for this same address (wallet switch / first paint). Never blank a
        // complete profile for ordinary refresh.
        const prior = dataRef.current;
        const priorComplete =
          prior != null &&
          prior.address.toLowerCase() === requestAddress.toLowerCase() &&
          !isScanIncompleteStatus({
            scanStatus: prior.indexStatus.scanStatus,
            dataSource: prior.indexStatus.dataSource,
          });
        if (!priorComplete) {
          setData(null);
          dataRef.current = null;
        }
        setSoftPaused(false);
      } else {
        setSoftLoading(true);
        setSoftPaused(false);
      }

      // Soft resumes must outlive the server Hub budget (45s) + JSON overhead.
      const timeoutMs = 55_000;
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

      try {
        const qs = opts?.allowStale ? "?allowStale=1" : "";
        const res = await fetch(`/api/profile/${requestAddress}${qs}`, {
          signal: controller.signal,
        });
        const json = await res.json();
        if (!mountedRef.current) return;
        if (fetchGen !== fetchGenRef.current) return;
        if (addressRef.current.toLowerCase() !== requestAddress.toLowerCase()) {
          return;
        }
        if (!res.ok) {
          setError(json as ProfileErrorResponse);
          if (!soft) {
            setData(null);
            dataRef.current = null;
          }
          return;
        }
        const incoming = json as ProfileResponse;
        const merged = mergeProfileResponse(
          dataRef.current,
          incoming,
          requestAddress,
        );
        if (!merged) return;
        setError(null);
        dataRef.current = merged;
        setData(merged);
        setSoftPaused(false);
        // Real data arrived — leave the decorative transition immediately.
        setTransitionSettled(true);
      } catch (err) {
        if (!mountedRef.current) return;
        if (fetchGen !== fetchGenRef.current) return;
        if (addressRef.current.toLowerCase() !== requestAddress.toLowerCase()) {
          return;
        }

        const aborted =
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError");

        if (soft) {
          setSoftLoading(false);
          if (aborted) {
            // Timeout/abort of THIS soft resume: re-arm auto-resume.
            setResumeEpoch((n) => n + 1);
            return;
          }
          setSoftPaused(true);
          return;
        }
        setError({
          error: aborted
            ? "Report generation timed out."
            : "Failed to reach the profile API.",
          code: aborted ? "SYNC_FAILED" : "INTERNAL",
          details: aborted
            ? "The request took too long. You can retry."
            : undefined,
          canShowStale: aborted,
        });
        if (!dataRef.current) {
          setData(null);
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (fetchGen === fetchGenRef.current) {
          inFlightRef.current = false;
          if (mountedRef.current) setSoftLoading(false);
        }
      }
    },
    [],
  );

  // Initial load + cleanup on address change / unmount
  useEffect(() => {
    mountedRef.current = true;
    resumeCountRef.current = 0;
    sessionStartRef.current = Date.now();
    setPausedAuto(false);
    setReadyFlash(false);
    setSoftPaused(false);
    setSoftLoading(false);
    setTransitionSettled(false);
    setResumeScheduled(false);
    setError(null);
    setData(null);
    dataRef.current = null;
    wasIncompleteRef.current = false;
    if (readyTimerRef.current) {
      clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
    clearResumeTimer();
    // Invalidate any in-flight response from the previous wallet.
    fetchGenRef.current += 1;
    abortRef.current?.abort();
    inFlightRef.current = false;
    void fetchProfile({ soft: false });

    return () => {
      mountedRef.current = false;
      clearResumeTimer();
      if (readyTimerRef.current) {
        clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
      }
      abortRef.current?.abort();
      inFlightRef.current = false;
    };
  }, [address, fetchProfile]);

  useEffect(() => {
    try {
      const key = sessionStorage.getItem("axis-map-reveal");
      if (key && key === address.toLowerCase()) {
        setReveal(true);
        sessionStorage.removeItem("axis-map-reveal");
      }
    } catch {
      /* ignore */
    }
  }, [address]);

  // Controlled auto-resume: one timeout after each incomplete response
  useEffect(() => {
    clearResumeTimer();
    setResumeScheduled(false);
    if (!data || error || pausedAuto || softPaused) return;

    const incomplete = isScanIncompleteStatus({
      scanStatus: data.indexStatus.scanStatus,
      dataSource: data.indexStatus.dataSource,
    });
    if (!incomplete) return;

    if (sessionStartRef.current == null) {
      sessionStartRef.current = Date.now();
    }
    const elapsed = Date.now() - (sessionStartRef.current ?? Date.now());

    if (
      !shouldScheduleAutoResume({
        scanStatus: data.indexStatus.scanStatus,
        canResume: data.indexStatus.canResume,
        dataSource: data.indexStatus.dataSource,
        autoResumeCount: resumeCountRef.current,
        sessionElapsedMs: elapsed,
        pausedByUser: pausedAuto || softPaused,
        fetchInFlight: inFlightRef.current || softLoading,
      })
    ) {
      return;
    }

    setResumeScheduled(true);
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null;
      setResumeScheduled(false);
      if (!mountedRef.current) return;
      const againElapsed =
        Date.now() - (sessionStartRef.current ?? Date.now());
      if (
        isResumeSessionExhausted(resumeCountRef.current, againElapsed) ||
        pausedAuto ||
        softPaused
      ) {
        return;
      }
      resumeCountRef.current += 1;
      void fetchProfile({ soft: true });
    }, PROFILE_RESUME_DELAY_MS);

    return () => {
      clearResumeTimer();
      setResumeScheduled(false);
    };
  }, [data, error, pausedAuto, softPaused, softLoading, resumeEpoch, fetchProfile]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  const continuePreparing = () => {
    if (inFlightRef.current || softLoading) return;
    setPausedAuto(false);
    setSoftPaused(false);
    // Allow another session window from continue; keep Hub checkpoint.
    if (
      isResumeSessionExhausted(
        resumeCountRef.current,
        Date.now() - (sessionStartRef.current ?? Date.now()),
      )
    ) {
      resumeCountRef.current = 0;
      sessionStartRef.current = Date.now();
    }
    void fetchProfile({ soft: true });
  };

  // Track incomplete → complete for a short “report ready” transition
  useEffect(() => {
    if (!data) return;
    const incomplete = isScanIncompleteStatus({
      scanStatus: data.indexStatus.scanStatus,
      dataSource: data.indexStatus.dataSource,
    });
    if (incomplete) {
      wasIncompleteRef.current = true;
      return;
    }
    if (wasIncompleteRef.current) {
      wasIncompleteRef.current = false;
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        setReadyFlash(false);
        setReveal(true);
        return;
      }
      setReadyFlash(true);
      if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
      readyTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          setReadyFlash(false);
          setReveal(true);
        }
      }, 420);
    }
  }, [data]);

  if (error && !data) {
    return (
      <div className="flex min-h-screen flex-col bg-bg">
        <SiteNav />
        <main className="content-shell flex flex-1 flex-col justify-center px-5 py-16 sm:px-8">
          <p className="eng-label">Couldn’t build this</p>
          <h1 className="mt-3 font-display text-3xl text-ink">{error.error}</h1>
          {error.details &&
            !/sqlite|RPC|checkpoint|request budget|page cursor|provider|stack|cache|HTTP|rate limited|reconcile|in-memory|freshness/i.test(
              error.details,
            ) && (
            <p className="mt-3 text-sm text-text-muted">{error.details}</p>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                resumeCountRef.current = 0;
                sessionStartRef.current = Date.now();
                setPausedAuto(false);
                void fetchProfile({ soft: false });
              }}
              className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2.5 text-sm text-bg transition hover:bg-text"
            >
              <RefreshCw size={14} />
              Retry
            </button>
            {error.canShowStale && (
              <button
                type="button"
                onClick={() => fetchProfile({ soft: false, allowStale: true })}
                className="border border-border px-4 py-2.5 text-sm text-text-muted transition hover:border-border-strong hover:text-text"
              >
                Show last available data
              </button>
            )}
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 border border-ink px-4 py-2.5 font-mono text-[12px] tracking-[0.12em] text-ink transition hover:bg-ink hover:text-bg"
            >
              <ArrowLeft size={14} />
              NEW WALLET
            </Link>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (!data) {
    // Short decorative bridge only — after ~1.2s show the prep shell
    // even if the first Hub response has not arrived yet.
    if (!transitionSettled) {
      return (
        <div className="flex min-h-screen flex-col bg-bg">
          <SiteNav />
          <main className="flex-1">
            <MapTransition
              address={address}
              waiting
              variant="hold"
              onSettled={settleTransition}
            />
          </main>
          <SiteFooter />
        </div>
      );
    }
    return (
      <HubPreparationView
        address={address}
        hubTotal={null}
        fetchedAttempts={0}
        lastCompletedPage={null}
        totalPages={null}
        mode="syncing"
        syncing
        onContinue={continuePreparing}
      />
    );
  }

  const { analytics, contributions, warnings, indexStatus, empty } = data;
  const { summary, coverage, skills, themes, timeline, metadataAvailable } =
    analytics;

  const isDevFixture = indexStatus.dataSource === "development-fixture";
  const isScanIncomplete = isScanIncompleteStatus({
    scanStatus: indexStatus.scanStatus,
    dataSource: indexStatus.dataSource,
  });
  const eventLevelAvailable = contributions.length > 0 && !isScanIncomplete;
  const showHistory = eventLevelAvailable && timeline.length > 0;
  const showExplorer = eventLevelAvailable;

  const sessionElapsed =
    Date.now() - (sessionStartRef.current ?? Date.now());
  const sessionExhausted =
    isScanIncomplete &&
    (pausedAuto ||
      isResumeSessionExhausted(resumeCountRef.current, sessionElapsed));

  // ── Dedicated preparation layout (incomplete Hub history) ────────────
  if (isScanIncomplete || readyFlash) {
    const hub = data.hubStatus;
    const fetched = hub?.fetchedAttempts ?? 0;
    const total =
      hub?.totalAttempts ??
      data.hubTrajectories ??
      0;

    let prepMode: HubPrepMode = "syncing";
    if (readyFlash) {
      prepMode = "ready";
    } else if (
      shouldShowPrepPaused({
        softPaused: softPaused || pausedAuto,
        sessionExhausted,
        softLoading,
        resumeScheduled,
        canResume: data.indexStatus.canResume,
      })
    ) {
      prepMode = sessionExhausted ? "session-limit" : "paused";
    }

    return (
      <HubPreparationView
        address={data.address}
        hubTotal={total > 0 ? total : null}
        fetchedAttempts={fetched}
        lastCompletedPage={hub?.lastCompletedPage ?? null}
        totalPages={hub?.totalPages ?? null}
        mode={prepMode}
        syncing={softLoading || resumeScheduled || prepMode === "syncing"}
        onContinue={continuePreparing}
      />
    );
  }

  // ── Complete profile ─────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteNav />

      <main
        className={`content-shell flex-1 px-5 pb-12 pt-6 sm:px-8 sm:pb-16 sm:pt-8 ${
          reveal ? "animate-fade-up" : ""
        }`}
      >
        <div className="mb-10 mt-4 flex flex-wrap items-center justify-between gap-3 sm:mt-5 sm:mb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 border border-ink px-3.5 py-2 font-mono text-[12px] tracking-[0.14em] text-ink transition hover:bg-ink hover:text-bg focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <ArrowLeft size={14} />
            NEW WALLET
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={copyAddress}
              className="inline-flex items-center gap-1.5 text-[12px] text-text-muted transition hover:text-text"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy address"}
            </button>
            <IndexFreshnessBadge status={indexStatus} />
          </div>
        </div>

        {warnings.filter(
          (w) =>
            !/cache|checkpoint|sqlite|page \d|RPC|budget|rate limited|HTTP|in-memory|reconcile|freshness|Serving cached|metadata unavailable|transient/i.test(
              w,
            ),
        ).length > 0 &&
          !isDevFixture && (
          <div className="mb-8 border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            {warnings
              .filter(
                (w) =>
                  !/cache|checkpoint|sqlite|page \d|RPC|budget|rate limited|HTTP|in-memory|reconcile|freshness|Serving cached|metadata unavailable|transient/i.test(
                    w,
                  ),
              )
              .map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}

        <header className="max-w-3xl">
          <p className="eng-label text-accent">Axis contributor</p>
          <p className="mt-2 font-mono text-sm text-text-muted sm:text-base">
            {shortenAddress(data.address, 6)}
          </p>
          <h1 className="mt-6 font-display text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-ink">
            <span className="block">Your Axis</span>
            <span className="block">activity map</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-text-muted">
            Pulled from public Hub attempts, then matched to Axis task info where
            it exists.
          </p>
        </header>

        {empty ? (
          <p className="mt-12 text-[15px] text-text-muted">
            No Hub attempts found for this wallet.
          </p>
        ) : (
          <div className="mt-12 space-y-[4.5rem] sm:mt-14 sm:space-y-[5.5rem] lg:space-y-24">
            <section className="grid items-end gap-10 border-y border-border py-10 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)] lg:gap-12 lg:py-12">
              <div>
                <p className="font-display text-[clamp(3.5rem,8vw,5.5rem)] font-semibold leading-none tracking-[-0.04em] text-accent">
                  {(
                    data.hubTrajectories ??
                    data.hubStatus?.totalAttempts ??
                    summary.onChainContributions
                  ).toLocaleString()}
                </p>
                <p className="mt-2 eng-label">Trajectories</p>
                <p className="mt-1 text-[12px] text-text-dim">
                  From public Hub activity
                </p>
                <p className="mt-2 max-w-md text-[11px] leading-relaxed text-text-muted">
                  Hub’s logged-in total can be a bit different — this page uses
                  the public number.
                </p>

                <div className="mt-8 grid grid-cols-3 gap-4 border-t border-border pt-6">
                  <div>
                    <p className="font-display text-2xl tabular-nums text-ink sm:text-3xl">
                      {summary.uniqueTasks}
                    </p>
                    <p className="mt-1 eng-label text-[11px]">Unique tasks</p>
                  </div>
                  <div className="border-l border-border pl-4">
                    <p className="font-display text-2xl tabular-nums text-ink sm:text-3xl">
                      {formatScore(summary.averageScore)}
                    </p>
                    <p className="mt-1 eng-label text-[11px]">Average score</p>
                  </div>
                  <div className="border-l border-border pl-4">
                    <p className="font-display text-2xl tabular-nums text-ink sm:text-3xl">
                      {formatScore(summary.bestScore)}
                    </p>
                    <p className="mt-1 eng-label text-[11px]">Best score</p>
                  </div>
                </div>

                {data.hubTxhash && (
                  <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5">
                    <div>
                      <p className="font-display text-xl tabular-nums text-ink">
                        {data.hubTxhash.trajectoryCount.toLocaleString()}
                      </p>
                      <p className="mt-1 eng-label text-[11px]">
                        Signed attempts
                      </p>
                    </div>
                    <div className="border-l border-border pl-4">
                      <p className="font-display text-xl tabular-nums text-ink">
                        {data.hubTxhash.unsignedAttemptCount.toLocaleString()}
                      </p>
                      <p className="mt-1 eng-label text-[11px]">
                        Unsigned attempts
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="relative">
                <div
                  className="pointer-events-none absolute inset-0"
                  aria-hidden
                >
                  <div className="absolute left-0 top-[12%] h-px w-12 bg-border-strong" />
                  <div className="absolute right-[10%] top-[8%] h-10 w-10 rounded-full border border-border" />
                  <div className="absolute bottom-[20%] left-[8%] h-2 w-2">
                    <div className="absolute left-0 top-1/2 h-px w-2 bg-text-dim" />
                    <div className="absolute left-1/2 top-0 h-2 w-px bg-text-dim" />
                  </div>
                </div>
                <Image
                  src={ASSETS.robotProfile}
                  alt="Technical illustration of a robot arm"
                  width={1000}
                  height={1000}
                  className="relative z-[1] mx-auto h-auto w-full max-w-[420px] object-contain lg:max-w-none"
                  priority
                />
                <div className="relative z-[1] mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-4">
                  <p className="font-mono text-[12px] tabular-nums text-text-muted">
                    {coverage.mappedUniqueTasks} / {coverage.totalUniqueTasks}{" "}
                    tasks mapped
                  </p>
                  <p className="font-display text-lg tabular-nums text-accent">
                    {formatPercent(coverage.coveragePercent)}
                    <span className="ml-2 eng-label text-text-dim">
                      task coverage
                    </span>
                  </p>
                </div>
              </div>
            </section>

            <section>
              <SectionHeader
                code="01 / SKILL DISTRIBUTION"
                title="Skill distribution"
                subtitle="Which skills show up most in your matched tasks."
                spacious
              />
              <SkillDistribution
                skills={skills}
                mappedContributions={coverage.mappedContributions}
                eventLevelAvailable={eventLevelAvailable}
              />
            </section>

            <section>
              <SectionHeader
                code="02 / ENVIRONMENT DISTRIBUTION"
                title="Environment distribution"
                subtitle="Where those tasks sit — kitchen, home, office, etc."
              />
              <Environments
                themes={themes}
                mappedContributions={coverage.mappedContributions}
              />
            </section>

            <section>
              <SectionHeader code="03 / DATA COVERAGE" title="Data coverage" />
              <DataCoverage coverage={coverage} />
            </section>

            <section>
              <SectionHeader
                code="04 / METHODOLOGY"
                title="How I build this"
              />
              <MethodologySection />
            </section>

            <section>
              <SectionHeader
                code="05 / BASE VERIFICATION"
                title="Base verification"
                subtitle="Extra Base check if I already have it — Hub numbers still lead."
              />
              <BaseVerificationPanel status={data.baseVerification} />
            </section>

            {showHistory && (
              <section>
                <SectionHeader
                  code="06 / HISTORY"
                  title="Contribution history"
                  subtitle="Your Hub attempts over time."
                />
                <ContributionHistory timeline={timeline} />
              </section>
            )}

            {showExplorer && (
              <section>
                <SectionHeader
                  code="07 / EXPLORER"
                  title="Contribution explorer"
                  subtitle="Every public Hub attempt for this wallet."
                />
                <ContributionExplorer contributions={contributions} />
              </section>
            )}

            {!metadataAvailable && (
              <p className="text-sm text-text-dim">
                Skill / environment detail needs Axis task matching — missing
                for this load.
              </p>
            )}

            <ShareCardCta
              address={data.address}
              analytics={analytics}
              indexStatus={indexStatus}
              hubTxhash={data.hubTxhash}
              baseVerification={data.baseVerification}
            />
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
