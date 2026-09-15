"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyBucket } from "@/types";

type Range = "7D" | "30D" | "ALL";

interface ContributionHistoryProps {
  timeline: DailyBucket[];
}

function filterRange(timeline: DailyBucket[], range: Range): DailyBucket[] {
  if (range === "ALL" || timeline.length === 0) return timeline;
  const days = range === "7D" ? 7 : 30;
  const last = timeline[timeline.length - 1];
  const end = new Date(last.date + "T00:00:00Z").getTime();
  const start = end - (days - 1) * 86_400_000;
  return timeline.filter((d) => new Date(d.date + "T00:00:00Z").getTime() >= start);
}

export function ContributionHistory({ timeline }: ContributionHistoryProps) {
  const [range, setRange] = useState<Range>("ALL");
  const data = useMemo(() => filterRange(timeline, range), [timeline, range]);

  if (timeline.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        No timestamped contributions available for the timeline.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          Contributions per day and average score over time
        </p>
        <div className="flex border border-border">
          {(["7D", "30D", "ALL"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-xs tracking-wide transition ${
                range === r
                  ? "bg-accent-dim text-accent"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(37,41,35,0.08)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#5C6058", fontSize: 12 }}
              axisLine={{ stroke: "#CFD1C8" }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              yAxisId="count"
              tick={{ fill: "#5C6058", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <YAxis
              yAxisId="score"
              orientation="right"
              domain={[0, 100]}
              tick={{ fill: "#5C6058", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: "#F3F2EC",
                border: "1px solid #CFD1C8",
                borderRadius: 0,
                fontSize: 12,
              }}
              labelStyle={{ color: "#151713" }}
            />
            <Line
              yAxisId="count"
              type="monotone"
              dataKey="count"
              name="Contributions"
              stroke="#20B86A"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, fill: "#20B86A" }}
            />
            <Line
              yAxisId="score"
              type="monotone"
              dataKey="averageScore"
              name="Avg score"
              stroke="#5C6058"
              strokeWidth={1.25}
              strokeDasharray="4 4"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
