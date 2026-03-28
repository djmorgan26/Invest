import { createServerClient } from "@/lib/supabase/server";
import type { ExternalSignal, DataConnector } from "./types";
import { ALL_CONNECTORS, FREE_CONNECTORS } from "./index";

/**
 * Fetch signals from all available connectors and store them in Supabase.
 * Connectors that need missing API keys are automatically skipped.
 */
export async function fetchAndStoreAllSignals(opts?: {
  freeOnly?: boolean;
  sources?: string[];
}): Promise<{ total: number; bySource: Record<string, number>; errors: string[] }> {
  const supabase = createServerClient();
  const connectors = opts?.freeOnly ? FREE_CONNECTORS : ALL_CONNECTORS;
  const filtered = opts?.sources
    ? connectors.filter((c) => opts.sources!.includes(c.source))
    : connectors;

  const bySource: Record<string, number> = {};
  const errors: string[] = [];
  let total = 0;

  // Run all connectors in parallel
  const results = await Promise.allSettled(
    filtered.map(async (connector) => {
      const signals = await connector.fetchSignals();
      return { source: connector.source, signals };
    })
  );

  for (const result of results) {
    if (result.status === "rejected") {
      errors.push(`Connector failed: ${result.reason}`);
      continue;
    }

    const { source, signals } = result.value;
    if (signals.length === 0) {
      bySource[source] = 0;
      continue;
    }

    // Upsert signals to Supabase in batches of 100
    const batchSize = 100;
    let stored = 0;

    for (let i = 0; i < signals.length; i += batchSize) {
      const batch = signals.slice(i, i + batchSize).map((s) => ({
        source: s.source,
        signal_type: s.signal_type,
        external_id: s.external_id ?? null,
        ticker: s.ticker ?? null,
        category: s.category,
        title: s.title,
        data: s.data,
        implied_probability: s.implied_probability ?? null,
        fetched_at: s.fetched_at,
        expires_at: s.expires_at ?? null,
      }));

      const { error } = await supabase.from("external_signals").insert(batch);
      if (error) {
        errors.push(`[${source}] Insert error: ${error.message}`);
      } else {
        stored += batch.length;
      }
    }

    bySource[source] = stored;
    total += stored;
  }

  // Clean up expired signals (older than 24h)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("external_signals").delete().lt("fetched_at", cutoff);

  return { total, bySource, errors };
}

/**
 * Get the latest signals for a specific Kalshi ticker or category.
 * Used to enrich MarketContext before strategy decisions.
 */
export async function getSignalsForMarket(opts: {
  ticker?: string;
  category?: string;
  sources?: string[];
  limit?: number;
}): Promise<ExternalSignal[]> {
  const supabase = createServerClient();
  let query = supabase
    .from("external_signals")
    .select("*")
    .order("fetched_at", { ascending: false })
    .limit(opts.limit ?? 50);

  if (opts.ticker) {
    query = query.eq("ticker", opts.ticker);
  }
  if (opts.category) {
    query = query.eq("category", opts.category);
  }
  if (opts.sources) {
    query = query.in("source", opts.sources);
  }

  // Only get non-expired signals
  query = query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  const { data, error } = await query;
  if (error) {
    console.error("[Aggregator] Query error:", error);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    source: row.source,
    signal_type: row.signal_type,
    external_id: row.external_id,
    ticker: row.ticker,
    category: row.category,
    title: row.title,
    data: row.data,
    implied_probability: row.implied_probability,
    fetched_at: row.fetched_at,
    expires_at: row.expires_at,
  }));
}

/**
 * Find cross-market arbitrage opportunities: Kalshi vs external prediction markets.
 * Returns pairs where the price divergence exceeds the threshold.
 */
export async function findCrossMarketDivergences(opts?: {
  minDivergenceCents?: number;
}): Promise<{
  ticker: string;
  kalshi_price: number;
  external_source: string;
  external_price: number;
  divergence_cents: number;
  external_title: string;
}[]> {
  const supabase = createServerClient();
  const minDiv = opts?.minDivergenceCents ?? 5;

  // Get mappings
  const { data: mappings } = await supabase
    .from("external_market_mappings")
    .select("*");

  if (!mappings || mappings.length === 0) return [];

  const divergences: {
    ticker: string;
    kalshi_price: number;
    external_source: string;
    external_price: number;
    divergence_cents: number;
    external_title: string;
  }[] = [];

  for (const mapping of mappings) {
    // Get Kalshi price
    const { data: market } = await supabase
      .from("markets")
      .select("last_price, yes_bid, yes_ask")
      .eq("ticker", mapping.kalshi_ticker)
      .single();

    if (!market?.last_price) continue;

    // Get latest external signal
    const { data: signals } = await supabase
      .from("external_signals")
      .select("*")
      .eq("source", mapping.source)
      .eq("external_id", mapping.external_id)
      .order("fetched_at", { ascending: false })
      .limit(1);

    const signal = signals?.[0];
    if (!signal?.implied_probability) continue;

    const kalshiCents = market.last_price;
    const externalCents = Math.round(signal.implied_probability * 100);
    const divergence = Math.abs(kalshiCents - externalCents);

    if (divergence >= minDiv) {
      divergences.push({
        ticker: mapping.kalshi_ticker,
        kalshi_price: kalshiCents,
        external_source: mapping.source,
        external_price: externalCents,
        divergence_cents: divergence,
        external_title: signal.title,
      });
    }
  }

  return divergences.sort((a, b) => b.divergence_cents - a.divergence_cents);
}
