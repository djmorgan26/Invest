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
        new Date(a.resolved_at!).getTime() - new Date(b.resolved_at!).getTime()
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
        accuracy: total > 0 ? Math.round((counts.correct / total) * 100) : 0,
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
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              tickLine={false}
              axisLine={{ stroke: "#27272a" }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              tickLine={false}
              axisLine={{ stroke: "#27272a" }}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #27272a",
                borderRadius: "8px",
                fontSize: 12,
              }}
              labelStyle={{ color: "#a1a1aa" }}
              formatter={(value: number, name: string) => {
                if (name === "accuracy") return [`${value}%`, "Accuracy"];
                return [value, name];
              }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0].payload as AccuracyBucket;
                return (
                  <div
                    style={{
                      backgroundColor: "#18181b",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      fontSize: 12,
                      padding: "8px 12px",
                    }}
                  >
                    <p style={{ color: "#a1a1aa", marginBottom: 4 }}>{label}</p>
                    <p style={{ color: "#22c55e" }}>
                      Accuracy: {d.accuracy}%
                    </p>
                    <p style={{ color: "#e4e4e7" }}>
                      Correct: {d.correct} | Incorrect: {d.incorrect}
                    </p>
                    <p style={{ color: "#a1a1aa" }}>Total: {d.total}</p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="accuracy"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#accuracyGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
