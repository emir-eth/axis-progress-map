"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { SkillNode } from "@/types";
import { skillAsset, skillImageTuning } from "@/lib/assets";
import { useLocale } from "./LocaleProvider";

interface SkillDistributionProps {
  skills: SkillNode[];
  mappedContributions?: number;
  eventLevelAvailable?: boolean;
  metadataAvailable?: boolean;
}

/** Exact counts stay truthful; tiny values get a readable minimum marker. */
function barWidthPercent(count: number, max: number): number {
  if (max <= 0) return 0;
  const linear = (count / max) * 100;
  if (count <= 0) return 0;
  return Math.max(3.5, linear);
}

function useIsSmUp(): boolean {
  const [smUp, setSmUp] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => setSmUp(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return smUp;
}

function SkillIllustration({
  skill,
  boxClassName,
  diagramAlt,
}: {
  skill: string;
  boxClassName: string;
  diagramAlt: string;
}) {
  const src = skillAsset(skill);
  const tuning = skillImageTuning(skill);
  const [failed, setFailed] = useState(false);

  return (
    <div className={`relative flex items-center justify-center ${boxClassName}`}>
      {src && !failed ? (
        <Image
          src={src}
          alt={diagramAlt}
          width={420}
          height={420}
          unoptimized
          loading="eager"
          className="h-full w-full object-contain object-center"
          style={{
            transform: `scale(${tuning.scale}) translateY(${tuning.offsetY ?? "0"})`,
            transformOrigin: "center center",
          }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="eng-label text-text-dim" aria-hidden>
          {skill.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}

export function SkillDistribution({
  skills,
  mappedContributions = 0,
  eventLevelAvailable = true,
  metadataAvailable = true,
}: SkillDistributionProps) {
  const { messages: m } = useLocale();
  const sorted = useMemo(
    () =>
      [...skills].sort((a, b) => b.contributionCount - a.contributionCount),
    [skills],
  );
  const [selected, setSelected] = useState<string | null>(
    sorted[0]?.skill ?? null,
  );
  const smUp = useIsSmUp();

  if (sorted.length === 0) {
    const emptyCopy = !eventLevelAvailable
      ? m.skills.emptyNoEvents
      : !metadataAvailable
        ? m.skills.emptyNeedMatch
        : m.skills.emptyNoMatch;
    return <p className="text-sm text-text-muted">{emptyCopy}</p>;
  }

  const max = Math.max(...sorted.map((s) => s.contributionCount), 1);
  const active = sorted.find((s) => s.skill === selected) ?? sorted[0];
  const sharePct =
    active && mappedContributions > 0
      ? Math.round((active.contributionCount / mappedContributions) * 1000) /
        10
      : null;

  return (
    <div>
      <ul className="divide-y divide-border border-y border-border">
        {sorted.map((skill, index) => {
          const isActive = selected === skill.skill;
          const width = barWidthPercent(skill.contributionCount, max);
          const n = String(index + 1).padStart(2, "0");

          return (
            <li key={skill.skill}>
              <button
                type="button"
                onClick={() => setSelected(skill.skill)}
                className={`group w-full text-left transition-colors duration-200 ${
                  isActive
                    ? "bg-bg-elevated"
                    : index % 2 === 1
                      ? "bg-bg-elevated/35 hover:bg-bg-elevated/55"
                      : "hover:bg-bg-elevated/45"
                }`}
              >
                {!smUp ? (
                  <div className="flex flex-col gap-3 px-3 py-5">
                    <SkillIllustration
                      skill={skill.skill}
                      boxClassName="mx-auto h-[11rem] w-[11rem]"
                      diagramAlt={m.skills.skillDiagramAlt(skill.skill)}
                    />
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        {isActive && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                            aria-hidden
                          />
                        )}
                        <span className="eng-label shrink-0 text-text-dim">
                          {n}
                        </span>
                        <span
                          className={`font-display text-base tracking-[0.06em] ${
                            isActive ? "text-ink" : "text-text"
                          }`}
                        >
                          {skill.skill.toUpperCase()}
                        </span>
                      </div>
                      <span
                        className={`font-display text-2xl tabular-nums tracking-tight ${
                          isActive ? "text-accent" : "text-ink"
                        }`}
                      >
                        {skill.contributionCount}
                      </span>
                    </div>
                    <div
                      className={`measure-bar measure-bar-skill w-full ${
                        isActive ? "is-active" : ""
                      }`}
                    >
                      <span style={{ width: `${width}%` }} />
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-[9.5rem] grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_5.5rem] items-center gap-4 px-3 py-5 md:min-h-[10rem] md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_6.5rem] md:gap-5 md:px-4 md:py-5 lg:min-h-[10.5rem] lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_7.5rem] lg:gap-6">
                    <SkillIllustration
                      skill={skill.skill}
                      boxClassName="h-[10.5rem] w-full max-w-[10.5rem] md:h-[11.5rem] md:max-w-[11.5rem] lg:h-[12.5rem] lg:max-w-[12.5rem]"
                      diagramAlt={m.skills.skillDiagramAlt(skill.skill)}
                    />

                    <div className="min-w-0 py-1">
                      <div className="flex items-center gap-2.5">
                        {isActive && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                            aria-hidden
                          />
                        )}
                        <span className="eng-label text-text-dim">{n}</span>
                        <span
                          className={`font-display text-lg tracking-[0.08em] md:text-xl ${
                            isActive ? "text-ink" : "text-text"
                          }`}
                        >
                          {skill.skill.toUpperCase()}
                        </span>
                      </div>
                      <p className="mt-1.5 eng-label text-[13px] tracking-[0.14em]">
                        {m.skills.matchedContributionsLabel}
                      </p>
                      <div
                        className={`measure-bar measure-bar-skill mt-4 w-full max-w-xl ${
                          isActive ? "is-active" : ""
                        }`}
                      >
                        <span style={{ width: `${width}%` }} />
                      </div>
                    </div>

                    <p
                      className={`text-right font-display text-3xl tabular-nums tracking-tight md:text-4xl ${
                        isActive ? "text-accent" : "text-ink"
                      }`}
                    >
                      {skill.contributionCount}
                    </p>
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {active && (
        <div className="mt-7 border-l-2 border-accent/45 pl-4 animate-fade-up sm:mt-8">
          <p className="font-display text-xl tracking-tight text-ink sm:text-2xl">
            {active.skill}
          </p>
          <p className="mt-1.5 text-sm text-text-muted">
            <span className="font-display text-lg tabular-nums text-accent sm:text-xl">
              {active.contributionCount}
            </span>{" "}
            {m.skills.matchedContributionsSuffix}
          </p>
          {sharePct != null && (
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-text-dim">
              {m.skills.overlapNote(sharePct)}
            </p>
          )}
          {!eventLevelAvailable && (
            <p className="mt-2 text-[13px] text-text-dim">
              {m.skills.taskLevelUnavailable}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
