"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import type { MappedContribution } from "@/types";
import { baseScanTxUrl, formatDate, formatDateShort, formatTimestampIso } from "@/lib/format";

interface ContributionExplorerProps {
  contributions: MappedContribution[];
}

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

function buildPageList(
  current: number,
  total: number,
): Array<number | "ellipsis"> {
  if (total <= 1) return total === 1 ? [1] : [];
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  pages.add(1);
  pages.add(total);
  for (let p = current - 2; p <= current + 2; p += 1) {
    if (p >= 1 && p <= total) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | "ellipsis"> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const page = sorted[i]!;
    if (i > 0 && page - sorted[i - 1]! > 1) out.push("ellipsis");
    out.push(page);
  }
  return out;
}

export function ContributionExplorer({
  contributions,
}: ContributionExplorerProps) {
  const [query, setQuery] = useState("");
  const [skill, setSkill] = useState("all");
  const [theme, setTheme] = useState("all");
  const [embodiment, setEmbodiment] = useState("all");
  const [phase, setPhase] = useState("all");
  /** Default: all Hub attempts. */
  const [status, setStatus] = useState<"all" | "signed" | "unsigned">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [selected, setSelected] = useState<MappedContribution | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const skills = new Set<string>();
    const themes = new Set<string>();
    const embodiments = new Set<string>();
    for (const c of contributions) {
      c.skills.forEach((s) => skills.add(s));
      if (c.theme) themes.add(c.theme);
      if (c.embodiment) embodiments.add(c.embodiment);
    }
    return {
      skills: [...skills].sort(),
      themes: [...themes].sort(),
      embodiments: [...embodiments].sort(),
    };
  }, [contributions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contributions
      .filter((c) => {
        const hasTx = c.transactionHash != null && c.transactionHash.length > 0;
        if (status === "signed" && !hasTx) return false;
        if (status === "unsigned" && hasTx) return false;
        if (skill !== "all" && !c.skills.includes(skill)) return false;
        if (theme !== "all" && c.theme !== theme) return false;
        if (embodiment !== "all" && c.embodiment !== embodiment) return false;
        if (phase !== "all" && c.phase !== phase) return false;
        if (!q) return true;
        const hay = [
          c.taskName,
          c.taskId,
          c.dataId,
          c.theme,
          c.embodiment,
          ...c.skills,
          c.transactionHash,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  }, [contributions, query, skill, theme, embodiment, phase, status]);

  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize) || 1);
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [query, skill, theme, embodiment, phase, status, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageStart =
    totalFiltered === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, totalFiltered);
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );
  const pageButtons = useMemo(
    () => buildPageList(safePage, totalPages),
    [safePage, totalPages],
  );

  const goToPage = (next: number) => {
    const clamped = Math.min(totalPages, Math.max(1, next));
    setPage(clamped);
    sectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div ref={sectionRef}>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, IDs, skills…"
            className="w-full border border-border bg-bg-panel py-2.5 pl-9 pr-3 text-sm text-text outline-none focus:border-border-strong"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            label="Skill"
            value={skill}
            onChange={setSkill}
            options={options.skills}
          />
          <FilterSelect
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={options.themes}
          />
          <FilterSelect
            label="Embodiment"
            value={embodiment}
            onChange={setEmbodiment}
            options={options.embodiments}
          />
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
            className="border border-border bg-bg-panel px-2 py-2 text-xs text-text-muted outline-none"
            aria-label="Phase filter"
          >
            <option value="all">Pre/Post</option>
            <option value="pre">Pre</option>
            <option value="post">Post</option>
          </select>
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as "all" | "signed" | "unsigned")
            }
            className="border border-border bg-bg-panel px-2 py-2 text-xs text-text-muted outline-none"
            aria-label="Status filter"
          >
            <option value="all">All</option>
            <option value="signed">Signed</option>
            <option value="unsigned">Unsigned</option>
          </select>
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-text-dim">
          {totalFiltered === 0
            ? `Showing 0 of ${contributions.length} contributions`
            : `Showing ${pageStart}–${pageEnd} of ${totalFiltered} contributions`}
        </p>
        <label className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-text-dim">
          <span className="sr-only">Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
            className="border border-border bg-bg-panel px-2 py-1.5 text-[10px] tracking-[0.12em] text-text-muted outline-none"
            aria-label="Rows per page"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} / PAGE
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto border border-border">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-bg-elevated text-xs uppercase tracking-wider text-text-dim">
            <tr>
              <th className="px-3 py-3 font-medium">Task</th>
              <th className="px-3 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Score</th>
              <th className="px-3 py-3 font-medium">Skills</th>
              <th className="px-3 py-3 font-medium">Theme</th>
              <th className="px-3 py-3 font-medium">Embodiment</th>
              <th className="px-3 py-3 font-medium">Phase</th>
              <th className="px-3 py-3 font-medium">Tx</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((c) => (
              <tr
                key={
                  c.attemptId != null
                    ? `hub-${c.attemptId}`
                    : `${c.transactionHash ?? "none"}-${c.logIndex}-${c.dataId}`
                }
                className="cursor-pointer border-b border-border/70 transition hover:bg-bg-panel"
                onClick={() => setSelected(c)}
              >
                <td className="max-w-[220px] px-3 py-3.5">
                  <p className="truncate text-text">
                    {c.taskName ?? (
                      <span className="text-text-muted">Unmapped</span>
                    )}
                  </p>
                  <p className="font-mono text-[11px] text-text-dim">
                    {c.taskId}
                  </p>
                </td>
                <td
                  className="whitespace-nowrap px-3 py-3.5 text-text-muted"
                  title={formatTimestampIso(c.timestamp)}
                >
                  {formatDateShort(c.timestamp)}
                </td>
                <td className="px-3 py-3.5 text-text">
                  {c.score == null ? "—" : c.score}
                </td>
                <td className="max-w-[160px] truncate px-3 py-3.5 text-text-muted">
                  {c.skills.length ? c.skills.join(", ") : "—"}
                </td>
                <td className="px-3 py-3.5 text-text-muted">
                  {c.theme ?? "—"}
                </td>
                <td className="px-3 py-3.5 text-text-muted">
                  {c.embodiment ?? "—"}
                </td>
                <td className="px-3 py-3.5 text-text-muted">
                  {c.phase ?? "—"}
                </td>
                <td className="px-3 py-3.5">
                  {c.transactionHash ? (
                    <a
                      href={baseScanTxUrl(c.transactionHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-text-muted transition hover:text-accent hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.transactionHash.slice(0, 8)}…
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span
                      className="font-mono text-[10px] tracking-[0.12em] text-text-dim"
                      title="No transaction hash on this Hub attempt"
                    >
                      —
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {totalFiltered === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-text-muted"
                >
                  No contributions match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalFiltered > 0 && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Mobile: PREV / N of M / NEXT */}
          <div className="flex items-center justify-between gap-3 sm:hidden">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => goToPage(safePage - 1)}
              className="border border-border px-3 py-2 font-mono text-[10px] tracking-[0.14em] text-text-muted transition enabled:hover:border-ink enabled:hover:text-ink disabled:opacity-40"
            >
              PREVIOUS
            </button>
            <p className="font-mono text-[11px] tabular-nums tracking-[0.08em] text-text-dim">
              {safePage} / {totalPages}
            </p>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => goToPage(safePage + 1)}
              className="border border-border px-3 py-2 font-mono text-[10px] tracking-[0.14em] text-text-muted transition enabled:hover:border-ink enabled:hover:text-ink disabled:opacity-40"
            >
              NEXT
            </button>
          </div>

          {/* Desktop: numbered pagination */}
          <div className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => goToPage(safePage - 1)}
              className="border border-border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] text-text-muted transition enabled:hover:border-ink enabled:hover:text-ink disabled:opacity-40"
            >
              PREVIOUS
            </button>
            {pageButtons.map((item, idx) =>
              item === "ellipsis" ? (
                <span
                  key={`e-${idx}`}
                  className="px-1.5 font-mono text-[11px] text-text-dim"
                  aria-hidden
                >
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => goToPage(item)}
                  aria-current={item === safePage ? "page" : undefined}
                  className={`min-w-[2rem] border px-2 py-1.5 font-mono text-[11px] tabular-nums tracking-[0.06em] transition ${
                    item === safePage
                      ? "border-ink bg-ink text-bg"
                      : "border-border text-text-muted hover:border-ink hover:text-ink"
                  }`}
                >
                  {item}
                </button>
              ),
            )}
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => goToPage(safePage + 1)}
              className="border border-border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] text-text-muted transition enabled:hover:border-ink enabled:hover:text-ink disabled:opacity-40"
            >
              NEXT
            </button>
          </div>
        </div>
      )}

      {selected && (
        <TaskDetailDrawer
          contribution={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-border bg-bg-panel px-2 py-2 text-xs text-text-muted outline-none"
      aria-label={`${label} filter`}
    >
      <option value="all">{label}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function TaskDetailDrawer({
  contribution: c,
  onClose,
}: {
  contribution: MappedContribution;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink/35"
        aria-label="Close task detail"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-border bg-bg-elevated p-6 shadow-2xl animate-fade-up">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-text-dim">
              Task detail
            </p>
            <h3 className="mt-1 font-display text-xl text-text">
              {c.taskName ?? "Unmapped task"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-border p-2 text-text-muted hover:text-text"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {c.description && (
          <p className="mb-5 text-sm leading-relaxed text-text-muted">
            {c.description}
          </p>
        )}

        <dl className="space-y-3 overflow-y-auto text-sm scrollbar-thin">
          <Row label="User score" value={c.score == null ? "—" : String(c.score)} />
          <Row label="Task ID" value={c.taskId} mono />
          <Row label="Data ID" value={c.dataId} mono />
          <Row
            label="Skills"
            value={c.skills.length ? c.skills.join(", ") : "—"}
          />
          <Row label="Theme" value={c.theme ?? "—"} />
          <Row label="Embodiment" value={c.embodiment ?? "—"} />
          <Row
            label="Difficulty"
            value={c.difficulty != null ? `${c.difficulty}★` : "—"}
          />
          <Row
            label="Axis task success rate"
            value={
              c.successRate != null
                ? `${(c.successRate * (c.successRate <= 1 ? 100 : 1)).toFixed(1)}%`
                : "—"
            }
          />
          <Row label="Phase" value={c.phase ?? "Unmapped"} />
          <Row label="Contribution timestamp" value={formatDate(c.timestamp)} />
          <div>
            <dt className="text-text-dim">Transaction hash</dt>
            <dd className="mt-1">
              {c.transactionHash ? (
                <a
                  href={baseScanTxUrl(c.transactionHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all font-mono text-xs text-text-muted hover:text-accent hover:underline"
                >
                  {c.transactionHash}
                  <ExternalLink size={12} />
                </a>
              ) : (
                <span className="font-mono text-xs tracking-[0.12em] text-text-dim">
                  —
                </span>
              )}
            </dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-border pb-2">
      <dt className="text-text-dim">{label}</dt>
      <dd className={`text-right text-text ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
