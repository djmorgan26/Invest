import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { PnlValue } from "@/components/ui/pnl-value";
import { EmptyState } from "@/components/ui/empty-state";
import { wilsonScoreInterval } from "@/lib/stats/wilson";

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

    const ci = wilsonScoreInterval(wins, closed.length);

    return {
      ...s,
      open_count: open.length,
      closed_count: closed.length,
      wins,
      losses: closed.length - wins,
      win_rate: closed.length > 0 ? wins / closed.length : null,
      win_rate_ci: closed.length > 0 ? ci : null,
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

      {/* Strategy Cards */}
      {strategyStats.length === 0 ? (
        <EmptyState message="No strategies configured yet." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {strategyStats.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusDot active={s.enabled} label={s.enabled ? "Active" : "Disabled"} />
                    <span className="font-medium">{s.name}</span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                </div>
                {s.description && (
                  <p className="text-sm text-muted-foreground">{s.description}</p>
                )}
              </CardHeader>

              <CardContent>
                {/* Stats row */}
                <div className="flex items-center gap-6 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Trades</p>
                    <p className="font-mono font-medium">
                      {s.closed_count}
                      {s.open_count > 0 && (
                        <span className="text-muted-foreground"> (+{s.open_count} open)</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Win Rate</p>
                    <p className="font-mono font-medium">
                      {s.win_rate !== null ? (
                        <span className={
                          s.win_rate >= 0.55
                            ? "text-success"
                            : s.win_rate < 0.45
                              ? "text-destructive"
                              : ""
                        }>
                          {formatPercent(s.win_rate)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </p>
                    {s.win_rate_ci && (
                      <p className="text-[10px] text-muted-foreground font-mono">
                        [{formatPercent(s.win_rate_ci.lower)}&ndash;{formatPercent(s.win_rate_ci.upper)}]
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">W / L</p>
                    <p className="font-mono font-medium">{s.wins} / {s.losses}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total P&L</p>
                    {s.closed_count > 0 ? (
                      <PnlValue value={s.total_pnl} size="sm" />
                    ) : (
                      <p className="font-mono text-sm text-muted-foreground">&mdash;</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Avg P&L</p>
                    {s.closed_count > 0 ? (
                      <PnlValue value={s.avg_pnl} size="sm" />
                    ) : (
                      <p className="font-mono text-sm text-muted-foreground">&mdash;</p>
                    )}
                  </div>
                </div>

                {s.last_trade && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Last trade: {formatDate(s.last_trade)}
                  </p>
                )}

                {/* Config JSON collapsible */}
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                    Config Parameters
                  </summary>
                  <pre className="mt-2 rounded bg-secondary p-2 text-xs font-mono overflow-x-auto">
                    {JSON.stringify(s.config, null, 2)}
                  </pre>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Learning History */}
      <div>
        <h2 className="text-lg font-semibold">Learning History</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Auto-tuning decisions and strategy adaptations
        </p>

        {learnings.length === 0 ? (
          <EmptyState
            className="mt-4"
            message="No learnings yet. The tuner runs weekly after strategies accumulate 30+ resolved trades."
          />
        ) : (
          <div className="mt-4 space-y-3">
            {learnings.map((l) => (
              <Card key={l.id} size="sm">
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      <span className="font-mono">{l.strategy_id}</span>
                    </Badge>
                    <LearningTypeBadge type={l.learning_type} />
                    <span className="text-xs text-muted-foreground">
                      {formatDate(l.created_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm">{l.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LearningTypeBadge({ type }: { type: string }) {
  switch (type) {
    case "param_change":
      return <Badge variant="outline">{type}</Badge>;
    case "auto_disabled":
      return <Badge variant="destructive">{type}</Badge>;
    case "category_insight":
    case "strategy_idea":
    case "market_pattern":
      return <Badge variant="secondary">{type}</Badge>;
    case "regime_change":
      return <Badge variant="outline">{type}</Badge>;
    case "failure_analysis":
      return <Badge variant="destructive">{type}</Badge>;
    default:
      return <Badge variant="secondary">{type}</Badge>;
  }
}
