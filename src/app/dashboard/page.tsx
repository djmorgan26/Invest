import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";
import { StatCard } from "@/components/ui/stat-card";
import type { Prediction } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createServerClient();

  const [portfolioRes, openTradesRes, predictionsRes, recentPredictionsRes, strategiesRes, strategyTradesRes] =
    await Promise.all([
      supabase
        .from("portfolio_snapshots")
        .select("*")
        .order("snapshot_at", { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from("paper_trades")
        .select("*", { count: "exact", head: true })
        .eq("status", "open"),
      supabase
        .from("predictions")
        .select("status")
        .in("status", ["correct", "incorrect"]),
      supabase
        .from("predictions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("strategies")
        .select("id, name, enabled"),
      supabase
        .from("paper_trades")
        .select("strategy_id, status, pnl")
        .eq("status", "closed"),
    ]);

  const portfolio = portfolioRes.data;
  const openTradesCount = openTradesRes.count ?? 0;
  const resolvedPredictions = predictionsRes.data ?? [];
  const correctCount = resolvedPredictions.filter(
    (p) => p.status === "correct"
  ).length;
  const totalResolved = resolvedPredictions.length;
  const winRate = totalResolved > 0 ? correctCount / totalResolved : 0;
  const recentPredictions: Prediction[] = recentPredictionsRes.data ?? [];

  const strategies = strategiesRes.data ?? [];
  const strategyTrades = strategyTradesRes.data ?? [];

  const strategyStats = strategies.map((s) => {
    const closed = strategyTrades.filter((t) => t.strategy_id === s.id);
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    return {
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      trades: closed.length,
      wins,
      win_rate: closed.length > 0 ? wins / closed.length : null,
      pnl: totalPnl,
    };
  });

  const hasData = portfolio !== null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Portfolio overview and recent activity
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Value"
          value={hasData ? formatCurrency(portfolio.total_value) : "$10,000.00"}
        />
        <StatCard
          title="Cash"
          value={hasData ? formatCurrency(portfolio.cash) : "$10,000.00"}
        />
        <StatCard
          title="Unrealized P&L"
          value={
            hasData ? formatCurrency(portfolio.unrealized_pnl) : "$0.00"
          }
          change={
            hasData && portfolio.unrealized_pnl !== 0
              ? {
                  value: formatCurrency(portfolio.unrealized_pnl),
                  positive: portfolio.unrealized_pnl > 0,
                }
              : undefined
          }
        />
        <StatCard
          title="Win Rate"
          value={
            totalResolved > 0
              ? formatPercent(winRate)
              : "N/A"
          }
          change={
            totalResolved > 0
              ? {
                  value: `${correctCount}/${totalResolved} resolved`,
                  positive: winRate >= 0.5,
                }
              : undefined
          }
        />
      </div>

      {/* Recent Predictions & Open Positions */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Predictions */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Recent Predictions</h2>
          {recentPredictions.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No predictions yet. Run the prediction pipeline to generate
              analysis.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {recentPredictions.map((pred) => (
                <div
                  key={pred.id}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">{pred.ticker}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(pred.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        pred.side === "yes"
                          ? "rounded bg-[color:var(--success)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--success)]"
                          : "rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
                      }
                    >
                      {pred.side.toUpperCase()}
                    </span>
                    <span className="font-mono text-sm">
                      {formatPercent(pred.confidence)}
                    </span>
                    <StatusBadge status={pred.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Open Positions */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Open Positions</h2>
          {openTradesCount === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No open positions. Predictions with sufficient edge will trigger
              paper trades automatically.
            </p>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              <span className="font-mono text-2xl font-semibold text-foreground">
                {openTradesCount}
              </span>{" "}
              open position{openTradesCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      {/* Strategy Performance Summary */}
      {strategies.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Strategy Performance</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Strategy</th>
                  <th className="pb-2 pr-4 font-medium text-right">Trades</th>
                  <th className="pb-2 pr-4 font-medium text-right">Win Rate</th>
                  <th className="pb-2 font-medium text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {strategyStats.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4">
                      <span className="font-medium">{s.name}</span>
                      {!s.enabled && (
                        <span className="ml-2 text-xs text-muted-foreground">(disabled)</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">{s.trades}</td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {s.win_rate !== null ? formatPercent(s.win_rate) : "—"}
                    </td>
                    <td className={`py-2 text-right font-mono ${
                      s.pnl > 0 ? "text-[color:var(--success)]" : s.pnl < 0 ? "text-destructive" : ""
                    }`}>
                      {s.trades > 0 ? formatCurrency(s.pnl) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!hasData && strategies.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            No portfolio data yet. Run{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-sm">
              sync-markets
            </code>{" "}
            to get started.
          </p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending:
      "bg-[color:var(--warning)]/15 text-[color:var(--warning)]",
    correct:
      "bg-[color:var(--success)]/15 text-[color:var(--success)]",
    incorrect: "bg-destructive/15 text-destructive",
    expired: "bg-secondary text-muted-foreground",
  };

  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.expired}`}
    >
      {status}
    </span>
  );
}
