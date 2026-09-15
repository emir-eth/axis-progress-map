"use client";

import { useCallback, useEffect, useState } from "react";
import { AxisBrandMark } from "./AxisBrandMark";
import { useLocaleOptional } from "../LocaleProvider";
import "./preloader.css";

interface BrandPreloaderProps {
  onComplete: () => void;
}

const PRELOADER_MS = 2500;
const REDUCED_MS = 120;
const EXIT_MS = 450;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function BrandPreloader({ onComplete }: BrandPreloaderProps) {
  const { messages: m } = useLocaleOptional();
  const [exiting, setExiting] = useState(false);

  const finish = useCallback(() => {
    if (exiting) return;
    const reduced = prefersReducedMotion();
    setExiting(true);
    window.setTimeout(onComplete, reduced ? 80 : EXIT_MS);
  }, [exiting, onComplete]);

  useEffect(() => {
    const reduced = prefersReducedMotion();
    const timer = window.setTimeout(finish, reduced ? REDUCED_MS : PRELOADER_MS);
    return () => window.clearTimeout(timer);
  }, [finish]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "Escape"
      ) {
        event.preventDefault();
        finish();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finish]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={m.nav.skipPreloader}
      onClick={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          finish();
        }
      }}
      className={`axis-preloader${exiting ? " is-exiting" : ""}`}
    >
      <div
        aria-hidden
        className="axis-preloader-grid pointer-events-none absolute inset-0 opacity-30"
      />
      <div aria-hidden className="axis-preloader-noise absolute inset-0" />
      <div aria-hidden className="axis-preloader-vignette absolute inset-0" />

      <div className="axis-preloader__mark">
        <AxisBrandMark />
      </div>

      <p className="axis-preloader__hint">{m.nav.tapContinue}</p>
    </div>
  );
}
