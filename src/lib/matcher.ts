import type {
  AxisTaskFamily,
  HubAttemptContribution,
  MappedContribution,
  MatchPhase,
  OnChainContribution,
} from "@/types";
import { normalizeSkillName } from "@/lib/assets";

function toTaskIdString(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export interface TaskIndex {
  byTaskId: Map<string, { family: AxisTaskFamily; phase: MatchPhase }>;
}

/** Build a lookup from taskId → Axis family + pre/post phase. */
export function buildTaskIndex(families: AxisTaskFamily[]): TaskIndex {
  const byTaskId = new Map<string, { family: AxisTaskFamily; phase: MatchPhase }>();

  for (const family of families) {
    const preId = toTaskIdString(family.pre_task_id);
    const postId = toTaskIdString(family.latest_post_task_id);

    if (preId) {
      byTaskId.set(preId, { family, phase: "pre" });
    }
    if (postId) {
      // If a task id appears as both (unlikely), prefer explicit post for that id
      byTaskId.set(postId, { family, phase: "post" });
    }
  }

  return { byTaskId };
}

function enrichFromFamily(
  base: {
    dataId: string;
    taskId: string;
    user: `0x${string}`;
    score: number | null;
    simulationTime: number;
    blockNumber: number | null;
    transactionHash: `0x${string}` | null;
    logIndex: number;
    timestamp: number | null;
    attemptId: number | null;
    source: "hub" | "onchain";
    taskNameHint?: string | null;
    themeHint?: string | null;
  },
  index: TaskIndex,
): MappedContribution {
  const hit = index.byTaskId.get(base.taskId);
  if (!hit) {
    return {
      dataId: base.dataId,
      taskId: base.taskId,
      user: base.user,
      score: base.score,
      simulationTime: base.simulationTime,
      blockNumber: base.blockNumber,
      transactionHash: base.transactionHash,
      logIndex: base.logIndex,
      timestamp: base.timestamp,
      attemptId: base.attemptId,
      source: base.source,
      metadataStatus: "unmapped",
      phase: null,
      taskName: base.taskNameHint ?? null,
      description: null,
      skills: [],
      theme: base.themeHint ?? null,
      embodiment: null,
      difficulty: null,
      successRate: null,
      familyId: null,
    };
  }

  const { family, phase } = hit;
  return {
    dataId: base.dataId,
    taskId: base.taskId,
    user: base.user,
    score: base.score,
    simulationTime: base.simulationTime,
    blockNumber: base.blockNumber,
    transactionHash: base.transactionHash,
    logIndex: base.logIndex,
    timestamp: base.timestamp,
    attemptId: base.attemptId,
    source: base.source,
    metadataStatus: "mapped",
    phase,
    taskName: family.name ?? base.taskNameHint ?? null,
    description: family.description ?? null,
    skills: Array.isArray(family.skills)
      ? [
          ...new Set(
            family.skills
              .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
              .map(normalizeSkillName),
          ),
        ]
      : [],
    // Canonical metadata theme when mapped; Hub theme only as unmapped fallback
    theme: family.theme ?? base.themeHint ?? null,
    embodiment: family.embodiment ?? null,
    difficulty:
      typeof family.difficulty_stars === "number"
        ? family.difficulty_stars
        : null,
    successRate:
      typeof family.success_rate === "number" ? family.success_rate : null,
    familyId: String(family.id),
  };
}

export function matchContributions(
  contributions: OnChainContribution[],
  index: TaskIndex,
): MappedContribution[] {
  return contributions.map((c) =>
    enrichFromFamily(
      {
        ...c,
        attemptId: null,
        source: "onchain",
      },
      index,
    ),
  );
}

export function matchHubAttempts(
  contributions: HubAttemptContribution[],
  index: TaskIndex,
): MappedContribution[] {
  return contributions.map((c) =>
    enrichFromFamily(
      {
        dataId: c.dataId,
        taskId: c.taskId,
        user: c.user,
        score: c.score,
        simulationTime: c.simulationTime,
        blockNumber: c.blockNumber,
        transactionHash: c.transactionHash,
        logIndex: c.logIndex,
        timestamp: c.timestamp,
        attemptId: c.attemptId,
        source: "hub",
        taskNameHint: c.taskNameHint,
        themeHint: c.themeHint,
      },
      index,
    ),
  );
}
