import React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const GRID_STROKE = "rgba(255, 255, 255, 0.08)";
const TICK_FILL = "rgba(255, 255, 255, 0.55)";
const STROKE_WEIGHT = "#e54d4d";
const STROKE_REPS = "#4d9eff";

/**
 * Dual-axis series: summed weight (left) and reps (right) per workout day.
 * {@code data}: {@code { day, totalWeight, totalReps }}.
 */
export function ExerciseSeriesChart({ data, formatDayLabel }) {
  if (!data?.length) return null;

  return (
    <div className="volume-chart exercise-series-chart">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 12, right: 18, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fill: TICK_FILL, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            tickFormatter={(iso) => formatDayLabel(iso)}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="left"
            dataKey="totalWeight"
            tick={{ fill: TICK_FILL, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            width={44}
            tickFormatter={(n) => {
              const x = Number(n);
              return Number.isFinite(x) ? String(Math.round(x * 10) / 10) : "";
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            dataKey="totalReps"
            tick={{ fill: TICK_FILL, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            width={40}
            tickFormatter={(n) => {
              const x = Number(n);
              return Number.isFinite(x) ? String(Math.round(x)) : "";
            }}
          />
          <Tooltip
            cursor={{ stroke: "rgba(255, 255, 255, 0.2)", strokeWidth: 1 }}
            contentStyle={{
              background: "rgba(15, 18, 24, 0.96)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "12px",
              color: "rgba(255, 255, 255, 0.92)",
              fontSize: 13,
            }}
            labelFormatter={(iso) => formatDayLabel(iso)}
            formatter={(value, name) => [String(value), name === "totalWeight" ? "Suma wagi" : "Suma powtórzeń"]}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="totalWeight"
            name="totalWeight"
            stroke={STROKE_WEIGHT}
            strokeWidth={2}
            dot={{ fill: STROKE_WEIGHT, strokeWidth: 0, r: 4 }}
            activeDot={{ r: 6, fill: STROKE_WEIGHT }}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="totalReps"
            name="totalReps"
            stroke={STROKE_REPS}
            strokeWidth={2}
            dot={{ fill: STROKE_REPS, strokeWidth: 0, r: 4 }}
            activeDot={{ r: 6, fill: STROKE_REPS }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
