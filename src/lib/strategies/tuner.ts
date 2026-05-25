import { createServerClient } from "@/lib/supabase/server";
import type { StrategyConfig } from "./types";

const MIN_TRADES_TO_TUNE = 30;

interface TuneResult {
  strategy_id: string;
  changed: boolean;
  before: StrategyConfig;
  after: StrategyConfig;
  reason: string;
}

export async function tuneStrategy(strategyId: string): Promise<TuneResult> {
  const supabase = await createServerClient();

  // Get current strategy config
  const { data: strategy } = await supabase
    .from("strategies")
    .select("id, config")
    .eq("id", strategyId)
    .single();

  if (!strategy) {
    return { strategy_id: strategyId, changed: false, before: {}, after: {}, reason: "Strategy not found" };
  }

  const currentConfig = (strategy.config ?? {}) as StrategyConfig;

  // Get all resolved trades for this strategy with their prediction edge
  const { data: trades } = await supabase
    .from("paper_trades")
    .select("pnl, price, side, ticker, created_at, prediction_id")
    .eq("strategy_id", strategyId)
    .eq("status", "closed");

  if (!trades || trades.length < MIN_TRADES_TO_TUNE) {
    return {
      strategy_id: strategyId,
      changed: false,
      before: currentConfig,
      after: currentConfig,
      reason: `Only ${trades?.length ?? 0} resolved trades, need ${MIN_TRADES_TO_TUNE}`,
    };
  }

  // Get predictions for these trades to analyze edge distribution
  const predIds = trades.map((t) => t.prediction_id).filter(Boolean);
  const { data: predictions } = await supabase
    .from("predictions")
    .select("id, edge, confidence")
    .in("id", predIds);

  const predMap = new Map((predictions ?? []).map((p) => [p.id, p]));

  // Analyze: bin trades by edge ranges and see win rates
  const bins = new Map<string, { wins: number; total: number; pnl: number }>();

  for (const trade of trades) {
    const pred = predMap.get(trade.prediction_id);
    const edge = pred?.edge ?? 0;
    const bin = edge < 0.05 ? "<5c" : edge < 0.08 ? "5-8c" : edge < 0.12 ? "8-12c" : "12c+";

    const entry = bins.get(bin) ?? { wins: 0, total: 0, pnl: 0 };
    entry.total++;
    entry.pnl += trade.pnl ?? 0;
    if ((trade.pnl ?? 0) > 0) entry.wins++;
    bins.set(bin, entry);
  }

  // Determine optimal edge threshold
  let newConfig = { ...currentConfig };
  const changes: string[] = [];

  // Strategy-specific tuning
  switch (strategyId) {
    case "wide-spread": {
      // Analyze spread thresholds
      const lowEdge = bins.get("<5c");
      const midEdge = bins.get("5-8c");
      const highEdge = bins.get("8-12c");

      // If low-edge trades are unprofitable, raise the threshold
      if (lowEdge && lowEdge.total >= 5 && lowEdge.wins / lowEdge.total < 0.45) {
        const oldMin = (currentConfig.min_spread as number) ?? 0.10;
        newConfig.min_spread = Math.min(oldMin + 0.02, 0.20);
        changes.push(`Raised min_spread: ${oldMin} → ${newConfig.min_spread} (low-edge win rate: ${((lowEdge.wins / lowEdge.total) * 100).toFixed(0)}%)`);
      }

      // If high-edge trades are very profitable, potentially lower volume threshold
      if (highEdge && highEdge.total >= 5 && highEdge.wins / highEdge.total > 0.65) {
        const oldVol = (currentConfig.min_volume as number) ?? 100;
        if (oldVol > 50) {
          newConfig.min_volume = Math.max(oldVol - 25, 50);
          changes.push(`Lowered min_volume: ${oldVol} → ${newConfig.min_volume} (high-edge trades are profitable)`);
        }
      }
      break;
    }

    case "extreme-value": {
      // Analyze price threshold effectiveness
      const winningTrades = trades.filter((t) => (t.pnl ?? 0) > 0);
      const losingTrades = trades.filter((t) => (t.pnl ?? 0) <= 0);

      const avgWinPrice = winningTrades.length > 0
        ? winningTrades.reduce((s, t) => s + t.price, 0) / winningTrades.length
        : 0;
      const avgLosePrice = losingTrades.length > 0
        ? losingTrades.reduce((s, t) => s + t.price, 0) / losingTrades.length
        : 0;

      // If losing trades tend to be at higher prices, tighten the threshold
      if (avgLosePrice > avgWinPrice && losingTrades.length >= 5) {
        const oldLow = (currentConfig.low_threshold as number) ?? 0.05;
        newConfig.low_threshold = Math.max(oldLow - 0.01, 0.02);
        const oldHigh = (currentConfig.high_threshold as number) ?? 0.95;
        newConfig.high_threshold = Math.min(oldHigh + 0.01, 0.98);
        changes.push(`Tightened thresholds: low ${oldLow} → ${newConfig.low_threshold}, high ${oldHigh} → ${newConfig.high_threshold}`);
      }
      break;
    }

    case "mean-reversion": {
      // Analyze minimum move effectiveness
      const overallWinRate = trades.filter((t) => (t.pnl ?? 0) > 0).length / trades.length;

      if (overallWinRate < 0.50) {
        const oldMove = (currentConfig.min_move as number) ?? 0.15;
        newConfig.min_move = Math.min(oldMove + 0.03, 0.30);
        changes.push(`Raised min_move: ${oldMove} → ${newConfig.min_move} (win rate: ${(overallWinRate * 100).toFixed(0)}%)`);
      }

      if (overallWinRate > 0.65) {
        const oldFactor = (currentConfig.reversion_factor as number) ?? 0.5;
        newConfig.reversion_factor = Math.min(oldFactor + 0.1, 0.8);
        changes.push(`Raised reversion_factor: ${oldFactor} → ${newConfig.reversion_factor} (high win rate)`);
      }
      break;
    }

    case "stale-price": {
      // Widen or narrow the settlement window based on results
      const overallWinRate = trades.filter((t) => (t.pnl ?? 0) > 0).length / trades.length;

      if (overallWinRate < 0.50) {
        const oldMax = (currentConfig.max_hours_since_settlement as number) ?? 48;
        newConfig.max_hours_since_settlement = Math.max(oldMax - 6, 12);
        changes.push(`Narrowed max_hours: ${oldMax} → ${newConfig.max_hours_since_settlement} (win rate: ${(overallWinRate * 100).toFixed(0)}%)`);
      }
      break;
    }
  }

  if (changes.length === 0) {
    return {
      strategy_id: strategyId,
      changed: false,
      before: currentConfig,
      after: currentConfig,
      reason: "No parameter changes warranted based on current data",
    };
  }

  // Write updated config
  await supabase
    .from("strategies")
    .update({ config: newConfig })
    .eq("id", strategyId);

  // Log the learning
  const description = changes.join("; ");
  await supabase.from("strategy_learnings").insert({
    strategy_id: strategyId,
    learning_type: "param_change",
    description,
    data: {
      before: currentConfig,
      after: newConfig,
      total_trades: trades.length,
      overall_win_rate: trades.filter((t) => (t.pnl ?? 0) > 0).length / trades.length,
      edge_bins: Object.fromEntries(bins),
    },
  });

  return {
    strategy_id: strategyId,
    changed: true,
    before: currentConfig,
    after: newConfig,
    reason: description,
  };
}

export async function tuneAll(): Promise<TuneResult[]> {
  const supabase = await createServerClient();
  const { data: strategies } = await supabase
    .from("strategies")
    .select("id");

  const results: TuneResult[] = [];
  for (const s of strategies ?? []) {
    const result = await tuneStrategy(s.id);
    results.push(result);
  }
  return results;
}
