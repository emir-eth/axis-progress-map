"use client";

import type { CSSProperties, Ref } from "react";
import { ASSETS } from "@/lib/assets";
import { formatPercent, formatScore, shortenAddress } from "@/lib/format";
import type { ProfileAnalytics } from "@/types";

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 675;

export interface ShareCardIdentity {
  hubUsername?: string;
  xUsername?: string;
}

/** Derive optional share fields — omit when unavailable (no fake zeros). */
export function deriveShareFields(
  analytics: ProfileAnalytics,
  extras?: {
    hubTxhash?: {
      hubAttemptCount?: number;
      trajectoryCount?: number;
      unsignedAttemptCount?: number;
      withTxhash?: number;
      withoutTxhash?: number;
    } | null;
    baseRecordCount?: number | null;
  },
) {
  const { summary, coverage, skills, themes, metadataAvailable } = analytics;

  const topSkill =
    metadataAvailable && skills.length > 0
      ? [...skills].sort((a, b) => b.contributionCount - a.contributionCount)[0]
          ?.skill
      : undefined;

  const topEnvironment =
    themes.length > 0
      ? [...themes].sort((a, b) => b.count - a.count)[0]?.theme
      : undefined;

  const showCoverage =
    metadataAvailable &&
    coverage.totalUniqueTasks > 0 &&
    Number.isFinite(coverage.coveragePercent);

  const signed =
    extras?.hubTxhash?.trajectoryCount ?? extras?.hubTxhash?.withTxhash;
  const unsigned =
    extras?.hubTxhash?.unsignedAttemptCount ??
    extras?.hubTxhash?.withoutTxhash;

  return {
    contributionCount: summary.onChainContributions,
    uniqueTasks: summary.uniqueTasks,
    averageScore: summary.averageScore,
    bestScore: summary.bestScore,
    topSkill: topSkill || undefined,
    topEnvironment: topEnvironment
      ? topEnvironment.charAt(0).toUpperCase() + topEnvironment.slice(1)
      : undefined,
    metadataCoverage: showCoverage ? coverage.coveragePercent : undefined,
    signedAttempts:
      signed != null && signed >= 0 ? signed : undefined,
    unsignedAttempts:
      unsigned != null && unsigned >= 0 ? unsigned : undefined,
    baseRecords:
      extras?.baseRecordCount != null && extras.baseRecordCount > 0
        ? extras.baseRecordCount
        : undefined,
  };
}

interface ShareCardProps {
  address: string;
  analytics: ProfileAnalytics;
  identity?: ShareCardIdentity;
  hubTxhash?: {
    hubAttemptCount?: number;
    trajectoryCount?: number;
    unsignedAttemptCount?: number;
    withTxhash?: number;
    withoutTxhash?: number;
  } | null;
  baseRecordCount?: number | null;
  /** Forwarded to the root for html-to-image capture. */
  cardRef?: Ref<HTMLDivElement>;
}

const mono: CSSProperties = {
  fontFamily: "var(--font-mono), ui-monospace, monospace",
  textTransform: "uppercase",
  letterSpacing: "0.16em",
};

const display: CSSProperties = {
  fontFamily: "var(--font-display), system-ui, sans-serif",
  letterSpacing: "-0.035em",
};

/**
 * Fixed 1200×675 share card.
 * Collectible robotics-lab report — not a dashboard screenshot.
 */
