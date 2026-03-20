import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const supabase = createServerClient();

  const [strategiesRes, tradesRes, learningsRes] = await Promise.all([
    supabase.from("strategies").select("*").order("created_at"),
    supabase.from("paper_trades").select("strategy_id, status, pnl, closed_at").order("closed_at", { ascending: false }),
    supabase.from("strategy_learnings").select("*").order("created_at", { ascending: false }).limit(20),
  ]);

  const strategies = strategiesRes.data ?? [];
  const trades = tradesRes.data ?? [];
  const learnings = learningsRes.data ?? [];

  // Compute per-strategy stats
  const strategyStats = strategies.map((s) => {
    const stratTrades = trades.filter((t) => t.strategy_id === s.id);
    const closed = stratTrades.filter((t) => t.status === "closed");
    const open = stratTrades.filter((t) => t.status === "open");
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

    return {
      ...s,
      open_count: open.length,
      closed_count: closed.length,
      wins,
      losses: closed.length - wins,
      win_rate: closed.length > 0 ? wins / closed.length : null,
      total_pnl: totalPnl,
      avg_pnl: closed.length > 0 ? totalPnl / closed.length : 0,
      last_trade: closed.length > 0 ? closed[0].closed_at : null,
    };
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Strategies</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Autonomous strategy performance and parameter tuning history
        </p>
      </div>

      {/* Strategy Performance Table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Strategy</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Open</th>
                <th className="px-4 py-3 font-medium text-right">Closed</th>
                <th className="px-4 py-3 font-medium text-right">Win Rate</th>
                <th className="px-4 py-3 font-medium text-right">Total P&L</th>
                <th className="px-4 py-3 font-medium text-right">Avg P&L</th>
                <th className="px-4 py-3 font-medium">Last Trade</th>
              </tr>
            </thead>
            <tbody>
              {strategyStats.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.description}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                        s.enabled
                          ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                          : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {s.enabled ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{s.open_count}</td>
                  <td className="px-4 py-3 text-right font-mono">{s.closed_count}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {s.win_rate !== null ? formatPercent(s.win_rate) : "—"}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${
                    s.total_pnl > 0 ? "text-[color:var(--success)]" : s.total_pnl < 0 ? "text-destructive" : ""
                  }`}>
                    {s.closed_count > 0 ? formatCurrency(s.total_pnl) : "—"}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${
                    s.avg_pnl > 0 ? "text-[color:var(--success)]" : s.avg_pnl < 0 ? "text-destructive" : ""
                  }`}>
                    {s.closed_count > 0 ? formatCurrency(s.avg_pnl) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {s.last_trade ? formatDate(s.last_trade) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Strategy Configs */}
      <div className="grid gap-4 lg:grid-cols-2">
        {strategyStats.map((s) => (
          <div key={s.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{s.name}</h3>
              <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>
            <div className="mt-3">
              <p className="text-xs font-medium text-muted-foreground">Config Parameters</p>
              <pre className="mt-1 rounded bg-secondary p-2 text-xs font-mono">
                {JSON.stringify(s.config, null, 2)}
              </pre>
            </div>
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
              <span>W/L: {s.wins}/{s.losses}</span>
              <span>Open: {s.open_count}</span>
              {s.win_rate !== null && (
                <span className={s.win_rate >= 0.55 ? "text-[color:var(--success)]" : s.win_rate < 0.45 ? "text-destructive" : ""}>
                  {formatPercent(s.win_rate)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Learnings History */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Learning History</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Auto-tuning decisions and strategy adaptations
        </p>
        {learnings.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No learnings yet. The tuner runs weekly after strategies accumulate 30+ resolved trades.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {learnings.map((l) => (
              <div key={l.id} className="rounded-lg border border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium font-mono">
                    {l.strategy_id}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                    l.learning_type === "param_change"
                      ? "bg-[color:var(--warning)]/15 text-[color:var(--warning)]"
                      : l.learning_type === "auto_disabled"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-secondary text-muted-foreground"
                  }`}>
                    {l.learning_type}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(l.created_at)}
                  </span>
                </div>
                <p className="mt-1 text-sm">{l.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
