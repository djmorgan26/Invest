"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
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

interface LinkedTrade {
  id: string;
  prediction_id: string;
  pnl: number | null;
  status: string;
  strategy_id: string | null;
  created_at: string;
  closed_at: string | null;
}

interface CumulativePnlChartProps {
  predictions: EnrichedPrediction[];
  trades: LinkedTrade[];
}

interface PnlDataPoint {
  date: string;
  pnl: number;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDollar(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${value.toFixed(2)}`;
}

export function CumulativePnlChart({
  predictions,
}: CumulativePnlChartProps) {
  const withPnl = predictions
    .filter((p) => p.trade_pnl !== null && p.resolved_at !== null)
    .sort(
      (a, b) =>
        new Date(a.resolved_at!).getTime() - new Date(b.resolved_at!).getTime()
    );

  if (withPnl.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          Cumulative P&L from Predictions
        </h3>
        <div className="flex h-64 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No resolved trades with P&L yet
          </p>
        </div>
      </div>
    );
  }

  let cumulative = 0;
  const data: PnlDataPoint[] = withPnl.map((p) => {
    cumulative += p.trade_pnl!;
    return {
      date: formatDate(p.resolved_at!),
      pnl: Math.round(cumulative * 100) / 100,
    };
  });

  const finalPnl = data[data.length - 1]?.pnl ?? 0;
  const lineColor =
    finalPnl >= 0 ? chartColors.success : chartColors.destructive;
  const gradientId = "cumulativePnlGradient";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        Cumulative P&L from Predictions
      </h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={lineColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...chartGridProps} />
            <XAxis dataKey="date" {...chartAxisProps} />
            <YAxis
              {...chartAxisProps}
              tickFormatter={(v: number) => `$${v}`}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelStyle={{ color: chartColors.tooltipLabel }}
              formatter={(value: number) => [formatDollar(value), "P&L"]}
            />
            <ReferenceLine
              y={0}
              stroke={chartColors.grid}
              strokeDasharray="3 3"
            />
            <Area
              type="monotone"
              dataKey="pnl"
              stroke={lineColor}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
