import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PnlValue } from "@/components/ui/pnl-value";
import { GoLiveProgress } from "@/components/pnl/go-live-progress";
import { PnlTabs } from "@/components/pnl/pnl-tabs";

export const dynamic = "force-dynamic";

export default async function PnlPage() {
  const supabase = createServerClient();

  // Fetch all data in parallel
  const [tradesRes, openTradesRes, portfolioRes, strategiesRes] = await Promise.all([
    supabase
      .from("paper_trades")
      .select("ticker, side, quantity, price, cost, fee, pnl, strategy_id, status, created_at, closed_at")
      .eq("status", "closed")
      .order("closed_at", { ascending: false }),
    supabase
      .from("paper_trades")
      .select("ticker, side, quantity, price, cost, fee, strategy_id, created_at")
      .eq("status", "open"),
    supabase
      .from("portfolio_snapshots")
      .select("total_value, realized_pnl, unrealized_pnl, cash, snapshot_at")
      .order("snapshot_at", { ascending: true })
      .limit(500),
    supabase.from("strategies").select("id, name"),
  ]);

  const closedTrades = tradesRes.data ?? [];
  const openTrades = openTradesRes.data ?? [];
  const portfolioSnapshots = portfolioRes.data ?? [];
  const strategies = strategiesRes.data ?? [];
  const strategyNames = new Map(strategies.map((s) => [s.id, s.name]));

  // Compute go-live metrics
  const totalResolved = closedTrades.length;
  const totalWins = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRate = totalResolved > 0 ? totalWins / totalResolved : 0;
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

  // Daily P&L
  const dailyMap = new Map<string, { date: string; pnl: number; trades: number; wins: number }>();
  for (const t of closedTrades) {
    const date = t.closed_at ? t.closed_at.split("T")[0] : "unknown";
    if (!dailyMap.has(date)) dailyMap.set(date, { date, pnl: 0, trades: 0, wins: 0 });
    const day = dailyMap.get(date)!;
    day.pnl += t.pnl ?? 0;
    day.trades += 1;
    if ((t.pnl ?? 0) > 0) day.wins += 1;
  }
  const daily = Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date));

  // Strategy breakdown
  const stratMap = new Map<string, { id: string; pnl: number; trades: number; wins: number }>();
  for (const t of closedTrades) {
    const sid = t.strategy_id ?? "unknown";
    if (!stratMap.has(sid)) stratMap.set(sid, { id: sid, pnl: 0, trades: 0, wins: 0 });
    const s = stratMap.get(sid)!;
    s.pnl += t.pnl ?? 0;
    s.trades += 1;
    if ((t.pnl ?? 0) > 0) s.wins += 1;
  }
  const byStrategy = Array.from(stratMap.values()).sort((a, b) => b.pnl - a.pnl);

  // Sharpe
  const dailyReturns = daily.map((d) => d.pnl);
  const avgReturn = dailyReturns.length > 0
    ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    : 0;
  const stdDev = dailyReturns.length > 1
    ? Math.sqrt(dailyReturns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1))
    : 0;
  const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  // Max drawdown
  let maxDrawdown = 0;
  let peak = 0;
  for (const snap of portfolioSnapshots) {
    if (snap.total_value > peak) peak = snap.total_value;
    if (peak > 0) {
      const dd = (peak - snap.total_value) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  const worstStrategyLoss = byStrategy.length > 0
    ? Math.min(0, ...byStrategy.map((s) => s.pnl))
    : 0;

  const goLiveMetrics: { label: string; value: string; threshold: string; met: boolean }[] = [
    {
      label: "Resolved Trades",
      value: totalResolved.toString(),
      threshold: "200+",
      met: totalResolved >= 200,
    },
    {
      label: "Win Rate",
      value: totalResolved > 0 ? formatPercent(winRate) : "N/A",
      threshold: "> 55%",
      met: winRate >= 0.55,
    },
    {
      label: "Total P&L",
      value: formatCurrency(totalPnl),
      threshold: "Positive",
      met: totalPnl > 0,
    },
    {
      label: "Sharpe Ratio",
      value: sharpe.toFixed(2),
      threshold: "> 1.0",
      met: sharpe >= 1.0,
    },
    {
      label: "Max Drawdown",
      value: `${(maxDrawdown * 100).toFixed(1)}%`,
      threshold: "< 15%",
      met: maxDrawdown * 100 <= 15,
    },
    {
      label: "Worst Strategy Loss",
      value: formatCurrency(worstStrategyLoss),
      threshold: "> -$500",
      met: worstStrategyLoss > -500,
    },
  ];

  const metCount = goLiveMetrics.filter((m) => m.met).length;

  // Convert strategyNames Map to a plain object for the client component
  const strategyNamesObj: Record<string, string> = {};
  for (const [k, v] of strategyNames) {
    strategyNamesObj[k] = v;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">P&L Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Go-live progress, daily P&L, and strategy attribution
        </p>
      </div>

      {/* Hero P&L */}
      <Card>
        <CardContent className="flex flex-col items-center py-8">
          <p className="text-sm font-medium text-muted-foreground">Total P&L</p>
          <PnlValue
            value={totalPnl}
            size="xl"
            format={formatCurrency}
            className="mt-1 font-bold"
          />
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Open Trades</p>
            <p className="mt-1 text-2xl font-mono font-semibold">{openTrades.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Resolved Trades</p>
            <p className="mt-1 text-2xl font-mono font-semibold">{totalResolved}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Win Rate</p>
            <p className="mt-1 text-2xl font-mono font-semibold">
              {totalResolved > 0 ? formatPercent(winRate) : "N/A"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Open Capital</p>
            <p className="mt-1 text-2xl font-mono font-semibold">
              {formatCurrency(openTrades.reduce((sum, t) => sum + (t.cost ?? 0), 0))}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Go-Live Progress */}
      <GoLiveProgress metrics={goLiveMetrics} metCount={metCount} />

      {/* Tabs: Strategy / Daily / Portfolio */}
      <Card>
        <CardContent className="pt-4">
          <PnlTabs
            byStrategy={byStrategy}
            daily={daily}
            portfolioSnapshots={portfolioSnapshots}
            strategyNames={strategyNamesObj}
          />
        </CardContent>
      </Card>
    </div>
  );
}
