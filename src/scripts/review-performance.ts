import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  try {
    const report: Record<string, unknown> = {};

    // 1. Overall portfolio state
    const { data: latestSnapshot } = await supabase
      .from("portfolio_snapshots")
      .select("*")
      .order("snapshot_at", { ascending: false })
      .limit(1)
      .single();

    report.portfolio = latestSnapshot ?? { note: "No portfolio snapshots yet" };

    // 2. Per-strategy performance
    const { data: strategies } = await supabase
      .from("strategies")
      .select("*");

    const strategyPerf = [];
    for (const s of strategies ?? []) {
      const { data: closedTrades } = await supabase
        .from("paper_trades")
        .select("pnl, price, side, ticker, closed_at, cost")
        .eq("strategy_id", s.id)
        .eq("status", "closed")
        .order("closed_at", { ascending: false });

      const { data: openTrades } = await supabase
        .from("paper_trades")
        .select("ticker, side, price, cost")
        .eq("strategy_id", s.id)
        .eq("status", "open");

      const trades = closedTrades ?? [];
      const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
      const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

      // Best and worst trades
      const sorted = [...trades].sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0));
      const best = sorted.slice(0, 3).map((t) => ({
        ticker: t.ticker,
        side: t.side,
        pnl: t.pnl,
        price: t.price,
      }));
      const worst = sorted.slice(-3).reverse().map((t) => ({
        ticker: t.ticker,
        side: t.side,
        pnl: t.pnl,
        price: t.price,
      }));

      strategyPerf.push({
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        config: s.config,
        closed_trades: trades.length,
        open_trades: openTrades?.length ?? 0,
        wins,
        losses: trades.length - wins,
        win_rate: trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 10 + "%" : "N/A",
        total_pnl: Math.round(totalPnl * 100) / 100,
        avg_pnl: trades.length > 0 ? Math.round((totalPnl / trades.length) * 100) / 100 : 0,
        best_trades: best,
        worst_trades: worst,
      });
    }
    report.strategies = strategyPerf;

    // 3. Recent learnings
    const { data: learnings } = await supabase
      .from("strategy_learnings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    report.recent_learnings = (learnings ?? []).map((l) => ({
      strategy_id: l.strategy_id,
      type: l.learning_type,
      description: l.description,
      created_at: l.created_at,
    }));

    // 4. Overall stats
    const { data: allClosed } = await supabase
      .from("paper_trades")
      .select("pnl, created_at")
      .eq("status", "closed")
      .order("created_at", { ascending: true });

    const allTrades = allClosed ?? [];
    const totalResolved = allTrades.length;
    const totalWins = allTrades.filter((t) => (t.pnl ?? 0) > 0).length;
    const totalPnl = allTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

    // Drawdown calculation
    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;
    for (const t of allTrades) {
      cumulative += t.pnl ?? 0;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Sharpe ratio (simplified — daily returns)
    const dailyPnl = new Map<string, number>();
    for (const t of allTrades) {
      const day = t.created_at.slice(0, 10);
      dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + (t.pnl ?? 0));
    }
    const returns = Array.from(dailyPnl.values());
    const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
      : 0;
    const dailySharpe = stdDev > 0 ? avgReturn / stdDev : 0;
    const annualizedSharpe = dailySharpe * Math.sqrt(252);

    report.overall = {
      total_resolved: totalResolved,
      total_wins: totalWins,
      win_rate: totalResolved > 0 ? Math.round((totalWins / totalResolved) * 1000) / 10 + "%" : "N/A",
      total_pnl: Math.round(totalPnl * 100) / 100,
      max_drawdown: Math.round(maxDrawdown * 100) / 100,
      sharpe_ratio: Math.round(annualizedSharpe * 100) / 100,
      trading_days: dailyPnl.size,
    };

    // 5. Go-live readiness
    report.go_live_readiness = {
      resolved_trades: { value: totalResolved, target: 200, met: totalResolved >= 200 },
      win_rate: {
        value: totalResolved > 0 ? Math.round((totalWins / totalResolved) * 1000) / 10 : 0,
        target: 55,
        met: totalResolved > 0 && totalWins / totalResolved > 0.55,
      },
      total_pnl: { value: Math.round(totalPnl * 100) / 100, target: 0, met: totalPnl > 0 },
      sharpe: { value: Math.round(annualizedSharpe * 100) / 100, target: 1.0, met: annualizedSharpe > 1.0 },
      max_drawdown_pct: {
        value: Math.round((maxDrawdown / 10000) * 10000) / 100,
        target: 15,
        met: maxDrawdown / 10000 < 0.15,
      },
    };

    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ status: "error", error: errorMessage }));
    process.exit(1);
  }
}

main();
