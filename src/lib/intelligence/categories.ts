import { createServerClient } from "@/lib/supabase/server";

export interface CategoryPerformance {
  category: string;
  trade_count: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
  avg_edge: number;
  best_strategy: string | null;
}

export async function getCategoryPerformance(): Promise<CategoryPerformance[]> {
  const supabase = createServerClient();

  // Get closed trades joined with markets and events for category
  const { data: trades } = await supabase
    .from("paper_trades")
    .select(`
      pnl,
      strategy_id,
      ticker,
      markets!inner(event_ticker, events!inner(category))
    `)
    .eq("status", "closed")
    .not("pnl", "is", null);

  if (!trades || trades.length === 0) return [];

  // Get predictions for edge data
  const { data: predictions } = await supabase
    .from("predictions")
    .select("ticker, edge, strategy_id")
    .in("status", ["correct", "incorrect"]);

  const edgeByTicker = new Map<string, number>();
  for (const p of predictions ?? []) {
    edgeByTicker.set(p.ticker, p.edge);
  }

  // Aggregate by category
  const categoryMap = new Map<string, {
    trades: { pnl: number; strategy_id: string | null; edge: number }[];
  }>();

  for (const t of trades) {
    const market = t.markets as unknown as { event_ticker: string; events: { category: string | null } };
    const category = market.events.category ?? "unknown";

    if (!categoryMap.has(category)) {
      categoryMap.set(category, { trades: [] });
    }
    categoryMap.get(category)!.trades.push({
      pnl: t.pnl ?? 0,
      strategy_id: t.strategy_id,
      edge: edgeByTicker.get(t.ticker) ?? 0,
    });
  }

  // Compute per-category stats
  const results: CategoryPerformance[] = [];

  for (const [category, data] of categoryMap) {
    const wins = data.trades.filter((t) => t.pnl > 0).length;
    const totalPnl = data.trades.reduce((sum, t) => sum + t.pnl, 0);
    const avgEdge = data.trades.reduce((sum, t) => sum + t.edge, 0) / data.trades.length;

    // Find best strategy in this category
    const strategyPnl = new Map<string, number>();
    for (const t of data.trades) {
      if (t.strategy_id) {
        strategyPnl.set(t.strategy_id, (strategyPnl.get(t.strategy_id) ?? 0) + t.pnl);
      }
    }
    let bestStrategy: string | null = null;
    let bestPnl = -Infinity;
    for (const [sid, pnl] of strategyPnl) {
      if (pnl > bestPnl) {
        bestPnl = pnl;
        bestStrategy = sid;
      }
    }

    results.push({
      category,
      trade_count: data.trades.length,
      wins,
      losses: data.trades.length - wins,
      win_rate: Math.round((wins / data.trades.length) * 1000) / 10,
      total_pnl: Math.round(totalPnl * 100) / 100,
      avg_pnl: Math.round((totalPnl / data.trades.length) * 100) / 100,
      avg_edge: Math.round(avgEdge * 100) / 100,
      best_strategy: bestStrategy,
    });
  }

  // Sort by total P&L descending
  results.sort((a, b) => b.total_pnl - a.total_pnl);

  return results;
}