export function ShareCard({
  address,
  analytics,
  identity,
  hubTxhash,
  baseRecordCount,
  cardRef,
}: ShareCardProps) {
  const fields = deriveShareFields(analytics, { hubTxhash, baseRecordCount });
  const hub = identity?.hubUsername?.trim() || undefined;
  const xHandle = identity?.xUsername?.trim() || undefined;
  const wallet = shortenAddress(address, 6);
  const hasProfile =
    fields.topSkill ||
    fields.topEnvironment ||
    fields.metadataCoverage != null ||
    fields.signedAttempts != null ||
    fields.unsignedAttempts != null ||
    fields.baseRecords != null;

  return (
    <div
      ref={cardRef}
      data-share-card="true"
      style={{
        width: SHARE_CARD_WIDTH,
        height: SHARE_CARD_HEIGHT,
        background: "#F3F2EC",
        color: "#151713",
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
        fontFamily: "var(--font-body), system-ui, sans-serif",
      }}
    >
      {/* measurement field */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(to right, rgba(181,184,173,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(181,184,173,0.16) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          opacity: 0.5,
          pointerEvents: "none",
        }}
      />

      {/* outer frame */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 28,
          border: "1px solid #CFD1C8",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 34,
          border: "1px solid rgba(207,209,200,0.55)",
          pointerEvents: "none",
        }}
      />

      {/* vertical spine */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 56,
          top: 48,
          bottom: 48,
          width: 2,
          background: "#20B86A",
        }}
      />

      {/* ── Header ── */}
      <div style={{ position: "absolute", left: 80, top: 52, right: 500 }}>
        <p style={{ ...mono, margin: 0, fontSize: 11, color: "#5C6058" }}>
          Axis Progress Map
        </p>
        <p
          style={{
            ...mono,
            margin: "6px 0 0",
            fontSize: 13,
            letterSpacing: "0.2em",
            color: "#20B86A",
          }}
        >
          Axis activity map
        </p>
      </div>

      <div
        style={{
          position: "absolute",
          right: 500,
          top: 52,
          textAlign: "right",
        }}
      >
        <p style={{ ...mono, margin: 0, fontSize: 10, color: "#5C6058" }}>
          Hub / Public
        </p>
        <p style={{ ...mono, margin: "4px 0 0", fontSize: 10, color: "#5C6058" }}>
          Base / Optional
        </p>
        <p style={{ ...mono, margin: "4px 0 0", fontSize: 10, color: "#5C6058" }}>
          Progress Map
        </p>
      </div>

      {/* ── Identity strip (compact, below header) ── */}
      <div
        style={{
          position: "absolute",
          left: 80,
          top: 108,
          right: 500,
          display: "flex",
          flexWrap: "wrap",
          gap: 28,
          borderTop: "1px solid #CFD1C8",
          borderBottom: "1px solid #CFD1C8",
          padding: "12px 0",
        }}
      >
        {hub && <IdChip label="Hub" value={hub} />}
        {xHandle && <IdChip label="X" value={xHandle} />}
        <IdChip label="Wallet" value={wallet} />
      </div>

      {/* ── Primary contribution count ── */}
      <div style={{ position: "absolute", left: 80, top: 178, right: 500 }}>
        <p
          style={{
            ...display,
            margin: 0,
            fontSize: 128,
            fontWeight: 600,
            lineHeight: 0.88,
            color: "#20B86A",
          }}
        >
          {fields.contributionCount}
        </p>
        <p
          style={{
            ...mono,
            margin: "10px 0 0",
            fontSize: 15,
            letterSpacing: "0.22em",
            color: "#252923",
            lineHeight: 1.35,
          }}
        >
          Trajectories
        </p>
        <p
          style={{
            ...mono,
            margin: "6px 0 0",
            fontSize: 10,
            letterSpacing: "0.14em",
            color: "#5C6058",
            lineHeight: 1.35,
            textTransform: "none",
          }}
        >
          From public Hub activity
        </p>
      </div>

      {/* ── Secondary metrics as editorial columns ── */}
      <div
        style={{
          position: "absolute",
          left: 80,
          top: 390,
          right: 500,
          display: "grid",
          gridTemplateColumns: "1fr 1px 1fr 1px 1fr",
          alignItems: "start",
          gap: 0,
          borderTop: "1px solid #B5B8AD",
          paddingTop: 18,
        }}
      >
        <Metric value={String(fields.uniqueTasks)} label="Unique tasks" />
        <div style={{ background: "#CFD1C8", width: 1, alignSelf: "stretch" }} />
        <Metric
          value={formatScore(fields.averageScore)}
          label="Avg score"
          pad
        />
        <div style={{ background: "#CFD1C8", width: 1, alignSelf: "stretch" }} />
        <Metric value={formatScore(fields.bestScore)} label="Best score" pad />
      </div>

      {/* ── Contribution profile ── */}
      {hasProfile && (
        <div
          style={{
            position: "absolute",
            left: 80,
            top: 500,
            right: 500,
            borderTop: "1px solid #CFD1C8",
            paddingTop: 14,
          }}
        >
          <p style={{ ...mono, margin: 0, fontSize: 10, color: "#5C6058" }}>
            Snapshot
          </p>
          <div
            style={{
              marginTop: 10,
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 16,
            }}
          >
            {fields.topSkill && (
              <ProfileCell label="Primary skill" value={fields.topSkill} />
            )}
            {fields.topEnvironment && (
              <ProfileCell
                label="Primary environment"
                value={fields.topEnvironment}
              />
            )}
            {fields.metadataCoverage != null && (
              <ProfileCell
                label="Task coverage"
                value={formatPercent(fields.metadataCoverage)}
              />
            )}
            {fields.signedAttempts != null && (
              <ProfileCell
                label="Signed"
                value={String(fields.signedAttempts)}
              />
            )}
            {fields.unsignedAttempts != null && (
              <ProfileCell
                label="Unsigned"
                value={String(fields.unsignedAttempts)}
              />
            )}
            {fields.baseRecords != null && (
              <ProfileCell
                label="Base records"
                value={String(fields.baseRecords)}
              />
            )}
          </div>
        </div>
      )}

      {/* ── CAD robot — right ~38% ── */}
      <div
        style={{
          position: "absolute",
          right: 48,
          top: 48,
          width: 420,
          bottom: 88,
        }}
      >
        {/* engineering annotations */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            borderLeft: "1px solid #CFD1C8",
            pointerEvents: "none",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 16,
            top: 0,
            right: 0,
            height: 1,
            background: "#CFD1C8",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 16,
            bottom: 0,
            right: 0,
            height: 1,
            background: "#CFD1C8",
          }}
        />
        <p
          style={{
            ...mono,
            position: "absolute",
            left: 28,
            top: 12,
            margin: 0,
            fontSize: 10,
            color: "#5C6058",
          }}
        >
          Axis Progress Map
        </p>
        <p
          style={{
            ...mono,
            position: "absolute",
            right: 8,
            top: 12,
            margin: 0,
            fontSize: 10,
            color: "#5C6058",
          }}
        >
          Plate / Mono
        </p>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ASSETS.robotProfile}
          alt=""
          width={400}
          height={500}
          crossOrigin="anonymous"
          draggable={false}
          style={{
            position: "absolute",
            left: "6%",
            top: "8%",
            width: "90%",
            height: "86%",
            objectFit: "contain",
            objectPosition: "center",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />

        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 28,
            bottom: 14,
            width: 48,
            height: 2,
            background: "#20B86A",
          }}
        />
      </div>

      {/* ── Branding footer ── */}
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 48,
          bottom: 44,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <p
            style={{
              ...mono,
              margin: 0,
              fontSize: 12,
              letterSpacing: "0.18em",
              color: "#252923",
            }}
          >
            Axis Progress Map
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#5C6058" }}>
            Unofficial · Not affiliated with Axis Robotics
          </p>
        </div>
      </div>
    </div>
  );
}

function IdChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ ...mono, margin: 0, fontSize: 9, color: "#5C6058" }}>
        {label}
      </p>
      <p
        style={{
          margin: "3px 0 0",
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: 14,
          color: "#151713",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 220,
        }}
      >
        {value}
      </p>
    </div>
  );
}

function Metric({
  value,
  label,
  pad,
}: {
  value: string;
  label: string;
  pad?: boolean;
}) {
  return (
    <div style={{ paddingLeft: pad ? 18 : 0, paddingRight: 12 }}>
      <p
        style={{
          ...display,
          margin: 0,
          fontSize: 34,
          fontWeight: 600,
          color: "#252923",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
      <p style={{ ...mono, margin: "6px 0 0", fontSize: 10, color: "#5C6058" }}>
        {label}
      </p>
    </div>
  );
}

function ProfileCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ ...mono, margin: 0, fontSize: 9, color: "#5C6058" }}>
        {label}
      </p>
      <p
        style={{
          ...display,
          margin: "5px 0 0",
          fontSize: 20,
          fontWeight: 600,
          color: "#151713",
          textTransform: "uppercase",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </p>
    </div>
  );
}
