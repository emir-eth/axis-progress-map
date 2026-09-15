/** Paths for monochrome technical illustrations in /public/assets */

export const ASSETS = {
  robotHero: "/assets/axis-robot-arm-hero.png",
  robotProfile: "/assets/axis-robot-arm-profile.png",
  skills: {
    Pick: "/assets/axis-skill-pick.png",
    Place: "/assets/axis-skill-place.png",
    Transfer: "/assets/axis-skill-transfer.png",
    Stack: "/assets/axis-skill-stack.png",
    Open: "/assets/axis-skill-open.png",
    Arrange: "/assets/axis-skill-arrange.png",
    Rotate: "/assets/axis-skill-rotate.png",
  } as Record<string, string>,
} as const;

const SKILL_ALIASES: Record<string, keyof typeof ASSETS.skills> = {
  pick: "Pick",
  place: "Place",
  transfer: "Transfer",
  stack: "Stack",
  open: "Open",
  arrange: "Arrange",
  rotate: "Rotate",
};

/** Canonical Title-case skill label for known Axis atomic skills. */
export function normalizeSkillName(skill: string): string {
  const trimmed = skill.trim();
  if (!trimmed) return trimmed;
  const alias = SKILL_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Optical nudge only — keep scale at 1 so contain framing is not clipped.
 * Size comes from the container; do not crop cubes/arrows/cabinet.
 */
export const SKILL_IMAGE_TUNING: Record<
  string,
  { scale: number; offsetY?: string }
> = {
  Pick: { scale: 1 },
  Place: { scale: 1 },
  Transfer: { scale: 1 },
  Stack: { scale: 1 },
  Open: { scale: 1 },
  Arrange: { scale: 1 },
  Rotate: { scale: 1 },
};

export function skillAsset(skill: string): string | null {
  const key = normalizeSkillName(skill);
  return ASSETS.skills[key] ?? null;
}

export function skillImageTuning(skill: string) {
  const key = normalizeSkillName(skill);
  return SKILL_IMAGE_TUNING[key] ?? { scale: 1 };
}
