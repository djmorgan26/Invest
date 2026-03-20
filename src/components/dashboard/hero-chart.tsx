"use client";

import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  chartTooltipStyle,
  chartAxisProps,
  chartColors,
} from "@/lib/chart-theme";
import {
  TimeRangeSelector,
  type TimeRange,
} from "@/components/charts/time-range-selector";

interface Snapshot {
  snapshot_at: string;
  total_value: number;
}

interface HeroChartProps {
  snapshots: Snapshot[];
}

function filterByRange(snapshots: Snapshot[], range: TimeRange): Snapshot[] {
  if (range === "all") return snapshots;
  const now = Date.now();
  const ms: Record<string, number> = {
    "1d": 86400000,
    "1w": 604800000,
    "1m": 2592000000,
    "3m": 7776000000,
  };
  const cutoff = now - (ms[range] ?? 0);
  return snapshots.filter(
    (s) => new Date(s.snapshot_at).getTime() >= cutoff
  );
}

export function HeroChart({ snapshots }: HeroChartProps) {
  const [range, setRange] = useState<TimeRange>("all");

  const data = useMemo(() => {
    const filtered = filterByRange(snapshots, range);
    return filtered.map((s) => ({
      time: new Date(s.snapshot_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      value: Number(s.total_value.toFixed(2)),
    }));
  }, [snapshots, range]);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-border bg-card">
        <p className="text-sm text-muted-foreground">
          Portfolio chart will appear after first snapshot.
        </p>
      </div>
    );
  }

  const first = data[0].value;
  const last = data[data.length - 1].value;
  const isGain = last >= first;
  const strokeColor = isGain ? chartColors.success : chartColors.destructive;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>
      <div className="h-48 w-full md:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="heroGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.2} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              {...chartAxisProps}
              interval="preserveStartEnd"
            />
            <YAxis
              {...chartAxisProps}
              tickFormatter={(v: number) => `$${v.toLocaleString()}`}
              width={70}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelStyle={{ color: chartColors.tooltipLabel }}
              formatter={(value: number) => [
                `$${value.toLocaleString()}`,
                "Value",
              ]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              strokeWidth={2}
              fill="url(#heroGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
