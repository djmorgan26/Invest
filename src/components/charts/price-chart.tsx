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
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={{ stroke: "#27272a" }}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={{ stroke: "#27272a" }}
            tickFormatter={(v: number) => `${v}\u00a2`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "8px",
              fontSize: 12,
            }}
            labelStyle={{ color: "#a1a1aa" }}
            formatter={(value: number) => [`${value}\u00a2`, ""]}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="#e4e4e7"
            strokeWidth={2}
            dot={false}
            name="Last Price"
          />
          <Line
            type="monotone"
            dataKey="bid"
            stroke="#22c55e"
            strokeWidth={1}
            dot={false}
            strokeDasharray="4 4"
            name="Bid"
          />
          <Line
            type="monotone"
            dataKey="ask"
            stroke="#ef4444"
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
