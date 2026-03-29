"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { chartTooltipStyle, chartColors } from "@/lib/chart-theme";

interface CategoryBreakdownProps {
  categoryStats: Record<string, { count: number; sources: string[] }>;
}

const CATEGORY_COLORS: Record<string, string> = {
  politics: "#8b5cf6",
  crypto: "#84cc16",
  sports: "#ef4444",
  weather: "#0ea5e9",
  economics: "#06b6d4",
  entertainment: "#f97316",
  science: "#a855f7",
  other: "#71717a",
};

export function CategoryBreakdown({ categoryStats }: CategoryBreakdownProps) {
  const data = Object.entries(categoryStats)
    .map(([name, stats]) => ({
      name,
      value: stats.count,
      sources: stats.sources.length,
      sourceList: stats.sources.join(", "),
    }))
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-border bg-card">
        <p className="text-sm text-muted-foreground">No category data yet.</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6">
      <div className="h-48 w-48 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={3}
              dataKey="value"
            >
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={CATEGORY_COLORS[entry.name] ?? "#71717a"}
                  strokeWidth={0}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: number, name: string) => [
                `${value} signals`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-2">
        {data.map((cat) => (
          <div key={cat.name} className="flex items-center gap-3">
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: CATEGORY_COLORS[cat.name] ?? "#71717a" }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium capitalize">{cat.name}</span>
                <span className="text-xs font-mono text-muted-foreground">
                  {cat.value}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">
                {cat.sourceList}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
