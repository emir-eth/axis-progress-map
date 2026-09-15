"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface MethodologyModalProps {
  open: boolean;
  onClose: () => void;
}

export function MethodologyModal({ open, onClose }: MethodologyModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink/35"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[min(85vh,100dvh)] w-full max-w-xl overflow-y-auto border border-border bg-bg p-6 scrollbar-thin sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="eng-label">Numbers</p>
            <h2 id={titleId} className="mt-2 font-display text-2xl text-ink">
              Where each stat comes from
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="border border-border p-2 text-text-muted transition hover:border-border-strong hover:text-text"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 text-sm leading-relaxed text-text-muted">
          <section>
            <h3 className="mb-1 font-display text-base text-ink">
              Trajectories
            </h3>
            <p>
              Public Hub attempt total for the wallet. Logged-in Hub can show a
              slightly different number — I stick to the public one.
            </p>
          </section>

          <section>
            <h3 className="mb-1 font-display text-base text-ink">
              Signed &amp; unsigned
            </h3>
            <p>
              Signed = Hub has a tx hash. Unsigned = it doesn’t. That’s it — no
              extra chain scan for this split.
            </p>
          </section>

          <section>
            <h3 className="mb-1 font-display text-base text-ink">Unique tasks</h3>
            <p>How many different task IDs show up in the loaded attempts.</p>
          </section>

          <section>
            <h3 className="mb-1 font-display text-base text-ink">Average score</h3>
            <p>
              Average of real Hub scores only. Blank scores don’t count as zero.
            </p>
          </section>

          <section>
            <h3 className="mb-1 font-display text-base text-ink">
              Skills &amp; environments
            </h3>
            <p>
              I match Hub task IDs to public Axis task data when I can. No match
              → no invented skills.
            </p>
          </section>

          <section>
            <h3 className="mb-1 font-display text-base text-ink">
              Base verification
            </h3>
            <p>
              Optional on-chain check if I already have it. Hub totals still
              lead; this never blocks the page.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
