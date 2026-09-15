"use client";

import { useLocale } from "./LocaleProvider";
import type { Locale } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale, messages } = useLocale();

  const Option = ({ code }: { code: Locale }) => {
    const active = locale === code;
    const label = code === "en" ? messages.nav.en : messages.nav.tr;
    return (
      <button
        type="button"
        onClick={() => setLocale(code)}
        aria-pressed={active}
        className={`px-1.5 py-0.5 transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          active
            ? "text-ink"
            : "text-text-dim hover:text-text-muted"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      className="inline-flex items-center gap-0.5 font-mono text-[13px] tracking-[0.14em]"
      role="group"
      aria-label={messages.nav.languageAria}
    >
      <Option code="en" />
      <span className="text-border-strong" aria-hidden>
        /
      </span>
      <Option code="tr" />
    </div>
  );
}
