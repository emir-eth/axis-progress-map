"use client";

import { useState } from "react";
import type { ThemeStat } from "@/types";

interface EnvironmentsProps {
  themes: ThemeStat[];
  mappedContributions?: number;
}

function titleCase(theme: string): string {
  if (!theme) return theme;
  return theme.charAt(0).toUpperCase() + theme.slice(1).toLowerCase();
}

export function Environments({
  themes,
  mappedContributions,
}: EnvironmentsProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  if (themes.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        No environment breakdown yet — need Axis task matches first.
      </p>
    );
  }

  const max = Math.max(...themes.map((t) => t.count), 1);
  const total =
    mappedContributions ?? themes.reduce((sum, t) => sum + t.count, 0);

  return (
    <div>
      <p className="mb-5 eng-label">
        {total.toLocaleString()} matched contributions
      </p>
      <ul className="divide-y divide-border border-y border-border">
        {themes.map((theme, i) => {
          const emphasize = i < 2 || hovered === theme.theme;
          return (
            <li
              key={theme.theme}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3.5 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:gap-6"
              onMouseEnter={() => setHovered(theme.theme)}
              onMouseLeave={() => setHovered(null)}
            >
              <span
                className={`font-display text-[15px] ${
                  emphasize ? "text-ink" : "text-text-muted"
                }`}
              >
                {titleCase(theme.theme)}
              </span>
              <div className="col-span-2 hidden sm:col-span-1 sm:block">
                <div
                  className={`measure-bar w-full ${emphasize ? "is-active" : ""}`}
                >
                  <span
                    style={{ width: `${(theme.count / max) * 100}%` }}
                  />
                </div>
              </div>
              <div className="text-right font-mono text-[13px] tabular-nums text-text-muted">
                <span className={emphasize ? "text-ink" : ""}>{theme.count}</span>
                <span className="mx-1.5 text-text-dim">·</span>
                <span>{theme.percentage.toFixed(1)}%</span>
              </div>
              <div className="col-span-2 sm:hidden">
                <div
                  className={`measure-bar w-full ${emphasize ? "is-active" : ""}`}
                >
                  <span
                    style={{ width: `${(theme.count / max) * 100}%` }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
