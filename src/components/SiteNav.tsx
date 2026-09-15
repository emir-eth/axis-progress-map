"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { MethodologyModal } from "./MethodologyModal";
import { WelcomeModal } from "./WelcomeModal";
import { AxisBrandMark } from "./intro/AxisBrandMark";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useLocale } from "./LocaleProvider";

interface SiteNavProps {
  /** Landing boot: open the welcome popup after preloader */
  welcomeOpen?: boolean;
  onWelcomeEnter?: () => void;
  /** Show NEW WALLET when on a profile (optional link handled by parent). */
  showNewWallet?: boolean;
}

export function SiteNav({
  welcomeOpen = false,
  onWelcomeEnter,
}: SiteNavProps) {
  const { messages: m } = useLocale();
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (welcomeOpen) setAboutOpen(true);
  }, [welcomeOpen]);

  function closeWelcome() {
    setAboutOpen(false);
    onWelcomeEnter?.();
  }

  return (
    <>
      <header className="border-b border-border">
        <div className="content-shell flex items-center justify-between gap-3 px-5 py-3.5 sm:gap-4 sm:px-8">
          <Link
            href="/"
            className="group min-w-0 cursor-pointer transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-accent"
            aria-label={m.brand.homeAria}
          >
            <AxisBrandMark variant="nav" />
          </Link>
          <nav
            className="flex shrink-0 items-center gap-2.5 font-mono text-[12px] tracking-[0.12em] text-text-muted sm:gap-3 sm:text-[13px] sm:tracking-[0.14em]"
            aria-label={m.nav.primaryAria}
          >
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="inline-flex cursor-pointer items-center gap-1.5 transition hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              <span>{m.nav.about}</span>
              <ExternalLink
                size={12}
                strokeWidth={1.75}
                className="shrink-0 opacity-70"
                aria-hidden
              />
            </button>
            <span className="select-none text-border-strong" aria-hidden>
              |
            </span>
            <button
              type="button"
              onClick={() => setMethodologyOpen(true)}
              className="inline-flex max-w-[9.5rem] cursor-pointer items-center gap-1.5 truncate transition hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-accent sm:max-w-none"
            >
              <span className="truncate">{m.nav.how}</span>
              <ExternalLink
                size={12}
                strokeWidth={1.75}
                className="shrink-0 opacity-70"
                aria-hidden
              />
            </button>
            <span className="select-none text-border-strong" aria-hidden>
              |
            </span>
            <LanguageSwitcher />
          </nav>
        </div>
      </header>
      <WelcomeModal open={aboutOpen} onEnter={closeWelcome} />
      <MethodologyModal
        open={methodologyOpen}
        onClose={() => setMethodologyOpen(false)}
      />
    </>
  );
}
