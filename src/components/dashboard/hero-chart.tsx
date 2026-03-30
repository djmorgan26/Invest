"use client";

import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
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

function formatTime(date: Date, range: TimeRange): string {
  if (range === "1d") {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (range === "1w") {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      hour: "numeric",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function HeroChart({ snapshots }: HeroChartProps) {
  const [range, setRange] = useState<TimeRange>("1m");

  const data = useMemo(() => {
    const filtered = filterByRange(snapshots, range);
    return filtered.map((s) => ({
      time: formatTime(new Date(s.snapshot_at), range),
      value: Number(s.total_value.toFixed(2)),
    }));
  }, [snapshots, range]);

  const { yDomain, startValue } = useMemo(() => {
    if (data.length === 0) return { yDomain: [0, 100] as [number, number], startValue: 0 };
    const values = data.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min;
    const padding = Math.max(spread * 0.15, 5);
    return {
      yDomain: [
        Math.floor((min - padding) / 5) * 5,
        Math.ceil((max + padding) / 5) * 5,
      ] as [number, number],
      startValue: values[0],
    };
  }, [data]);

  // Deduplicate adjacent identical x-axis labels
  const deduped = useMemo(() => {
    let lastLabel = "";
    return data.map((d) => {
      if (d.time === lastLabel) {
        return { ...d, time: "" };
      }
      lastLabel = d.time;
      return d;
    });
  }, [data]);

  // Thin out labels so they don't overlap (~12 labels max)
  const tickInterval = useMemo(() => {
    const labelCount = deduped.filter((d) => d.time !== "").length;
    if (labelCount <= 12) return undefined;
    return Math.ceil(labelCount / 12);
  }, [deduped]);

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
          <AreaChart data={deduped}>
            <defs>
              <linearGradient id="heroGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.2} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              {...chartAxisProps}
              interval={tickInterval ?? "preserveStartEnd"}
            />
            <YAxis
              {...chartAxisProps}
              domain={yDomain}
              allowDecimals={false}
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
            <ReferenceLine
              y={startValue}
              stroke={chartColors.axisText}
              strokeDasharray="4 4"
              strokeOpacity={0.5}
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
