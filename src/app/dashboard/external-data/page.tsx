import { createServerClient } from "@/lib/supabase/server";
import { SourceStatusGrid } from "@/components/external-data/source-status-grid";
import { SignalFeed } from "@/components/external-data/signal-feed";
import { ArbitrageChart } from "@/components/external-data/arbitrage-chart";
import { CategoryBreakdown } from "@/components/external-data/category-breakdown";
import { LiveMonitorCard } from "@/components/external-data/live-monitor-card";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const EXPECTED_SOURCES = [
  "polymarket", "predictit", "espn", "odds_api", "fred", "coingecko", "open_meteo", "nws",
];

export default async function ExternalDataPage() {
  const supabase = createServerClient();
  const now = new Date().toISOString();

  // Fetch recent signals per source so every category is represented in the feed
  const signalFields = "source, signal_type, category, title, implied_probability, data, fetched_at, expires_at";
  const perSourceLimit = 15;

  const [
    sourceStatsRes,
    categoryRes,
    mappingsRes,
    totalCountRes,
    ...perSourceResults
  ] = await Promise.all([
    // All signals for per-source stats (just source + timestamp)
    supabase
      .from("external_signals")
      .select("source, fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(5000),

    // Active signals by category
    supabase
      .from("external_signals")
      .select("category, source")
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .limit(5000),

    // Mappings count
    supabase
      .from("external_market_mappings")
      .select("*", { count: "exact", head: true }),

    // Total signal count
    supabase
      .from("external_signals")
      .select("*", { count: "exact", head: true }),

    // Per-source recent signals
    ...EXPECTED_SOURCES.map((source) =>
      supabase
        .from("external_signals")
        .select(signalFields)
        .eq("source", source)
        .order("fetched_at", { ascending: false })
        .limit(perSourceLimit)
    ),
  ]);

  // Merge per-source signals and sort by recency
  const recentSignals = perSourceResults
    .flatMap((r) => r.data ?? [])
    .sort((a, b) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSourceData: any[] = sourceStatsRes.data ?? [];
  const totalSignals = totalCountRes.count ?? 0;
  const totalMappings = mappingsRes.count ?? 0;

  // Build per-source stats
  const sourceStats: Record<string, { count: number; latest: string | null; stale: boolean }> = {};
  for (const source of EXPECTED_SOURCES) {
    const sourceSignals = allSourceData.filter((s: { source: string }) => s.source === source);
    const latest = sourceSignals.length > 0 ? sourceSignals[0].fetched_at : null;
    const stale = !latest || (Date.now() - new Date(latest).getTime()) > 30 * 60 * 1000;
    sourceStats[source] = { count: sourceSignals.length, latest, stale };
  }

  // Category breakdown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const catData: any[] = categoryRes.data ?? [];
  const categoryStats: Record<string, { count: number; sources: string[] }> = {};
  for (const s of catData) {
    if (!categoryStats[s.category]) categoryStats[s.category] = { count: 0, sources: [] };
    categoryStats[s.category].count++;
    if (!categoryStats[s.category].sources.includes(s.source)) {
      categoryStats[s.category].sources.push(s.source);
    }
  }

  // Active source count
  const activeSources = Object.values(sourceStats).filter((s) => s.count > 0 && !s.stale).length;

  // Signals with implied probability for charts
  const signalsWithProb = recentSignals.filter(
    (s) => s.implied_probability != null && s.implied_probability > 0 && s.implied_probability < 1
  );

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">External Data Control Center</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live signals from 8 data sources powering cross-market intelligence
        </p>
      </div>

      {/* Quick stats */}
      <div className="flex flex-wrap gap-4">
        <div className="rounded-lg bg-secondary/50 px-4 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Sources Online</p>
          <p className={`font-mono text-sm font-semibold ${activeSources >= 6 ? "text-success" : activeSources >= 3 ? "text-warning" : "text-destructive"}`}>
            {activeSources} / {EXPECTED_SOURCES.length}
          </p>
        </div>
        <div className="rounded-lg bg-secondary/50 px-4 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Signals</p>
          <p className="font-mono text-sm font-semibold">{totalSignals.toLocaleString()}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 px-4 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Market Mappings</p>
          <p className="font-mono text-sm font-semibold">{totalMappings}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 px-4 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Categories</p>
          <p className="font-mono text-sm font-semibold">{Object.keys(categoryStats).length}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 px-4 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Priced Signals</p>
          <p className="font-mono text-sm font-semibold">{signalsWithProb.length}</p>
        </div>
      </div>

      {/* Source status grid */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Data Sources</h2>
        <SourceStatusGrid sourceStats={sourceStats} />
      </section>

      {/* Arbitrage / Divergence chart */}
      <section>
        <div className="rounded-xl border border-border bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="text-base font-semibold mb-1">Cross-Market Intelligence</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Spot pricing divergences between Kalshi and external prediction markets
          </p>
          {recentSignals.length > 0 ? (
            <ArbitrageChart signals={recentSignals} />
          ) : (
            <EmptyState message="Run the fetch script to populate signals. Divergences will appear here." />
          )}
        </div>
      </section>

      {/* Category breakdown + Signal feed side by side on desktop */}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
        {/* Category breakdown */}
        <section>
          <div className="rounded-xl border border-border bg-card p-4 ring-1 ring-foreground/10">
            <h2 className="text-base font-semibold mb-4">Coverage by Category</h2>
            {Object.keys(categoryStats).length > 0 ? (
              <CategoryBreakdown categoryStats={categoryStats} />
            ) : (
              <EmptyState message="No category data yet." />
            )}
          </div>
        </section>

        {/* Live signal feed */}
        <section>
          <div className="rounded-xl border border-border bg-card p-4 ring-1 ring-foreground/10">
            <h2 className="text-base font-semibold mb-1">Signal Feed</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Latest signals from all sources — click to expand details
            </p>
            {recentSignals.length > 0 ? (
              <SignalFeed signals={recentSignals} />
            ) : (
              <EmptyState message="No signals yet. Run: npx tsx src/scripts/fetch-external-data.ts" />
            )}
          </div>
        </section>
      </div>

      {/* Live Speed Edge Monitor */}
      <section>
        <LiveMonitorCard />
      </section>

      {/* Setup instructions if no data */}
      {totalSignals === 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-6">
          <h3 className="text-sm font-semibold text-warning mb-2">Getting Started</h3>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li>1. Apply the DB migration: run <code className="rounded bg-secondary px-1.5 py-0.5 text-xs font-mono">008_external_signals.sql</code> in Supabase SQL editor</li>
            <li>2. Fetch free data: <code className="rounded bg-secondary px-1.5 py-0.5 text-xs font-mono">npx tsx src/scripts/fetch-external-data.ts --free-only</code></li>
            <li>3. Get API keys for The Odds API and FRED (both free)</li>
            <li>4. Fetch all data: <code className="rounded bg-secondary px-1.5 py-0.5 text-xs font-mono">npx tsx src/scripts/fetch-external-data.ts</code></li>
            <li>5. Data will auto-refresh every 15 minutes via cron</li>
          </ol>
        </div>
      )}
    </div>
  );
}
