"use client";

import { useEffect } from "react";
import { useLocale } from "./LocaleProvider";

interface WelcomeModalProps {
  open: boolean;
  onEnter: () => void;
}

const sectionTitleClass =
  "mb-5 font-mono text-[13px] uppercase tracking-[0.24em] text-text-muted";

const sectionBodyClass =
  "space-y-4 text-[15px] leading-relaxed text-text-muted";

/**
 * On-load welcome — same pattern as 500pixels-arts.
 * Shown after the brand preloader; dismiss with enter CTA.
 */
export function WelcomeModal({ open, onEnter }: WelcomeModalProps) {
  const { messages: m } = useLocale();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        onEnter();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onEnter]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/45 px-4 pb-16 pt-8 backdrop-blur-[2px] sm:px-6 sm:pb-20 sm:pt-10"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="relative flex max-h-[min(92vh,100dvh)] w-full max-w-5xl animate-fade-up flex-col overflow-hidden border border-border bg-bg shadow-[0_24px_80px_rgba(21,23,19,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto px-7 pb-8 pt-9 sm:px-10 sm:pt-11">
          <div className="grid gap-10 md:grid-cols-2 md:gap-0">
            <section className="md:border-r md:border-border md:pr-10">
              <h2 id="welcome-title" className={sectionTitleClass}>
                {m.welcome.whatTitle}
              </h2>
              <div className={sectionBodyClass}>
                <p>{m.welcome.whatP1}</p>
                <p>{m.welcome.whatP2}</p>
              </div>
            </section>

            <section className="md:pl-10">
              <h2 className={sectionTitleClass}>{m.welcome.whoTitle}</h2>
              <div className={sectionBodyClass}>
                <p>{m.welcome.whoP1}</p>
                <p>{m.welcome.whoP2}</p>
                <div className="space-y-1 border-t border-border pt-4 font-mono text-[13px] tracking-[0.08em] text-text-muted">
                  <p>{m.welcome.badgeUnofficial}</p>
                  <p>{m.welcome.badgePublic}</p>
                  <p>{m.welcome.badgeNoConnect}</p>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="border-t border-border px-7 py-5 sm:px-10 sm:py-6">
          <button
            type="button"
            onClick={onEnter}
            className="w-full border border-ink bg-ink py-4 font-mono text-[13px] uppercase tracking-[0.28em] text-bg transition hover:border-accent hover:bg-accent"
          >
            {m.welcome.cta}
          </button>
        </div>
      </div>
    </div>
  );
}
