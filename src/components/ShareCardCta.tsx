"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Download, Pencil, Share2, X } from "lucide-react";
import { toPng } from "html-to-image";
import type {
  HubTxhashStats,
  IndexStatus,
  ProfileAnalytics,
} from "@/types";
import { shortenAddress } from "@/lib/format";
import type { Messages } from "@/lib/i18n";
import {
  deriveShareFields,
  ShareCard,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  type ShareCardIdentity,
} from "./ShareCard";
import { useLocale } from "./LocaleProvider";

const LS_HUB = "axis-share-hub-username";
const LS_X = "axis-share-x-username";
const HUB_MAX = 32;
const X_MAX = 32;

type GeneratorStep = "details" | "generating" | "ready";

interface ShareCardCtaProps {
  address: string;
  analytics: ProfileAnalytics;
  indexStatus: IndexStatus;
  hubTxhash?: HubTxhashStats | null;
}

function isShareAllowed(status: IndexStatus): boolean {
  if (status.scanStatus === "incomplete") return false;
  if (status.dataSource === "scan-incomplete") return false;
  if (status.dataSource === "hub-incomplete") return false;
  return true;
}

/** Normalize Axis Hub username — plain handle, no verification. */
export function normalizeHubUsername(raw: string): string | undefined {
  let s = raw.trim();
  if (!s) return undefined;
  s = s.replace(/^@+/, "");
  s = s.replace(/^https?:\/\/(www\.)?hub\.axisrobotics\.ai\/?/i, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, HUB_MAX);
  return s || undefined;
}

/**
 * Normalize X username to @handle.
 * Accepts handle, @handle, or x.com / twitter.com URLs.
 */
export function normalizeXUsername(raw: string): string | undefined {
  let s = raw.trim();
  if (!s) return undefined;

  const urlMatch = s.match(
    /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})/i,
  );
  if (urlMatch?.[1]) {
    return `@${urlMatch[1]}`;
  }

  s = s.replace(/^@+/, "");
  s = s.replace(/[^A-Za-z0-9_]/g, "").slice(0, 15);
  if (!s) return undefined;
  return `@${s.slice(0, X_MAX - 1)}`;
}

