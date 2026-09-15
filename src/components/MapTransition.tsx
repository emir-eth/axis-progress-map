"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { shortenAddress } from "@/lib/format";
import { ASSETS } from "@/lib/assets";

interface MapTransitionProps {
  address: string;
  waiting?: boolean;
  variant?: "full" | "hold";
  /** Called once the short visual transition has finished (~1.2s). */
  onSettled?: () => void;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Laboratory-report assembly transition — short visual bridge only. */
export function MapTransition({
  address,
  waiting = false,
  variant = "full",
  onSettled,
}: MapTransitionProps) {
  const reduced = usePrefersReducedMotion();
  const short = useMemo(() => shortenAddress(address, 4), [address]);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduced) {
      setStep(4);
      onSettled?.();
      return;
    }
    const timers = [
      window.setTimeout(() => setStep(1), 160),
      window.setTimeout(() => setStep(2), 420),
      window.setTimeout(() => setStep(3), 720),
      window.setTimeout(() => setStep(4), 1000),
      window.setTimeout(() => onSettled?.(), 1200),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduced, address, onSettled]);

  return (
    <div
      className={`relative flex flex-col items-center justify-center overflow-hidden bg-bg ${
        variant === "full"
          ? "min-h-[42vh] px-5 py-10 sm:px-8"
          : "min-h-[36vh] px-5 py-10 sm:px-8"
      }`}
      role="status"
      aria-live="polite"
      aria-label="Loading your Axis activity map"
    >
      <div className="relative z-10 w-full max-w-xl">
        <div className="text-center">
          <p className="eng-label">Wallet</p>
          <p className="mt-2 font-mono text-lg text-ink sm:text-xl">{short}</p>
        </div>

        <div
          className={`mx-auto mt-6 h-px w-full max-w-md bg-accent origin-center ${
            step >= 1 || reduced ? "animate-rule-grow" : "scale-x-0"
          }`}
          aria-hidden
        />

        <div
          className={`mt-6 flex justify-center gap-8 font-mono text-[13px] tracking-[0.2em] text-text-muted transition-opacity duration-500 sm:gap-12 ${
            step >= 2 || reduced ? "opacity-100" : "opacity-0"
          }`}
        >
          <span>PULL</span>
          <span>MATCH</span>
          <span>SHOW</span>
        </div>

        <div
          className={`relative mx-auto mt-8 w-full max-w-[200px] transition-opacity duration-500 sm:max-w-[220px] ${
            step >= 3 || reduced ? "opacity-40" : "opacity-0"
          }`}
          aria-hidden
        >
          <Image
            src={ASSETS.robotProfile}
            alt=""
            width={800}
            height={800}
            className="h-auto w-full object-contain"
            priority
          />
        </div>

        <div
          className={`mt-6 text-center transition-all duration-400 ${
            step >= 4 || reduced
              ? "translate-y-0 opacity-100"
              : "translate-y-2 opacity-0"
          }`}
        >
          <h1 className="font-display text-[clamp(1.5rem,3.5vw,2rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">
            <span className="block">Your Axis</span>
            <span className="block">activity map</span>
          </h1>
          {waiting && (
            <p className="mt-3 text-sm text-text-muted">Loading Hub data…</p>
          )}
        </div>
      </div>
    </div>
  );
}

export { usePrefersReducedMotion };
