"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { PriceSnapshot } from "@/lib/supabase/types";
import {
  chartColors,
  chartTooltipStyle,
  chartAxisProps,
  chartGridProps,
} from "@/lib/chart-theme";

interface PriceChartProps {
  snapshots: PriceSnapshot[];
}

export function PriceChart({ snapshots = [] }: PriceChartProps) {
  if (!snapshots || snapshots.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card">
        <p className="text-sm text-muted-foreground">
          No price history available yet.
        </p>
      </div>
    );
  }

  const data = snapshots.map((s) => ({
    time: new Date(s.snapshot_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
    }),
    price: s.last_price,
    bid: s.yes_bid,
    ask: s.yes_ask,
  }));

  return (
    <div className="h-64 w-full rounded-lg border border-border bg-card p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid {...chartGridProps} />
          <XAxis dataKey="time" {...chartAxisProps} />
          <YAxis
            domain={[0, 100]}
            {...chartAxisProps}
            tickFormatter={(v: number) => `${v}\u00a2`}
          />
          <Tooltip
            contentStyle={chartTooltipStyle}
            labelStyle={{ color: chartColors.tooltipLabel }}
            formatter={(value: number) => [`${value}\u00a2`, ""]}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke={chartColors.line}
            strokeWidth={2}
            dot={false}
            name="Last Price"
          />
          <Line
            type="monotone"
            dataKey="bid"
            stroke={chartColors.bid}
            strokeWidth={1}
            dot={false}
            strokeDasharray="4 4"
            name="Bid"
          />
          <Line
            type="monotone"
            dataKey="ask"
            stroke={chartColors.ask}
            strokeWidth={1}
            dot={false}
            strokeDasharray="4 4"
            name="Ask"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
