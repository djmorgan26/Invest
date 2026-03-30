import { createServerClient } from "@/lib/supabase/server";
import { getCircuitBreakerStatus } from "@/lib/strategies/circuit-breakers";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertToggle } from "@/components/ui/alert-toggle";

export const dynamic = "force-dynamic";

export default async function CircuitBreakersPage() {
  const supabase = createServerClient();

  const [status, tripsRes, alertSettingRes] = await Promise.all([
    getCircuitBreakerStatus(),
    supabase
      .from("strategy_learnings")
      .select("*")
      .eq("learning_type", "circuit_breaker")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "email_alerts_enabled")
      .single(),
  ]);

  const emailAlertsEnabled = alertSettingRes.data?.value === true;

  const trips = tripsRes.data ?? [];

  const dailyPctUsed = status.daily_loss_limit !== 0
    ? Math.min(1, Math.abs(status.daily_pnl) / Math.abs(status.daily_loss_limit))
    : 0;

  const drawdownPctUsed = status.drawdown_threshold > 0
    ? Math.min(1, status.drawdown_pct / status.drawdown_threshold)
    : 0;

  const categoryEntries = Object.entries(status.category_counts).sort(
    (a, b) => b[1] - a[1]
  );

  const lossEntries = Object.entries(status.consecutive_losses).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Circuit Breakers
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Portfolio-level safety checks — run before every trade
        </p>
      </div>

      {/* Master Status Banner */}
      <Card
        className={
          status.all_clear
            ? "border-success/50 bg-success/5"
            : "border-destructive/50 bg-destructive/5"
        }
      >
        <CardContent className="flex items-center justify-between py-5">
          <div className="flex items-center gap-3">
            <span className="text-2xl">
              {status.all_clear ? "\u2705" : "\u{1F6D1}"}
            </span>
            <div>
              <p className="font-semibold">
                {status.all_clear
                  ? "All Clear — Trading Allowed"
                  : "Trading Blocked"}
              </p>
              <p className="text-sm text-muted-foreground">
                {status.all_clear
                  ? "All circuit breakers are within safe limits"
                  : "One or more breakers have tripped"}
              </p>
            </div>
          </div>
          <Badge variant={status.all_clear ? "secondary" : "destructive"}>
            {status.all_clear ? "CLEAR" : "TRIPPED"}
          </Badge>
        </CardContent>
      </Card>

      {/* Kill Switch */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <span className="font-medium">Kill Switch</span>
            <Badge
              variant={
                status.kill_switch_active ? "destructive" : "secondary"
              }
            >
              {status.kill_switch_active ? "ACTIVE — ALL TRADING HALTED" : "Inactive"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {status.kill_switch_active
              ? "Kill switch is active. All trading is halted. Use CLI to deactivate: npx tsx src/scripts/kill-switch.ts off"
              : "Kill switch is off. Trading proceeds normally through other breaker checks."}
          </p>
        </CardContent>
      </Card>

      {/* Email Alert Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <span className="font-medium">Email Alert Notifications</span>
            <div className="flex items-center gap-3">
              <Badge variant={emailAlertsEnabled ? "secondary" : "outline"}>
                {emailAlertsEnabled ? "ON" : "OFF"}
              </Badge>
              <AlertToggle initialEnabled={emailAlertsEnabled} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {emailAlertsEnabled
              ? "Email alerts are active. You will receive emails when opportunities are detected across all categories (crypto, weather, sports, economics, cross-market)."
              : "Email alerts are paused. Opportunities are still detected and logged, but no emails will be sent. Toggle on when you want to receive notifications."}
          </p>
        </CardContent>
      </Card>

      {/* Gauge Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Daily P&L Gauge */}
        <Card>
          <CardHeader>
            <span className="font-medium">Daily P&L</span>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span
                className={`text-2xl font-mono font-semibold ${
                  status.daily_loss_breached ? "text-destructive" : ""
                }`}
              >
                {formatCurrency(status.daily_pnl)}
              </span>
              <span className="text-sm text-muted-foreground">
                limit: {formatCurrency(status.daily_loss_limit)}
              </span>
            </div>
            <div className="mt-3 h-2 w-full rounded-full bg-secondary">
              <div
                className={`h-full rounded-full transition-all ${
                  status.daily_loss_breached
                    ? "bg-destructive"
                    : dailyPctUsed > 0.7
                      ? "bg-yellow-500"
                      : "bg-success"
                }`}
                style={{ width: `${(dailyPctUsed * 100).toFixed(0)}%` }}
              />
            </div>
            {status.daily_loss_breached && (
              <p className="mt-2 text-xs text-destructive font-medium">
                Daily loss limit breached — new trades blocked for today
              </p>
            )}
          </CardContent>
        </Card>

        {/* Drawdown Gauge */}
        <Card>
          <CardHeader>
            <span className="font-medium">Portfolio Drawdown</span>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span
                className={`text-2xl font-mono font-semibold ${
                  status.drawdown_breached ? "text-destructive" : ""
                }`}
              >
                {formatPercent(status.drawdown_pct)}
              </span>
              <span className="text-sm text-muted-foreground">
                limit: {formatPercent(status.drawdown_threshold)}
              </span>
            </div>
            <div className="mt-3 h-2 w-full rounded-full bg-secondary">
              <div
                className={`h-full rounded-full transition-all ${
                  status.drawdown_breached
                    ? "bg-destructive"
                    : drawdownPctUsed > 0.7
                      ? "bg-yellow-500"
                      : "bg-success"
                }`}
                style={{ width: `${(drawdownPctUsed * 100).toFixed(0)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>Current: {formatCurrency(status.current_portfolio_value)}</span>
              <span>Peak: {formatCurrency(status.peak_portfolio_value)}</span>
            </div>
            {status.drawdown_breached && (
              <p className="mt-1 text-xs text-destructive font-medium">
                Drawdown threshold breached — all new trades blocked
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category Exposure */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <span className="font-medium">Category Exposure</span>
            <span className="text-xs text-muted-foreground">
              max {status.category_limit} open trades per category
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {categoryEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open trades</p>
          ) : (
            <div className="space-y-2">
              {categoryEntries.map(([cat, count]) => {
                const atLimit = count >= status.category_limit;
                return (
                  <div key={cat} className="flex items-center justify-between">
                    <span className="text-sm">{cat}</span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-mono text-sm font-medium ${
                          atLimit ? "text-destructive" : ""
                        }`}
                      >
                        {count} / {status.category_limit}
                      </span>
                      {atLimit && (
                        <Badge variant="destructive" className="text-[10px]">
                          AT LIMIT
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Consecutive Losses */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <span className="font-medium">Consecutive Losses by Strategy</span>
            <span className="text-xs text-muted-foreground">
              limit: {status.consecutive_loss_limit} in a row
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {lossEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No strategy data</p>
          ) : (
            <div className="space-y-2">
              {lossEntries.map(([strat, count]) => {
                const atLimit = count >= status.consecutive_loss_limit;
                const severity =
                  count === 0
                    ? "text-success"
                    : count >= status.consecutive_loss_limit
                      ? "text-destructive"
                      : count >= status.consecutive_loss_limit - 1
                        ? "text-yellow-500"
                        : "";
                return (
                  <div key={strat} className="flex items-center justify-between">
                    <span className="text-sm font-mono">{strat}</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-sm font-medium ${severity}`}>
                        {count} / {status.consecutive_loss_limit}
                      </span>
                      {atLimit && (
                        <Badge variant="destructive" className="text-[10px]">
                          HALTED
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Breaker Trips */}
      <div>
        <h2 className="text-lg font-semibold">Recent Breaker Trips</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Logged when a circuit breaker blocks a trade
        </p>

        {trips.length === 0 ? (
          <EmptyState
            className="mt-4"
            message="No breaker trips recorded yet — circuit breakers have not been triggered."
          />
        ) : (
          <div className="mt-4 space-y-3">
            {trips.map((t) => (
              <Card key={t.id} size="sm">
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive">
                      <span className="font-mono">
                        {(t.data as Record<string, string>)?.breaker ?? "unknown"}
                      </span>
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(t.created_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm">{t.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
