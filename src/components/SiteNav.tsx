"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MethodologyModal } from "./MethodologyModal";
import { WelcomeModal } from "./WelcomeModal";
import { AxisBrandMark } from "./intro/AxisBrandMark";

interface SiteNavProps {
  /** Landing boot: open the welcome popup after preloader */
  welcomeOpen?: boolean;
  onWelcomeEnter?: () => void;
}

export function SiteNav({
  welcomeOpen = false,
  onWelcomeEnter,
}: SiteNavProps) {
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
        <div className="content-shell flex items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <Link
            href="/"
            className="group min-w-0 transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-accent"
            aria-label="Axis Progress Map home"
          >
            <AxisBrandMark variant="nav" />
          </Link>
          <nav
            className="flex shrink-0 items-center gap-5 font-mono text-[13px] tracking-[0.14em] text-text-muted sm:gap-8"
            aria-label="Primary"
          >
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="transition hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              ABOUT
            </button>
            <button
              type="button"
              onClick={() => setMethodologyOpen(true)}
              className="transition hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              HOW
            </button>
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
