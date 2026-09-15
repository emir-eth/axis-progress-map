"use client";

import { XLogo } from "@/components/ui/XLogo";
import { useLocale } from "./LocaleProvider";

export function SiteFooter() {
  const { messages: m } = useLocale();

  return (
    <footer className="mt-auto border-t border-border">
      <div className="content-shell flex flex-col items-center gap-3 px-5 py-8 text-center sm:px-8 sm:py-10">
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-[13px] tracking-[0.12em] text-ink sm:text-[14px]">
          <span>{m.footer.createdBy}</span>
          <a
            href="https://x.com/emir_ethh"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-text-muted transition-colors duration-200 hover:text-ink"
            aria-label={m.footer.emirOnX}
          >
            <XLogo className="h-3.5 w-3.5" />
            <span>@emir_ethh</span>
          </a>
        </p>
        <p className="max-w-md text-[13px] leading-relaxed text-text-muted sm:text-[14px]">
          {m.footer.disclaimer}
        </p>
      </div>
    </footer>
  );
}
