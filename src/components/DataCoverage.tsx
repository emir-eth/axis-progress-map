"use client";

import type { MetadataCoverage } from "@/types";
import { formatPercent } from "@/lib/format";
import { useLocale } from "./LocaleProvider";

interface DataCoverageProps {
  coverage: MetadataCoverage;
}

export function DataCoverage({ coverage }: DataCoverageProps) {
  const { messages: m } = useLocale();
  const pct = Math.min(100, Math.max(0, coverage.coveragePercent));
  const unmatched = Math.max(
    0,
    coverage.totalUniqueTasks - coverage.mappedUniqueTasks,
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-2xl tabular-nums tracking-tight text-ink sm:text-3xl">
            {coverage.mappedUniqueTasks}
            <span className="text-text-dim"> / {coverage.totalUniqueTasks}</span>
          </p>
          <p className="mt-1 eng-label">{m.coverage.tasksMapped}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl tabular-nums text-accent sm:text-4xl">
            {formatPercent(coverage.coveragePercent)}
          </p>
          <p className="mt-1 eng-label">{m.coverage.taskCoverage}</p>
        </div>
      </div>

      <div className="measure-bar is-active mt-6 h-[3px] w-full max-w-xl">
        <span style={{ width: `${pct}%` }} />
      </div>

      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-text-muted">
        {m.coverage.explain}
      </p>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-text-muted">
        {m.coverage.unmatched(unmatched)}
      </p>
    </div>
  );
}
