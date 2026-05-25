import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { SyncButton } from "./sync-button";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createServerClient();

  const [syncLogRes, portfolioRes] = await Promise.all([
    supabase
      .from("sync_log")
      .select("*")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("portfolio_snapshots")
      .select("*")
      .order("snapshot_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  const lastSync = syncLogRes.data;
  const portfolio = portfolioRes.data;

  const envVars = [
    {
      name: "NEXT_PUBLIC_SUPABASE_URL",
      configured: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    },
    {
      name: "SUPABASE_SERVICE_ROLE_KEY",
      configured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    {
      name: "KALSHI_API_KEY_ID",
      configured: !!(
        process.env.KALSHI_API_KEY_ID ||
        process.env.KALSHI_API_KEY_ID_DEMO
      ),
    },
    {
      name: "CRON_SECRET",
      configured: !!process.env.CRON_SECRET,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configuration and system status
        </p>
      </div>

      {/* API Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>API Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {envVars.map((env) => (
            <div
              key={env.name}
              className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
            >
              <span className="font-mono text-sm">{env.name}</span>
              <StatusDot
                active={env.configured}
                label={env.configured ? "Configured" : "Missing"}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Data Sync */}
      <Card>
        <CardHeader>
          <CardTitle>Data Sync</CardTitle>
        </CardHeader>
        <CardContent>
          {lastSync ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Last sync</span>
                <span>{formatDate(lastSync.completed_at)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Type</span>
                <span className="font-mono">{lastSync.type}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <StatusDot
                  active={lastSync.status === "success"}
                  label={lastSync.status}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Records processed
                </span>
                <span className="font-mono">
                  {lastSync.records_processed}
                </span>
              </div>
              {lastSync.error_message && (
                <p className="mt-2 rounded bg-destructive/10 p-3 text-sm text-destructive">
                  {lastSync.error_message}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No sync has been performed yet.
            </p>
          )}
          <div className="mt-4">
            <SyncButton />
          </div>
        </CardContent>
      </Card>

      {/* Paper Trading */}
      <Card>
        <CardHeader>
          <CardTitle>Paper Trading</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Starting balance</span>
            <span className="font-mono">{formatCurrency(10000)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current cash</span>
            <span className="font-mono">
              {portfolio
                ? formatCurrency(portfolio.cash)
                : formatCurrency(10000)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total value</span>
            <span className="font-mono font-medium">
              {portfolio
                ? formatCurrency(portfolio.total_value)
                : formatCurrency(10000)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
