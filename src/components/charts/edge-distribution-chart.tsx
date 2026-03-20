"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
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

interface EdgeDistributionChartProps {
  predictions: EnrichedPrediction[];
}

interface EdgeBucket {
  bucket: string;
  correct: number;
  incorrect: number;
  pending: number;
}

const BUCKET_SIZE = 2.5;
const BUCKET_MIN = -10;
const BUCKET_MAX = 15;

function getBucketLabel(lower: number): string {
  const sign = lower >= 0 ? "+" : "";
  return `${sign}${lower}¢`;
}

export function EdgeDistributionChart({
  predictions,
}: EdgeDistributionChartProps) {
  if (predictions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          Edge Distribution
        </h3>
        <div className="flex h-64 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No predictions yet
          </p>
        </div>
      </div>
    );
  }

  const buckets: EdgeBucket[] = [];
  for (let lower = BUCKET_MIN; lower < BUCKET_MAX; lower += BUCKET_SIZE) {
    buckets.push({
      bucket: getBucketLabel(lower),
      correct: 0,
      incorrect: 0,
      pending: 0,
    });
  }

  for (const p of predictions) {
    const edgeCents = p.edge * 100;
    let idx = Math.floor((edgeCents - BUCKET_MIN) / BUCKET_SIZE);
    idx = Math.max(0, Math.min(idx, buckets.length - 1));

    if (p.status === "correct") {
      buckets[idx].correct++;
    } else if (p.status === "incorrect") {
      buckets[idx].incorrect++;
    } else {
      buckets[idx].pending++;
    }
  }

  const filteredBuckets = buckets.filter(
    (b) => b.correct > 0 || b.incorrect > 0 || b.pending > 0
  );

  const data = filteredBuckets.length > 0 ? filteredBuckets : buckets;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        Edge Distribution
      </h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              tickLine={false}
              axisLine={{ stroke: "#27272a" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              tickLine={false}
              axisLine={{ stroke: "#27272a" }}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #27272a",
                borderRadius: "8px",
                fontSize: 12,
              }}
              labelStyle={{ color: "#a1a1aa" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconSize={10}
            />
            <Bar
              dataKey="correct"
              stackId="a"
              fill="#22c55e"
              name="Correct"
            />
            <Bar
              dataKey="incorrect"
              stackId="a"
              fill="#ef4444"
              name="Incorrect"
            />
            <Bar
              dataKey="pending"
              stackId="a"
              fill="#71717a"
              name="Pending"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
