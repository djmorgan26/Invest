import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServerClient();
  const now = new Date().toISOString();

  const [
    signalCountsRes,
    recentSignalsRes,
    divergencesRes,
    mappingsCountRes,
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

    // Cross-market divergences (signals that have Kalshi ticker mappings)
    supabase
      .from("external_market_mappings")
      .select("*"),

    // Mapping count
    supabase
      .from("external_market_mappings")
      .select("*", { count: "exact", head: true }),
  ]);

  // Build per-source stats using individual queries (avoids row limit issues)
  const expectedSources = [
    "polymarket", "predictit", "espn", "odds_api", "fred", "coingecko", "open_meteo", "nws",
  ];

  const sourceStatsPromises = expectedSources.map(async (source) => {
    const [countRes, latestRes] = await Promise.all([
      supabase
        .from("external_signals")
        .select("*", { count: "exact", head: true })
        .eq("source", source),
      supabase
        .from("external_signals")
        .select("fetched_at")
        .eq("source", source)
        .order("fetched_at", { ascending: false })
        .limit(1),
    ]);

    const count = countRes.count ?? 0;
    const latest = latestRes.data?.[0]?.fetched_at ?? null;
    const stale = !latest || (Date.now() - new Date(latest).getTime()) > 60 * 60 * 1000; // 1 hour
    return { source, count, latest, stale };
  });

  const sourceStatsArray = await Promise.all(sourceStatsPromises);
  const sourceStats: Record<string, { count: number; latest: string | null; stale: boolean }> = {};
  for (const s of sourceStatsArray) {
    sourceStats[s.source] = { count: s.count, latest: s.latest, stale: s.stale };
  }

  // Build category breakdown from non-expired signals
  const catRes = await supabase
    .from("external_signals")
    .select("category, source")
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("fetched_at", { ascending: false })
    .limit(5000);

  const catSignals = catRes.data ?? [];
  const categoryStats: Record<string, { count: number; sources: string[] }> = {};
  for (const s of catSignals) {
    const cat = s.category ?? "unknown";
    if (!categoryStats[cat]) categoryStats[cat] = { count: 0, sources: [] };
    categoryStats[cat].count++;
    if (!categoryStats[cat].sources.includes(s.source)) {
      categoryStats[cat].sources.push(s.source);
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
