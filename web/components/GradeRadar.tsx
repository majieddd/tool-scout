"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";

export type GradeAxes = {
  R: number | null;
  Q: number | null;
  N: number | null;
  I: number | null;
  F: number | null;
};

const AXIS_LABELS: Record<keyof GradeAxes, string> = {
  R: "Relevance",
  Q: "Quality",
  N: "Novelty",
  I: "Install ease",
  F: "Fit",
};

export function GradeRadar({ axes }: { axes: GradeAxes }) {
  const data = (Object.keys(AXIS_LABELS) as (keyof GradeAxes)[]).map((k) => ({
    axis: AXIS_LABELS[k],
    value: axes[k] ?? 0,
    fullMark: 5,
  }));
  return (
    <div className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="75%">
          <PolarGrid stroke="#2a2a2a" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: "#a3a3a3", fontSize: 11 }} />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 5]}
            tick={{ fill: "#737373", fontSize: 10 }}
            stroke="#2a2a2a"
          />
          <Radar
            name="grade"
            dataKey="value"
            stroke="#8B5CF6"
            fill="#8B5CF6"
            fillOpacity={0.30}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
