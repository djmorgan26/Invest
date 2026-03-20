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
import {
  chartColors,
  chartTooltipStyle,
  chartAxisProps,
  chartGridProps,
} from "@/lib/chart-theme";

interface EnrichedPrediction {
  id: string;
  ticker: string;
  side: "yes" | "no";
  confidence: number;
  fair_value: number;
  edge: number;
  reasoning: string;
  status: string;
  strategy_id: string | null;
  created_at: string;
  resolved_at: string | null;
  market_title: string | null;
  event_category: string | null;
  current_price: number | null;
  close_time: string | null;
  strategy_name: string | null;
  trade_pnl: number | null;
  trade_status: string | null;
}

interface PredictionAccuracyChartProps {
  predictions: EnrichedPrediction[];
}

interface AccuracyBucket {
  date: string;
  accuracy: number;
  correct: number;
  incorrect: number;
  total: number;
}

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return start.toISOString().slice(0, 10);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PredictionAccuracyChart({
  predictions,
}: PredictionAccuracyChartProps) {
  const resolved = predictions
    .filter(
      (p) =>
        (p.status === "correct" || p.status === "incorrect") && p.resolved_at
    )
    .sort(
      (a, b) =>
        new Date(a.resolved_at!).getTime() -
        new Date(b.resolved_at!).getTime()
    );

  if (resolved.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          Prediction Accuracy
        </h3>
        <div className="flex h-64 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No resolved predictions yet
          </p>
        </div>
      </div>
    );
  }

  const weekMap = new Map<
    string,
    { correct: number; incorrect: number }
  >();

  for (const p of resolved) {
    const week = getWeekKey(p.resolved_at!);
    const entry = weekMap.get(week) ?? { correct: 0, incorrect: 0 };
    if (p.status === "correct") {
      entry.correct++;
    } else {
      entry.incorrect++;
    }
    weekMap.set(week, entry);
  }

  const data: AccuracyBucket[] = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, counts]) => {
      const total = counts.correct + counts.incorrect;
      return {
        date: formatDate(week),
        accuracy:
          total > 0 ? Math.round((counts.correct / total) * 100) : 0,
        correct: counts.correct,
        incorrect: counts.incorrect,
        total,
      };
    });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        Prediction Accuracy
      </h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient
                id="accuracyGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={chartColors.success}
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor={chartColors.success}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid {...chartGridProps} />
            <XAxis dataKey="date" {...chartAxisProps} />
            <YAxis
              domain={[0, 100]}
              {...chartAxisProps}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0)
                  return null;
                const d = payload[0].payload as AccuracyBucket;
                return (
                  <div
                    style={{
                      ...chartTooltipStyle,
                      padding: "8px 12px",
                    }}
                  >
                    <p
                      style={{
                        color: chartColors.tooltipLabel,
                        marginBottom: 4,
                      }}
                    >
                      {label}
                    </p>
                    <p style={{ color: chartColors.success }}>
                      Accuracy: {d.accuracy}%
                    </p>
                    <p style={{ color: chartColors.tooltipText }}>
                      Correct: {d.correct} | Incorrect: {d.incorrect}
                    </p>
                    <p style={{ color: chartColors.tooltipLabel }}>
                      Total: {d.total}
                    </p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="accuracy"
              stroke={chartColors.success}
              strokeWidth={2}
              fill="url(#accuracyGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
