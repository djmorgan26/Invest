import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface GoLiveMetric {
  value: number;
  threshold: number;
  met: boolean;
}

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">P&L Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Go-live progress, daily P&L, and strategy attribution
        </p>
      </div>

      {/* Go-Live Progress */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Go-Live Readiness</h2>
          <span className="rounded-full bg-secondary px-3 py-1 text-sm font-mono font-medium">
            {metCount}/{goLiveMetrics.length} met
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {goLiveMetrics.map((m) => (
            <div
              key={m.label}
              className={`rounded-lg border px-4 py-3 ${
                m.met
                  ? "border-[color:var(--success)]/30 bg-[color:var(--success)]/5"
                  : "border-border bg-secondary/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <span className={`text-xs font-medium ${m.met ? "text-[color:var(--success)]" : "text-muted-foreground"}`}>
                  {m.met ? "PASS" : "PENDING"}
                </span>
              </div>
              <p className="mt-1 text-xl font-mono font-semibold">{m.value}</p>
              <p className="text-xs text-muted-foreground">Threshold: {m.threshold}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Open Trades</p>
          <p className="mt-1 text-2xl font-mono font-semibold">{openTrades.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Resolved Trades</p>
          <p className="mt-1 text-2xl font-mono font-semibold">{totalResolved}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total P&L</p>
          <p className={`mt-1 text-2xl font-mono font-semibold ${totalPnl > 0 ? "text-[color:var(--success)]" : totalPnl < 0 ? "text-destructive" : ""}`}>
            {formatCurrency(totalPnl)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Open Capital</p>
          <p className="mt-1 text-2xl font-mono font-semibold">
            {formatCurrency(openTrades.reduce((sum, t) => sum + (t.cost ?? 0), 0))}
          </p>
        </div>
      </div>

      {/* Strategy Attribution */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold">Strategy Attribution</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Strategy</th>
                <th className="px-4 py-3 font-medium text-right">Trades</th>
                <th className="px-4 py-3 font-medium text-right">Wins</th>
                <th className="px-4 py-3 font-medium text-right">Win Rate</th>
                <th className="px-4 py-3 font-medium text-right">P&L</th>
                <th className="px-4 py-3 font-medium text-right">Avg P&L</th>
              </tr>
            </thead>
            <tbody>
              {byStrategy.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No resolved trades yet. Strategies are scanning every 5 minutes.
                  </td>
                </tr>
              ) : (
                byStrategy.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{strategyNames.get(s.id) ?? s.id}</td>
                    <td className="px-4 py-3 text-right font-mono">{s.trades}</td>
                    <td className="px-4 py-3 text-right font-mono">{s.wins}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {s.trades > 0 ? formatPercent(s.wins / s.trades) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${s.pnl > 0 ? "text-[color:var(--success)]" : s.pnl < 0 ? "text-destructive" : ""}`}>
                      {formatCurrency(s.pnl)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${s.pnl / s.trades > 0 ? "text-[color:var(--success)]" : s.pnl / s.trades < 0 ? "text-destructive" : ""}`}>
                      {s.trades > 0 ? formatCurrency(s.pnl / s.trades) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily P&L Table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold">Daily P&L</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium text-right">Trades</th>
                <th className="px-4 py-3 font-medium text-right">Wins</th>
                <th className="px-4 py-3 font-medium text-right">Win Rate</th>
                <th className="px-4 py-3 font-medium text-right">P&L</th>
              </tr>
            </thead>
            <tbody>
              {daily.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No resolved trades yet. Daily P&L will appear as trades close.
                  </td>
                </tr>
              ) : (
                daily.map((d) => (
                  <tr key={d.date} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono">{d.date}</td>
                    <td className="px-4 py-3 text-right font-mono">{d.trades}</td>
                    <td className="px-4 py-3 text-right font-mono">{d.wins}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {d.trades > 0 ? formatPercent(d.wins / d.trades) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${d.pnl > 0 ? "text-[color:var(--success)]" : d.pnl < 0 ? "text-destructive" : ""}`}>
                      {formatCurrency(d.pnl)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Portfolio Timeline */}
      {portfolioSnapshots.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Portfolio Value Timeline</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Last {portfolioSnapshots.length} snapshots
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium text-right">Total Value</th>
                  <th className="px-4 py-3 font-medium text-right">Cash</th>
                  <th className="px-4 py-3 font-medium text-right">Realized P&L</th>
                  <th className="px-4 py-3 font-medium text-right">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody>
                {portfolioSnapshots.slice(-20).reverse().map((snap, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(snap.snapshot_at)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(snap.total_value)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(snap.cash)}</td>
                    <td className={`px-4 py-3 text-right font-mono ${snap.realized_pnl > 0 ? "text-[color:var(--success)]" : snap.realized_pnl < 0 ? "text-destructive" : ""}`}>
                      {formatCurrency(snap.realized_pnl)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${snap.unrealized_pnl > 0 ? "text-[color:var(--success)]" : snap.unrealized_pnl < 0 ? "text-destructive" : ""}`}>
                      {formatCurrency(snap.unrealized_pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
