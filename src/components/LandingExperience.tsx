"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteNav } from "./SiteNav";
import { SiteFooter } from "./SiteFooter";
import { WalletEntryForm } from "./WalletEntryForm";
import { MapTransition, usePrefersReducedMotion } from "./MapTransition";
import { BrandPreloader } from "./intro/BrandPreloader";
import { ASSETS } from "@/lib/assets";

const TRANSITION_MS = 1600;

type BootPhase = "preloader" | "welcome" | "ready";

export function LandingExperience() {
  const router = useRouter();
  const reduced = usePrefersReducedMotion();
  const [boot, setBoot] = useState<BootPhase>("preloader");
  const [phase, setPhase] = useState<"idle" | "transition">("idle");
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);

  const goToProfile = useCallback(
    (address: string) => {
      try {
        sessionStorage.setItem("axis-map-reveal", address.toLowerCase());
      } catch {
        /* ignore */
      }
      router.push(`/profile/${address}`);
    },
    [router],
  );

  const onValidSubmit = useCallback(
    (address: string) => {
      if (reduced) {
        goToProfile(address);
        return;
      }
      setPendingAddress(address);
      setPhase("transition");
      router.prefetch(`/profile/${address}`);
    },
    [goToProfile, reduced, router],
  );

  useEffect(() => {
    if (phase !== "transition" || !pendingAddress) return;
    const id = window.setTimeout(() => {
      goToProfile(pendingAddress);
    }, TRANSITION_MS);
    return () => window.clearTimeout(id);
  }, [phase, pendingAddress, goToProfile]);

  if (boot === "preloader") {
    return (
      <BrandPreloader onComplete={() => setBoot("welcome")} />
    );
  }

  if (phase === "transition" && pendingAddress) {
    return (
      <div className="flex min-h-screen flex-col bg-bg">
        <SiteNav />
        <main className="flex flex-1 flex-col">
          <MapTransition address={pendingAddress} variant="full" />
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteNav
        welcomeOpen={boot === "welcome"}
        onWelcomeEnter={() => setBoot("ready")}
      />

      <main className="flex flex-1 flex-col">
        <section className="content-shell relative flex flex-1 flex-col justify-center px-5 py-12 sm:px-8 lg:py-16">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.52fr)_minmax(0,0.48fr)] lg:gap-10 xl:gap-14">
            <div className="animate-fade-up relative z-10 order-1">
              <p className="eng-label text-accent">Unofficial Axis tool</p>

              <h1 className="mt-5 font-display text-[clamp(2.5rem,5.5vw,4.35rem)] font-semibold leading-[0.95] tracking-[-0.04em] text-ink">
                <span className="block">See what</span>
                <span className="block">your Axis work</span>
                <span className="block">actually maps to.</span>
              </h1>

              <p className="mt-6 max-w-md text-[15px] leading-relaxed text-text-muted sm:text-base">
                Paste a public wallet. I read your Hub history and show skills,
                environments, scores, and a shareable card.
              </p>

              <div className="mt-9">
                <WalletEntryForm
                  onValidSubmit={onValidSubmit}
                  autoFocus={boot === "ready"}
                />
              </div>
            </div>

            <div
              className="relative order-2 animate-fade-up"
              style={{ animationDelay: "70ms" }}
            >
              <div className="relative mx-auto w-full max-w-[520px] lg:max-w-none">
                <div
                  className="pointer-events-none absolute inset-0"
                  aria-hidden
                >
                  <div className="absolute left-[6%] top-[10%] h-px w-[28%] bg-border-strong/80" />
                  <div className="absolute left-[6%] top-[10%] h-3 w-px bg-border-strong/80" />
                  <p className="absolute left-[7%] top-[4%] eng-label text-[11px]">
                    Your wallet
                  </p>
                  <div className="absolute bottom-[18%] right-[8%] h-16 w-16 rounded-full border border-border" />
                  <div className="absolute bottom-[22%] right-[12%] h-2 w-2 -translate-x-1/2 -translate-y-1/2">
                    <div className="absolute left-0 top-1/2 h-px w-2 bg-text-dim" />
                    <div className="absolute left-1/2 top-0 h-2 w-px bg-text-dim" />
                  </div>
                  <p className="absolute bottom-[8%] right-[6%] eng-label text-[11px]">
                    Skills
                  </p>
                  <p className="absolute left-[8%] bottom-[12%] eng-label text-[11px]">
                    Public only
                  </p>
                </div>

                <Image
                  src={ASSETS.robotHero}
                  alt="Robot arm illustration"
                  width={1200}
                  height={1200}
                  priority
                  className="relative z-[1] h-auto w-full object-contain"
                />
              </div>
            </div>
          </div>
        </section>

        <section id="about" className="border-t border-border bg-bg-elevated/60">
          <div className="content-shell px-5 py-12 sm:px-8 sm:py-14">
            <div className="grid gap-8 sm:grid-cols-3 sm:gap-10">
              {[
                {
                  n: "01",
                  title: "Pull",
                  body: "Your public Hub attempts",
                },
                {
                  n: "02",
                  title: "Match",
                  body: "Tasks to Axis skill data",
                },
                {
                  n: "03",
                  title: "Show",
                  body: "A clear breakdown + card",
                },
              ].map((step) => (
                <div key={step.n} className="min-w-0">
                  <p className="font-mono text-[11px] tracking-[0.2em] text-accent">
                    {step.n}
                  </p>
                  <h2 className="mt-2 font-display text-lg tracking-[0.04em] text-ink">
                    {step.title.toUpperCase()}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-text-muted">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
