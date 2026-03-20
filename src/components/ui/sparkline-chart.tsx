"use client";

import { ResponsiveContainer, LineChart, Line } from "recharts";

interface SparklineChartProps {
  data: number[];
  color?: string;
  height?: number;
  className?: string;
}

export function SparklineChart({
  data,
  color,
  height = 32,
  className,
}: SparklineChartProps) {
  if (data.length < 2) return null;

  const chartData = data.map((value, i) => ({ i, value }));
  const first = data[0];
  const last = data[data.length - 1];
  const strokeColor =
    color ?? (last >= first ? "var(--success)" : "var(--destructive)");

  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={strokeColor}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
