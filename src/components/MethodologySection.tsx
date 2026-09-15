"use client";

import { useLocale } from "./LocaleProvider";

export function MethodologySection() {
  const { messages: m } = useLocale();

  return (
    <div>
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 sm:gap-10">
        {[
          {
            title: m.methodology.sectionPull,
            body: m.methodology.sectionPullBody,
          },
          {
            title: m.methodology.sectionMatch,
            body: m.methodology.sectionMatchBody,
          },
          {
            title: m.methodology.sectionSplit,
            body: m.methodology.sectionSplitBody,
          },
        ].map((step) => (
          <div key={step.title}>
            <p className="font-display text-sm tracking-[0.12em] text-ink">
              {step.title.toUpperCase()}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              {step.body}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-8 eng-label text-text-muted">
        {m.methodology.footerLabel}
      </p>
      <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-text-muted">
        {m.methodology.footerNote}
      </p>
    </div>
  );
}
