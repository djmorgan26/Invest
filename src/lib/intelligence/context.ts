import { createServerClient } from "@/lib/supabase/server";

export interface ExternalSignalSummary {
  source: string;
  signal_type: string;
  title: string;
  implied_probability: number | null;
  data: Record<string, unknown>;
  fetched_at: string;
}

export interface MarketContext {
  ticker: string;
  event_ticker: string;
  title: string;
  category: string | null;
  last_price: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  volume: number | null;
  close_time: string | null;
  result: string | null;
  // Derived
  days_to_close: number | null;
  spread: number | null;
  // Enrichment
  sibling_markets: SiblingMarket[];
  price_history_24h: PricePoint[];
  open_trades: OpenTrade[];
  recent_predictions: RecentPrediction[];
  // External data signals (prediction markets, odds, weather, economic indicators)
  external_signals: ExternalSignalSummary[];
}

interface SiblingMarket {
  ticker: string;
  title: string;
  last_price: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  volume: number | null;
  result: string | null;
}

interface PricePoint {
  price: number;
  time: string;
}

interface OpenTrade {
  id: string;
  side: "yes" | "no";
  price: number;
  cost: number;
  created_at: string;
}

interface RecentPrediction {
  id: string;
  side: "yes" | "no";
  confidence: number;
  fair_value: number;
  edge: number;
  strategy_id: string | null;
  created_at: string;
}

export async function getMarketContext(ticker: string): Promise<MarketContext | null> {
  const supabase = await createServerClient();

  // Get market + event data
  const { data: market } = await supabase
    .from("markets")
    .select("*, events!inner(title, category)")
    .eq("ticker", ticker)
    .single();

  if (!market) return null;

  const event = market.events as { title: string; category: string | null };

  // Get sibling markets in same event
  const { data: siblings } = await supabase
    .from("markets")
    .select("ticker, title, last_price, yes_bid, yes_ask, volume, result")
    .eq("event_ticker", market.event_ticker)
    .neq("ticker", ticker)
    .order("volume", { ascending: false })
    .limit(20);

  // Get 24h price history
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: snapshots } = await supabase
    .from("price_snapshots")
    .select("last_price, snapshot_at")
    .eq("ticker", ticker)
    .gte("snapshot_at", twentyFourHoursAgo)
    .order("snapshot_at", { ascending: true });

  // Get open trades
  const { data: trades } = await supabase
    .from("paper_trades")
    .select("id, side, price, cost, created_at")
    .eq("ticker", ticker)
    .eq("status", "open");

  // Get recent predictions
  const { data: predictions } = await supabase
    .from("predictions")
    .select("id, side, confidence, fair_value, edge, strategy_id, created_at")
    .eq("ticker", ticker)
    .order("created_at", { ascending: false })
    .limit(5);

  // Get external signals — by ticker mapping or category match
  const category = event.category;
  let externalQuery = supabase
    .from("external_signals")
    .select("source, signal_type, title, implied_probability, data, fetched_at")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("fetched_at", { ascending: false })
    .limit(20);

  // Try ticker-specific signals first, fall back to category
  const { data: tickerSignals } = await supabase
    .from("external_signals")
    .select("source, signal_type, title, implied_probability, data, fetched_at")
    .eq("ticker", ticker)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("fetched_at", { ascending: false })
    .limit(10);

  let categorySignals: typeof tickerSignals = [];
  if (category) {
    const { data: catSigs } = await externalQuery.eq("category", category.toLowerCase());
    categorySignals = catSigs;
  }

  const allExternalSignals = [...(tickerSignals ?? []), ...(categorySignals ?? [])];

  // Compute derived fields
  const daysToClose = market.close_time
    ? (new Date(market.close_time).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    : null;

  const spread = market.yes_bid != null && market.yes_ask != null
    ? market.yes_ask - market.yes_bid
    : null;

  return {
    ticker: market.ticker,
    event_ticker: market.event_ticker,
    title: market.title,
    category: event.category,
    last_price: market.last_price,
    yes_bid: market.yes_bid,
    yes_ask: market.yes_ask,
    volume: market.volume,
    close_time: market.close_time,
    result: market.result,
    days_to_close: daysToClose != null ? Math.round(daysToClose * 10) / 10 : null,
    spread,
    sibling_markets: (siblings ?? []).map((s) => ({
      ticker: s.ticker,
      title: s.title,
      last_price: s.last_price,
      yes_bid: s.yes_bid,
      yes_ask: s.yes_ask,
      volume: s.volume,
      result: s.result,
    })),
    price_history_24h: (snapshots ?? []).map((s) => ({
      price: s.last_price,
      time: s.snapshot_at,
    })),
    open_trades: (trades ?? []).map((t) => ({
      id: t.id,
      side: t.side,
      price: t.price,
      cost: t.cost,
      created_at: t.created_at,
    })),
    recent_predictions: (predictions ?? []).map((p) => ({
      id: p.id,
      side: p.side,
      confidence: p.confidence,
      fair_value: p.fair_value,
      edge: p.edge,
      strategy_id: p.strategy_id,
      created_at: p.created_at,
    })),
    external_signals: allExternalSignals.map((s) => ({
      source: s.source,
      signal_type: s.signal_type,
      title: s.title,
      implied_probability: s.implied_probability,
      data: s.data as Record<string, unknown>,
      fetched_at: s.fetched_at,
    })),
  };
}
