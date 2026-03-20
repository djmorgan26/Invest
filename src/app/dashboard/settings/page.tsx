import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SyncButton } from "./sync-button";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = createServerClient();

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
    { name: "NEXT_PUBLIC_SUPABASE_URL", configured: !!process.env.NEXT_PUBLIC_SUPABASE_URL },
    { name: "SUPABASE_SERVICE_ROLE_KEY", configured: !!process.env.SUPABASE_SERVICE_ROLE_KEY },
    { name: "KALSHI_API_KEY", configured: !!process.env.KALSHI_API_KEY },
    { name: "OPENAI_API_KEY", configured: !!process.env.OPENAI_API_KEY },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configuration and system status
        </p>
      </div>

      {/* API Connection Status */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">API Configuration</h2>
        <div className="mt-4 space-y-3">
          {envVars.map((env) => (
            <div
              key={env.name}
              className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
            >
              <span className="font-mono text-sm">{env.name}</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  env.configured
                    ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                    : "bg-destructive/15 text-destructive"
                }`}
              >
                {env.configured ? "Configured" : "Missing"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Last Sync */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Data Sync</h2>
        {lastSync ? (
          <div className="mt-4 space-y-2">
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
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  lastSync.status === "success"
                    ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                    : "bg-destructive/15 text-destructive"
                }`}
              >
                {lastSync.status}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Records processed</span>
              <span className="font-mono">{lastSync.records_processed}</span>
            </div>
            {lastSync.error_message && (
              <p className="mt-2 rounded bg-destructive/10 p-3 text-sm text-destructive">
                {lastSync.error_message}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No sync has been performed yet.
          </p>
        )}
        <div className="mt-4">
          <SyncButton />
        </div>
      </section>

      {/* Paper Trading Balance */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Paper Trading</h2>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Starting balance</span>
            <span className="font-mono">{formatCurrency(10000)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current cash</span>
            <span className="font-mono">
              {portfolio ? formatCurrency(portfolio.cash) : formatCurrency(10000)}
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
        </div>
      </section>
    </div>
  );
}
