import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServerClient();
  const now = new Date().toISOString();

  const [
    signalCountsRes,
    recentSignalsRes,
    sourceStatsRes,
    divergencesRes,
    mappingsCountRes,
    categoryBreakdownRes,
  ] = await Promise.all([
    // Total signal count
    supabase
      .from("external_signals")
      .select("*", { count: "exact", head: true }),

    // Latest 50 signals
    supabase
      .from("external_signals")
      .select("source, signal_type, category, title, implied_probability, data, fetched_at, expires_at")
      .order("fetched_at", { ascending: false })
      .limit(50),

    // Per-source stats: latest fetch time + signal counts
    supabase
      .from("external_signals")
      .select("source, fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(5000),

    // Cross-market divergences (signals that have Kalshi ticker mappings)
    supabase
      .from("external_market_mappings")
      .select("*"),

    // Mapping count
    supabase
      .from("external_market_mappings")
      .select("*", { count: "exact", head: true }),

    // Category breakdown
    supabase
      .from("external_signals")
      .select("category, source, implied_probability")
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("fetched_at", { ascending: false })
      .limit(2000),
  ]);

  // Build per-source stats
  const allSignals = sourceStatsRes.data ?? [];
  const sourceStats: Record<string, { count: number; latest: string | null; stale: boolean }> = {};

  const expectedSources = [
    "polymarket", "predictit", "espn", "odds_api", "fred", "coingecko", "open_meteo", "nws",
  ];

  for (const source of expectedSources) {
    const sourceSignals = allSignals.filter((s) => s.source === source);
    const latest = sourceSignals.length > 0 ? sourceSignals[0].fetched_at : null;
    const stale = !latest || (Date.now() - new Date(latest).getTime()) > 30 * 60 * 1000; // >30 min old
    sourceStats[source] = { count: sourceSignals.length, latest, stale };
  }

  // Build category breakdown
  const catSignals = categoryBreakdownRes.data ?? [];
  const categoryStats: Record<string, { count: number; sources: string[] }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of catSignals as any[]) {
    if (!categoryStats[s.category]) categoryStats[s.category] = { count: 0, sources: [] };
    categoryStats[s.category].count++;
    if (!categoryStats[s.category].sources.includes(s.source)) {
      categoryStats[s.category].sources.push(s.source);
    }
  }

  return NextResponse.json({
    total_signals: signalCountsRes.count ?? 0,
    total_mappings: mappingsCountRes.count ?? 0,
    source_stats: sourceStats,
    category_stats: categoryStats,
    recent_signals: recentSignalsRes.data ?? [],
    mappings: divergencesRes.data ?? [],
  });
}
