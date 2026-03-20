"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
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

interface StrategyComparisonChartProps {
  predictions: EnrichedPrediction[];
}

interface StrategyData {
  strategy: string;
  accuracy: number;
  avgEdge: number;
  predictions: number;
  trades: number;
}

export function StrategyComparisonChart({
  predictions,
}: StrategyComparisonChartProps) {
  if (predictions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          Strategy Comparison
        </h3>
        <div className="flex h-64 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No predictions yet
          </p>
        </div>
      </div>
    );
  }

  const strategyMap = new Map<
    string,
    {
      correct: number;
      resolved: number;
      totalEdge: number;
      predictions: number;
      trades: number;
    }
  >();

  for (const p of predictions) {
    const name = p.strategy_name ?? "Manual";
    const entry = strategyMap.get(name) ?? {
      correct: 0,
      resolved: 0,
      totalEdge: 0,
      predictions: 0,
      trades: 0,
    };

    entry.predictions++;
    entry.totalEdge += p.edge;

    if (p.status === "correct" || p.status === "incorrect") {
      entry.resolved++;
      if (p.status === "correct") {
        entry.correct++;
      }
    }

    if (p.trade_status !== null) {
      entry.trades++;
    }

    strategyMap.set(name, entry);
  }

  const data: StrategyData[] = Array.from(strategyMap.entries())
    .map(([strategy, stats]) => ({
      strategy,
      accuracy:
        stats.resolved > 0
          ? Math.round((stats.correct / stats.resolved) * 100)
          : 0,
      avgEdge:
        stats.predictions > 0
          ? Math.round((stats.totalEdge / stats.predictions) * 10000) / 100
          : 0,
      predictions: stats.predictions,
      trades: stats.trades,
    }))
    .sort((a, b) => b.accuracy - a.accuracy);

  const chartHeight = Math.max(256, data.length * 48);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        Strategy Comparison
      </h3>
      <div className="w-full" style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#27272a"
              horizontal={false}
            />
            <XAxis
              type="number"
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              tickLine={false}
              axisLine={{ stroke: "#27272a" }}
              tickFormatter={(v: number) => `${v}%`}
            />
            <YAxis
              type="category"
              dataKey="strategy"
              tick={{ fontSize: 11, fill: "#a1a1aa" }}
              tickLine={false}
              axisLine={{ stroke: "#27272a" }}
              width={100}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #27272a",
                borderRadius: "8px",
                fontSize: 12,
              }}
              labelStyle={{ color: "#a1a1aa" }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0].payload as StrategyData;
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
                    <p style={{ color: "#e4e4e7", fontWeight: 600, marginBottom: 4 }}>
                      {d.strategy}
                    </p>
                    <p style={{ color: d.accuracy > 50 ? "#22c55e" : "#ef4444" }}>
                      Accuracy: {d.accuracy}%
                    </p>
                    <p style={{ color: "#e4e4e7" }}>
                      Avg Edge: {d.avgEdge}¢
                    </p>
                    <p style={{ color: "#a1a1aa" }}>
                      Predictions: {d.predictions}
                    </p>
                    <p style={{ color: "#a1a1aa" }}>
                      Trades: {d.trades}
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="accuracy" radius={[0, 4, 4, 0]} barSize={24}>
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.accuracy > 50 ? "#22c55e" : "#ef4444"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
