"use client";

import { useState, useMemo } from "react";
import {
  TimeRange,
  TimeRangeSelector,
} from "@/components/charts/time-range-selector";
import { PredictionAccuracyChart } from "@/components/charts/prediction-accuracy-chart";
import { EdgeDistributionChart } from "@/components/charts/edge-distribution-chart";
import { StrategyComparisonChart } from "@/components/charts/strategy-comparison-chart";
import { CumulativePnlChart } from "@/components/charts/cumulative-pnl-chart";

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

interface ChartsSectionProps {
  predictions: EnrichedPrediction[];
  trades: LinkedTrade[];
}

function getFilterDate(range: TimeRange): Date | null {
  if (range === "all") return null;

  const now = new Date();

  switch (range) {
    case "1d":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "1w":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "1m":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "3m":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

export function ChartsSection({ predictions, trades }: ChartsSectionProps) {
  const [range, setRange] = useState<TimeRange>("all");

  const filteredPredictions = useMemo(() => {
    const cutoff = getFilterDate(range);
    if (!cutoff) return predictions;
    return predictions.filter(
      (p) => new Date(p.created_at).getTime() >= cutoff.getTime()
    );
  }, [predictions, range]);

  const filteredTrades = useMemo(() => {
    const cutoff = getFilterDate(range);
    if (!cutoff) return trades;
    return trades.filter(
      (t) => new Date(t.created_at).getTime() >= cutoff.getTime()
    );
  }, [trades, range]);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Performance Analytics</h2>
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PredictionAccuracyChart predictions={filteredPredictions} />
        <EdgeDistributionChart predictions={filteredPredictions} />
        <StrategyComparisonChart predictions={filteredPredictions} />
        <CumulativePnlChart
          predictions={filteredPredictions}
          trades={filteredTrades}
        />
      </div>
    </section>
  );
}
