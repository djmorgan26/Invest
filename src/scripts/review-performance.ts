import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { wilsonScoreInterval, isWinRateSignificant } from "@/lib/stats/wilson";

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

      const ci = wilsonScoreInterval(wins, trades.length);

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
        win_rate_ci_lower: Math.round(ci.lower * 1000) / 10,
        win_rate_ci_upper: Math.round(ci.upper * 1000) / 10,
        win_rate_significant: isWinRateSignificant(wins, trades.length, 0.50),
        total_pnl: Math.round(totalPnl * 100) / 100,
        avg_pnl: trades.length > 0 ? Math.round((totalPnl / trades.length) * 100) / 100 : 0,
        best_trades: best,
        worst_trades: worst,
      });
    }
    report.strategies = strategyPerf;

    // 3. Category performance breakdown
    const { data: categoryTrades } = await supabase
      .from("paper_trades")
      .select("pnl, ticker, strategy_id")
      .eq("status", "closed")
      .not("pnl", "is", null);

    if (categoryTrades && categoryTrades.length > 0) {
      // Get market → event → category mapping
      const tickers = [...new Set(categoryTrades.map((t) => t.ticker))];
      const { data: markets } = await supabase
        .from("markets")
        .select("ticker, event_ticker")
        .in("ticker", tickers);

      const eventTickers = [...new Set((markets ?? []).map((m) => m.event_ticker))];
      const { data: events } = await supabase
        .from("events")
        .select("event_ticker, category")
        .in("event_ticker", eventTickers);

      const tickerToCategory = new Map<string, string>();
      const marketMap = new Map((markets ?? []).map((m) => [m.ticker, m.event_ticker]));
      const eventMap = new Map((events ?? []).map((e) => [e.event_ticker, e.category ?? "unknown"]));
      for (const [ticker, eventTicker] of marketMap) {
        tickerToCategory.set(ticker, eventMap.get(eventTicker) ?? "unknown");
      }

      const catStats = new Map<string, { count: number; wins: number; pnl: number }>();
      for (const t of categoryTrades) {
        const cat = tickerToCategory.get(t.ticker) ?? "unknown";
        const existing = catStats.get(cat) ?? { count: 0, wins: 0, pnl: 0 };
        existing.count++;
        if ((t.pnl ?? 0) > 0) existing.wins++;
        existing.pnl += t.pnl ?? 0;
        catStats.set(cat, existing);
      }

      report.categories = Array.from(catStats.entries())
        .map(([cat, stats]) => ({
          category: cat,
          trades: stats.count,
          wins: stats.wins,
          win_rate: Math.round((stats.wins / stats.count) * 1000) / 10 + "%",
          total_pnl: Math.round(stats.pnl * 100) / 100,
          avg_pnl: Math.round((stats.pnl / stats.count) * 100) / 100,
        }))
        .sort((a, b) => b.total_pnl - a.total_pnl);
    } else {
      report.categories = [];
    }

    // 4. Recent learnings
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

    // 5. Overall stats
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

    const overallCi = wilsonScoreInterval(totalWins, totalResolved);

    report.overall = {
      total_resolved: totalResolved,
      total_wins: totalWins,
      win_rate: totalResolved > 0 ? Math.round((totalWins / totalResolved) * 1000) / 10 + "%" : "N/A",
      win_rate_ci_lower: Math.round(overallCi.lower * 1000) / 10,
      win_rate_ci_upper: Math.round(overallCi.upper * 1000) / 10,
      win_rate_significant: isWinRateSignificant(totalWins, totalResolved, 0.50),
      total_pnl: Math.round(totalPnl * 100) / 100,
      max_drawdown: Math.round(maxDrawdown * 100) / 100,
      sharpe_ratio: Math.round(annualizedSharpe * 100) / 100,
      trading_days: dailyPnl.size,
    };

    // 6. Go-live readiness
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

    // 7. Write review to database
    const summary = buildSummary(report);
    const recommendations = buildRecommendations(report);
    const metrics = {
      total_resolved: totalResolved,
      win_rate: totalResolved > 0 ? Math.round((totalWins / totalResolved) * 1000) / 10 : 0,
      total_pnl: Math.round(totalPnl * 100) / 100,
      sharpe: Math.round(annualizedSharpe * 100) / 100,
      max_drawdown: Math.round(maxDrawdown * 100) / 100,
    };

    await supabase.from("reviews").insert({
      review_type: "weekly",
      summary,
      recommendations,
      metrics,
    });

    report.generated_at = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ status: "error", error: errorMessage }));
    process.exit(1);
  }
}

function buildSummary(report: Record<string, unknown>): string {
  const overall = report.overall as Record<string, unknown>;
  const strategies = report.strategies as Array<Record<string, unknown>>;

  const parts = [
    `Performance report: ${overall.total_resolved} resolved trades, ` +
    `${overall.win_rate} win rate, $${overall.total_pnl} total P&L, ` +
    `Sharpe ${overall.sharpe_ratio}.`,
  ];

  for (const s of strategies) {
    const status = s.enabled ? "active" : "DISABLED";
    parts.push(
      `${s.name} (${status}): ${s.closed_trades} trades, ${s.win_rate} win rate, $${s.total_pnl} P&L.`
    );
  }

  return parts.join("\n");
}

function buildRecommendations(report: Record<string, unknown>): { action: string; priority: string; reasoning: string }[] {
  const recommendations: { action: string; priority: string; reasoning: string }[] = [];
  const strategies = report.strategies as Array<Record<string, unknown>>;
  const overall = report.overall as Record<string, unknown>;

  // Check for bleeding strategies
  for (const s of strategies) {
    if ((s.total_pnl as number) < -100) {
      recommendations.push({
        action: `Review ${s.name} strategy — significant losses`,
        priority: "high",
        reasoning: `${s.name} has $${s.total_pnl} P&L with ${s.win_rate} win rate. Consider disabling or re-parameterizing.`,
      });
    }
  }

  // Check go-live readiness gaps
  if ((overall.total_resolved as number) < 50) {
    recommendations.push({
      action: "Increase trade volume — need more data",
      priority: "medium",
      reasoning: `Only ${overall.total_resolved} resolved trades. Need 200+ for go-live assessment. Check if strategies are finding opportunities.`,
    });
  }

  // Default recommendation
  if (recommendations.length === 0) {
    recommendations.push({
      action: "Continue monitoring — system operating normally",
      priority: "low",
      reasoning: "No critical issues detected. Keep collecting data toward go-live thresholds.",
    });
  }

  return recommendations;
}

main();
