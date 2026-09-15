"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

const SHOW_AFTER_PX = 420;

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sync = () => {
      setVisible(window.scrollY > SHOW_AFTER_PX);
    };
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, []);

  function goTop() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <button
      type="button"
      onClick={goTop}
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      className={`fixed bottom-5 right-5 z-40 flex items-center gap-2 border border-ink bg-bg/95 px-3 py-2.5 text-ink shadow-[0_8px_24px_rgba(37,41,35,0.08)] backdrop-blur-sm transition-[opacity,transform,background-color,border-color,color] duration-300 hover:border-accent hover:bg-ink hover:text-bg focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent sm:bottom-7 sm:right-7 sm:px-3.5 ${
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <ArrowUp size={15} strokeWidth={2.25} aria-hidden />
      <span className="font-mono text-[12px] tracking-[0.18em]">TOP</span>
    </button>
  );
}
