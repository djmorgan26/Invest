import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const cron = process.env.CRON_SECRET;
    // Allow both cron auth and unauthenticated dashboard access
    if (cron && authHeader && authHeader !== `Bearer ${cron}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerClient();

    // Get all closed trades with dates
    const { data: trades, error: tradesError } = await supabase
      .from("paper_trades")
      .select("ticker, side, quantity, price, cost, fee, pnl, strategy_id, status, created_at, closed_at")
      .eq("status", "closed")
      .order("closed_at", { ascending: false });

    if (tradesError) throw new Error(tradesError.message);

    // Get open trades for unrealized P&L
    const { data: openTrades } = await supabase
      .from("paper_trades")
      .select("ticker, side, quantity, price, cost, fee, strategy_id, created_at")
      .eq("status", "open");

    // Get portfolio snapshots for timeline
    const { data: portfolioSnapshots } = await supabase
      .from("portfolio_snapshots")
      .select("total_value, realized_pnl, unrealized_pnl, cash, snapshot_at")
      .order("snapshot_at", { ascending: true })
      .limit(500);

    // Group closed trades by date
    const dailyPnl = new Map<string, { date: string; pnl: number; trades: number; wins: number }>();
    for (const t of trades ?? []) {
      const date = t.closed_at ? t.closed_at.split("T")[0] : "unknown";
      if (!dailyPnl.has(date)) {
        dailyPnl.set(date, { date, pnl: 0, trades: 0, wins: 0 });
      }
      const day = dailyPnl.get(date)!;
      day.pnl += t.pnl ?? 0;
      day.trades += 1;
      if ((t.pnl ?? 0) > 0) day.wins += 1;
    }

    // Group by strategy
    const strategyPnl = new Map<string, { strategy_id: string; pnl: number; trades: number; wins: number }>();
    for (const t of trades ?? []) {
      const sid = t.strategy_id ?? "unknown";
      if (!strategyPnl.has(sid)) {
        strategyPnl.set(sid, { strategy_id: sid, pnl: 0, trades: 0, wins: 0 });
      }
      const s = strategyPnl.get(sid)!;
      s.pnl += t.pnl ?? 0;
      s.trades += 1;
      if ((t.pnl ?? 0) > 0) s.wins += 1;
    }

    // Compute go-live metrics
    const closedTrades = trades ?? [];
    const totalResolved = closedTrades.length;
    const totalWins = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
    const winRate = totalResolved > 0 ? totalWins / totalResolved : 0;
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const openCost = (openTrades ?? []).reduce((sum, t) => sum + (t.cost ?? 0), 0);

    // Sharpe ratio approximation (annualized from daily returns)
    const dailyReturns = Array.from(dailyPnl.values()).map((d) => d.pnl);
    const avgReturn = dailyReturns.length > 0
      ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
      : 0;
    const stdDev = dailyReturns.length > 1
      ? Math.sqrt(
          dailyReturns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1)
        )
      : 0;
    const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    // Max drawdown from portfolio snapshots
    let maxDrawdown = 0;
    let peak = 0;
    for (const snap of portfolioSnapshots ?? []) {
      if (snap.total_value > peak) peak = snap.total_value;
      if (peak > 0) {
        const dd = (peak - snap.total_value) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
    }

    // Worst single-strategy loss
    const worstStrategyLoss = Math.min(
      0,
      ...Array.from(strategyPnl.values()).map((s) => s.pnl)
    );

    return NextResponse.json({
      goLive: {
        resolved_trades: { value: totalResolved, threshold: 200, met: totalResolved >= 200 },
        win_rate: { value: winRate, threshold: 0.55, met: winRate >= 0.55 },
        total_pnl: { value: Math.round(totalPnl * 100) / 100, threshold: 0, met: totalPnl > 0 },
        sharpe: { value: Math.round(sharpe * 100) / 100, threshold: 1.0, met: sharpe >= 1.0 },
        max_drawdown: { value: Math.round(maxDrawdown * 10000) / 100, threshold: 15, met: maxDrawdown * 100 <= 15 },
        worst_strategy_loss: { value: Math.round(worstStrategyLoss * 100) / 100, threshold: -500, met: worstStrategyLoss > -500 },
      },
      daily: Array.from(dailyPnl.values()).sort((a, b) => b.date.localeCompare(a.date)),
      byStrategy: Array.from(strategyPnl.values()).sort((a, b) => b.pnl - a.pnl),
      portfolio: portfolioSnapshots ?? [],
      summary: {
        total_resolved: totalResolved,
        total_open: (openTrades ?? []).length,
        open_cost: Math.round(openCost * 100) / 100,
        total_pnl: Math.round(totalPnl * 100) / 100,
        win_rate: Math.round(winRate * 1000) / 10,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
