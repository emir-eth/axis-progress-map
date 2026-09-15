"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useLocale } from "./LocaleProvider";

interface MethodologyModalProps {
  open: boolean;
  onClose: () => void;
}

export function MethodologyModal({ open, onClose }: MethodologyModalProps) {
  const { messages: m } = useLocale();
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

  const sections = [
    {
      title: m.methodology.trajectoriesTitle,
      body: m.methodology.trajectoriesBody,
    },
    { title: m.methodology.signedTitle, body: m.methodology.signedBody },
    { title: m.methodology.uniqueTitle, body: m.methodology.uniqueBody },
    { title: m.methodology.averageTitle, body: m.methodology.averageBody },
    { title: m.methodology.skillsTitle, body: m.methodology.skillsBody },
  ];

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
        aria-label={m.methodology.close}
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[min(85vh,100dvh)] w-full max-w-xl overflow-y-auto border border-border bg-bg p-6 scrollbar-thin sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="eng-label">{m.methodology.modalEyebrow}</p>
            <h2 id={titleId} className="mt-2 font-display text-2xl text-ink">
              {m.methodology.modalTitle}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="border border-border p-2 text-text-muted transition hover:border-border-strong hover:text-text"
            aria-label={m.methodology.close}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 text-sm leading-relaxed text-text-muted">
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="mb-1 font-display text-base text-ink">
                {section.title}
              </h3>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
