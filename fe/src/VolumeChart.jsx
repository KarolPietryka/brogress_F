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
const LINE_STROKE = "#ffcf5a";

/**
 * Volume over workout days (current series). {@code data}: {@code { day, volume }}.
 */
export function VolumeChart({ data, formatDayLabel }) {
  if (!data?.length) return null;

  return (
    <div className="volume-chart">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 12, right: 14, left: 2, bottom: 4 }}>
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
            dataKey="volume"
            tick={{ fill: TICK_FILL, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            width={48}
            tickFormatter={(n) => {
              const x = Number(n);
              return Number.isFinite(x) ? String(Math.round(x)) : "";
            }}
          />
          <Tooltip
            cursor={{ stroke: "rgba(255, 207, 90, 0.35)", strokeWidth: 1 }}
            contentStyle={{
              background: "rgba(15, 18, 24, 0.96)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "12px",
              color: "rgba(255, 255, 255, 0.92)",
              fontSize: 13,
            }}
            labelFormatter={(iso) => formatDayLabel(iso)}
            formatter={(value) => [String(value), "Volume"]}
          />
          <Line
            type="monotone"
            dataKey="volume"
            name="Volume"
            stroke={LINE_STROKE}
            strokeWidth={2}
            dot={{ fill: LINE_STROKE, strokeWidth: 0, r: 4 }}
            activeDot={{ r: 6, fill: LINE_STROKE }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