function buildXIntentUrl(opts: {
  contributionCount: number;
  uniqueTasks: number;
  primarySkill?: string;
  profileUrl: string;
  m: Messages;
}): string {
  const { m } = opts;
  const lines = [
    m.share.tweetLine1,
    "",
    m.share.tweetTrajectories(opts.contributionCount),
    m.share.tweetUniqueTasks(opts.uniqueTasks),
  ];
  if (opts.primarySkill) {
    lines.push(m.share.tweetTopSkill(opts.primarySkill));
  }
  lines.push("", m.share.tweetCard, "", opts.profileUrl);

  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    lines.join("\n"),
  )}`;
}

async function waitForFontsAndImages(node: HTMLElement): Promise<void> {
  if (typeof document !== "undefined" && "fonts" in document) {
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  }
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        }),
    ),
  );
}

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStored(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function ShareCardCta({
  address,
  analytics,
  indexStatus,
  hubTxhash = null,
}: ShareCardCtaProps) {
  const { messages: m } = useLocale();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<GeneratorStep>("details");
  const [hubInput, setHubInput] = useState("");
  const [xInput, setXInput] = useState("");
  const [identity, setIdentity] = useState<ShareCardIdentity>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [cardScale, setCardScale] = useState(0.5);
  const [portalReady, setPortalReady] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const resultFrameRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const scrollLockRef = useRef<{
    scrollY: number;
    bodyOverflow: string;
    bodyPaddingRight: string;
    htmlOverflow: string;
  } | null>(null);
  const genTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();

  const canShare = isShareAllowed(indexStatus);
  const fields = deriveShareFields(analytics, { hubTxhash });

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    return () => {
      if (genTimer.current) clearTimeout(genTimer.current);
    };
  }, []);

  const closeGenerator = useCallback(() => {
    if (genTimer.current) clearTimeout(genTimer.current);
    setOpen(false);
    setStep("details");
    setExportError(null);
    requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  // Viewport body scroll lock while modal is open — preserve scrollY.
  useEffect(() => {
    if (!open || !canShare) return;

    const scrollY = window.scrollY;
    const body = document.body;
    const html = document.documentElement;
    const scrollbarGap = window.innerWidth - html.clientWidth;

    scrollLockRef.current = {
      scrollY,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
      htmlOverflow: html.style.overflow,
    };

    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    if (scrollbarGap > 0) {
      body.style.paddingRight = `${scrollbarGap}px`;
    }

    return () => {
      const saved = scrollLockRef.current;
      scrollLockRef.current = null;
      if (!saved) return;
      body.style.overflow = saved.bodyOverflow;
      body.style.paddingRight = saved.bodyPaddingRight;
      html.style.overflow = saved.htmlOverflow;
      window.scrollTo(0, saved.scrollY);
    };
  }, [open, canShare]);

  useEffect(() => {
    if (!open || !canShare) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeGenerator();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, canShare, closeGenerator]);

  useEffect(() => {
    if (!open || !canShare) return;
    const id = requestAnimationFrame(() => {
      if (step === "details") firstFieldRef.current?.focus();
      else closeBtnRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, canShare, step]);

  useEffect(() => {
    if (!open || step !== "ready") return;
    const frame = resultFrameRef.current;
    if (!frame) return;

    const update = () => {
      const w = frame.clientWidth;
      const next = Math.min(1, Math.max(0.22, (w - 8) / SHARE_CARD_WIDTH));
      setCardScale(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [open, step]);

  const openGenerator = () => {
    setExportError(null);
    setStep("details");
    setHubInput(readStored(LS_HUB));
    setXInput(readStored(LS_X));
    setOpen(true);
  };

  const generateCard = () => {
    const hubUsername = normalizeHubUsername(hubInput);
    const xUsername = normalizeXUsername(xInput);
    const next: ShareCardIdentity = { hubUsername, xUsername };
    setIdentity(next);
    writeStored(LS_HUB, hubInput.trim());
    writeStored(LS_X, xInput.trim());
    setExportError(null);
    setStep("generating");
    if (genTimer.current) clearTimeout(genTimer.current);
    genTimer.current = setTimeout(() => setStep("ready"), 420);
  };

  const downloadPng = useCallback(async () => {
    const node = cardRef.current;
    if (!node || !canShare) return;
    setExporting(true);
    setExportError(null);
    try {
      await waitForFontsAndImages(node);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const dataUrl = await toPng(node, {
        width: SHARE_CARD_WIDTH,
        height: SHARE_CARD_HEIGHT,
        pixelRatio: 1,
        cacheBust: true,
        style: {
          transform: "none",
          transformOrigin: "top left",
          width: `${SHARE_CARD_WIDTH}px`,
          height: `${SHARE_CARD_HEIGHT}px`,
        },
      });

      const short = shortenAddress(address, 4).replace("…", "-");
      const link = document.createElement("a");
      link.download = `axis-progress-map-${short}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : m.share.exportError,
      );
    } finally {
      setExporting(false);
    }
  }, [address, canShare, m.share.exportError]);

  const shareOnX = useCallback(() => {
    if (!canShare || typeof window === "undefined") return;
    const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(
      /\/$/,
      "",
    );
    const origin =
      configured &&
      !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured)
        ? configured
        : window.location.origin;
    const profileUrl = `${origin}/profile/${address}`;
    const url = buildXIntentUrl({
      contributionCount: fields.contributionCount,
      uniqueTasks: fields.uniqueTasks,
      primarySkill: fields.topSkill,
      profileUrl,
      m,
    });
    window.open(url, "_blank", "noopener,noreferrer");
  }, [
    address,
    canShare,
    fields.contributionCount,
    fields.uniqueTasks,
    fields.topSkill,
    m,
  ]);

  const modal =
    open && canShare && portalReady
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <button
              type="button"
              className="absolute inset-0 bg-ink/40"
              aria-label={m.share.dialogAria}
              onClick={closeGenerator}
            />
            <div
              className="relative z-10 flex max-h-[100dvh] w-full max-w-[min(96vw,720px)] flex-col overflow-y-auto border border-border bg-bg sm:max-h-[min(92vh,100dvh)]"
              style={{ maxHeight: "calc(100dvh - 1.5rem)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5">
                <p id={titleId} className="eng-label">
                  {step === "ready"
                    ? m.share.titleReady
                    : step === "generating"
                      ? m.share.titleGenerating
                      : m.share.titleDetails}
                </p>
                <button
                  ref={closeBtnRef}
                  type="button"
                  onClick={closeGenerator}
                  className="text-text-dim transition hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  aria-label={m.share.close}
                >
                  <X size={16} />
                </button>
              </div>

              {step === "details" && (
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5 sm:py-6">
                  <p className="max-w-md text-[14px] leading-relaxed text-text-muted">
                    {m.share.detailsHint}
                  </p>

                  <div className="mt-6 space-y-5">
                    <label className="block">
                      <span className="eng-label">{m.share.hubLabel}</span>
                      <input
                        ref={firstFieldRef}
                        type="text"
                        value={hubInput}
                        onChange={(e) =>
                          setHubInput(e.target.value.slice(0, HUB_MAX))
                        }
                        placeholder={m.share.hubPlaceholder}
                        autoComplete="off"
                        spellCheck={false}
                        className="mt-2 w-full border border-border bg-bg-elevated px-3 py-2.5 font-mono text-sm text-ink outline-none transition placeholder:text-text-dim focus:border-ink"
                      />
                    </label>

                    <label className="block">
                      <span className="eng-label">{m.share.xLabel}</span>
                      <input
                        type="text"
                        value={xInput}
                        onChange={(e) => setXInput(e.target.value.slice(0, 64))}
                        placeholder={m.share.xPlaceholder}
                        autoComplete="off"
                        spellCheck={false}
                        className="mt-2 w-full border border-border bg-bg-elevated px-3 py-2.5 font-mono text-sm text-ink outline-none transition placeholder:text-text-dim focus:border-ink"
                      />
                      <span className="mt-1.5 block text-[13px] text-text-dim">
                        {m.share.xHint}
                      </span>
                    </label>

                    <div>
                      <p className="eng-label">{m.share.wallet}</p>
                      <p className="mt-2 font-mono text-sm text-text-muted">
                        {shortenAddress(address, 6)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={generateCard}
                    className="mt-8 inline-flex w-full items-center justify-center gap-2 border border-ink bg-ink px-5 py-3 font-mono text-[13px] tracking-[0.14em] text-bg transition hover:bg-accent hover:border-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
                  >
                    {m.share.generate}
                    <ArrowRight size={14} strokeWidth={1.75} />
                  </button>
                  <p className="mt-3 text-[13px] text-text-muted">
                    {m.share.namesOptional}
                  </p>
                </div>
              )}

              {step === "generating" && (
                <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
                  <p className="eng-label text-accent">{m.share.making}</p>
                  <p className="mt-3 text-[13px] text-text-muted">
                    {m.share.oneSec}
                  </p>
                </div>
              )}

              {step === "ready" && (
                <>
                  <div
                    ref={resultFrameRef}
                    className="min-h-0 flex-1 overflow-y-auto bg-bg-soft/50 p-3 sm:p-5"
                  >
                    <p className="mb-3 eng-label text-accent sm:mb-4">
                      {m.share.titleReady}
                    </p>
                    <div
                      style={{
                        width: SHARE_CARD_WIDTH * cardScale,
                        height: SHARE_CARD_HEIGHT * cardScale,
                        margin: "0 auto",
                        position: "relative",
                        maxWidth: "100%",
                      }}
                    >
                      <div
                        style={{
                          transform: `scale(${cardScale})`,
                          transformOrigin: "top left",
                          width: SHARE_CARD_WIDTH,
                          height: SHARE_CARD_HEIGHT,
                        }}
                      >
                        <ShareCard
                          cardRef={cardRef}
                          address={address}
                          analytics={analytics}
                          identity={identity}
                          hubTxhash={hubTxhash}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 space-y-3 border-t border-border px-4 py-4 sm:px-5">
                    {exportError && (
                      <p className="text-[13px] text-danger">{exportError}</p>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                      <button
                        type="button"
                        onClick={downloadPng}
                        disabled={exporting}
                        className="inline-flex w-full items-center justify-center gap-2 border border-ink bg-ink px-4 py-2.5 font-mono text-[13px] tracking-[0.14em] text-bg transition hover:bg-accent hover:border-accent disabled:opacity-60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
                      >
                        <Download size={14} strokeWidth={1.75} />
                        {exporting ? m.share.exporting : m.share.download}
                      </button>
                      <button
                        type="button"
                        onClick={shareOnX}
                        className="inline-flex w-full items-center justify-center gap-2 border border-ink px-4 py-2.5 font-mono text-[13px] tracking-[0.14em] text-ink transition hover:bg-ink hover:text-bg focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
                      >
                        <Share2 size={14} strokeWidth={1.75} />
                        {m.share.shareOnX}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStep("details");
                          setExportError(null);
                        }}
                        className="inline-flex w-full items-center justify-center gap-2 border border-border px-4 py-2.5 font-mono text-[13px] tracking-[0.14em] text-text-muted transition hover:border-ink hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
                      >
                        <Pencil size={14} strokeWidth={1.75} />
                        {m.share.editDetails}
                      </button>
                    </div>
                    <p className="text-[13px] leading-relaxed text-text-dim">
                      {m.share.attachNote}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="border-y border-border py-12 sm:py-14">
        <p className="eng-label text-accent">{m.share.eyebrow}</p>
        <h2 className="mt-3 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">
          {m.share.title}
        </h2>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-text-muted">
          {m.share.sub}
        </p>

        {canShare ? (
          <>
            <button
              ref={triggerRef}
              type="button"
              onClick={openGenerator}
              className="mt-8 inline-flex items-center gap-2 border border-ink px-5 py-3 font-mono text-[13px] tracking-[0.14em] text-ink transition hover:bg-ink hover:text-bg focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {m.share.generate}
              <ArrowRight size={14} strokeWidth={1.75} />
            </button>
            <p className="mt-3 text-[13px] text-text-muted">
              {m.share.generateHint}
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled
              className="mt-8 inline-flex cursor-not-allowed items-center gap-2 border border-border px-5 py-3 font-mono text-[13px] tracking-[0.14em] text-text-dim opacity-70"
            >
              {m.share.generate}
              <ArrowRight size={14} strokeWidth={1.75} />
            </button>
            <p className="mt-3 max-w-md text-[13px] leading-relaxed text-text-muted">
              {m.share.lockedHint}
            </p>
          </>
        )}
      </div>

      {modal}
    </>
  );
}
