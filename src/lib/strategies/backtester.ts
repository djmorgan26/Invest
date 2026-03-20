import type { Prediction, PaperTrade } from "@/lib/supabase/types";

export interface BacktestInput {
  strategies: string[];
  period: string; // "1w" | "1m" | "3m" | "6m" | "all"
  budget: number;
}

export interface BacktestResult {
  equityCurve: { date: string; value: number }[];
  stats: {
    totalReturn: number;
    totalReturnPct: number;
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    totalTrades: number;
    wins: number;
    losses: number;
  };
  trades: {
    ticker: string;
    side: "yes" | "no";
    entryPrice: number;
    exitPrice: number | null;
    quantity: number;
    pnl: number;
    date: string;
    closedAt: string | null;
  }[];
}

function getPeriodCutoff(period: string): Date | null {
  if (period === "all") return null;

  const now = new Date();
  switch (period) {
    case "1w":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "1m":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "3m":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "6m":
      return new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

export function runBacktest(
  predictions: Prediction[],
  paperTrades: PaperTrade[],
  input: BacktestInput
): BacktestResult {
  const cutoff = getPeriodCutoff(input.period);

  // Filter predictions by selected strategy IDs
  const filteredPredictions = predictions.filter(
    (p) => p.strategy_id !== null && input.strategies.includes(p.strategy_id)
  );

  const predictionIds = new Set(filteredPredictions.map((p) => p.id));

  // Match paper trades to predictions, only closed/expired with pnl
  const matchedTrades = paperTrades.filter((t) => {
    if (t.prediction_id === null || !predictionIds.has(t.prediction_id)) {
      return false;
    }
    if (t.status !== "closed" && t.status !== "expired") return false;
    if (t.pnl === null) return false;
    if (t.closed_at === null) return false;
    if (cutoff && new Date(t.closed_at) < cutoff) return false;
    return true;
  });

  // Sort by closed_at chronologically
  matchedTrades.sort(
    (a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime()
  );

  // Replay equity curve
  let portfolioValue = input.budget;
  let peak = input.budget;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let wins = 0;
  let losses = 0;
  const tradeReturns: number[] = [];

  const equityCurve: { date: string; value: number }[] = [
    { date: matchedTrades.length > 0 ? matchedTrades[0].closed_at! : new Date().toISOString(), value: input.budget },
  ];

  const resultTrades: BacktestResult["trades"] = [];

  for (const trade of matchedTrades) {
    const pnl = trade.pnl!;
    portfolioValue += pnl;

    if (pnl > 0) {
      wins++;
    } else {
      losses++;
    }

    // Track return for Sharpe calculation
    const tradeReturn = trade.price > 0 ? pnl / (trade.price * trade.quantity) : 0;
    tradeReturns.push(tradeReturn);

    // Update peak and drawdown
    if (portfolioValue > peak) {
      peak = portfolioValue;
    }
    const currentDrawdown = peak - portfolioValue;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
      maxDrawdownPct = peak > 0 ? (currentDrawdown / peak) * 100 : 0;
    }

    equityCurve.push({
      date: trade.closed_at!,
      value: Number(portfolioValue.toFixed(2)),
    });

    resultTrades.push({
      ticker: trade.ticker,
      side: trade.side,
      entryPrice: trade.price,
      exitPrice: trade.exit_price,
      quantity: trade.quantity,
      pnl,
      date: trade.created_at,
      closedAt: trade.closed_at,
    });
  }

  const totalTrades = wins + losses;
  const totalReturn = portfolioValue - input.budget;
  const totalReturnPct = input.budget > 0 ? (totalReturn / input.budget) * 100 : 0;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  // Sharpe ratio: annualized from trade returns
  let sharpeRatio = 0;
  if (tradeReturns.length >= 2) {
    const meanReturn =
      tradeReturns.reduce((sum, r) => sum + r, 0) / tradeReturns.length;
    const variance =
      tradeReturns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) /
      (tradeReturns.length - 1);
    const stddev = Math.sqrt(variance);
    if (stddev > 0) {
      sharpeRatio = Number(((meanReturn / stddev) * Math.sqrt(252)).toFixed(2));
    }
  }

  return {
    equityCurve,
    stats: {
      totalReturn: Number(totalReturn.toFixed(2)),
      totalReturnPct: Number(totalReturnPct.toFixed(2)),
      winRate: Number(winRate.toFixed(1)),
      sharpeRatio,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      totalTrades,
      wins,
      losses,
    },
    trades: resultTrades,
  };
}
