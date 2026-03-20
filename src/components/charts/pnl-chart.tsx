"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { PortfolioSnapshot } from "@/lib/supabase/types";
import {
  chartColors,
  chartTooltipStyle,
  chartAxisProps,
  chartGridProps,
} from "@/lib/chart-theme";

interface PnlChartProps {
  snapshots: PortfolioSnapshot[];
}

export function PnlChart({ snapshots = [] }: PnlChartProps) {
  if (!snapshots || snapshots.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card">
        <p className="text-sm text-muted-foreground">
          No portfolio history available yet.
        </p>
      </div>
    );
  }

  const data = snapshots.map((s) => ({
    time: new Date(s.snapshot_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    value: Number(s.total_value.toFixed(2)),
  }));

  return (
    <div className="h-64 w-full rounded-lg border border-border bg-card p-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColors.axisText} stopOpacity={0.3} />
              <stop offset="95%" stopColor={chartColors.axisText} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...chartGridProps} />
          <XAxis dataKey="time" {...chartAxisProps} />
          <YAxis
            {...chartAxisProps}
            tickFormatter={(v: number) => `$${v.toLocaleString()}`}
          />
          <Tooltip
            contentStyle={chartTooltipStyle}
            labelStyle={{ color: chartColors.tooltipLabel }}
            formatter={(value: number) => [
              `$${value.toLocaleString()}`,
              "Portfolio Value",
            ]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={chartColors.line}
            strokeWidth={2}
            fill="url(#valueGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
