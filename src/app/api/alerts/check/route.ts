import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { sendOpportunityAlert } from "@/lib/notifications";

export const maxDuration = 30;

/**
 * Cron-triggered opportunity checker.
 * Compares latest external signals against Kalshi prices to find stale markets.
 * Sends email alerts when divergences exceed threshold.
 *
 * This runs every 5 minutes via cron as a complement to the live monitor.
 * It catches opportunities even when the live-monitor script isn't running.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const now = new Date().toISOString();
  const alerts: { ticker: string; edge: number; side: string }[] = [];

  // 1. Check prediction market divergences (Polymarket/PredictIt vs Kalshi)
  const { data: mappings } = await supabase
    .from("external_market_mappings")
    .select("*");

  if (mappings && mappings.length > 0) {
    for (const mapping of mappings) {
      const { data: market } = await supabase
        .from("markets")
        .select("ticker, title, last_price, yes_bid, yes_ask, updated_at")
        .eq("ticker", mapping.kalshi_ticker)
        .in("status", ["open", "active"])
        .single();

      if (!market?.last_price) continue;

      const { data: signals } = await supabase
        .from("external_signals")
        .select("implied_probability, source, title, data, fetched_at")
        .eq("source", mapping.source)
        .eq("external_id", mapping.external_id)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("fetched_at", { ascending: false })
        .limit(1);

      const signal = signals?.[0];
      if (!signal?.implied_probability) continue;

      const kalshiCents = market.last_price;
      const externalCents = Math.round(signal.implied_probability * 100);
      const divergence = Math.abs(kalshiCents - externalCents);

      if (divergence >= 8) {
        const side = externalCents > kalshiCents ? "yes" : "no";

        await sendOpportunityAlert({
          ticker: market.ticker,
          market_title: market.title,
          category: "cross-market",
          trigger_source: mapping.source,
          trigger_event: `${mapping.source} price: ${externalCents}¢ vs Kalshi: ${kalshiCents}¢`,
          trigger_detail: `Cross-market divergence of ${divergence}¢ detected on mapped market`,
          kalshi_price: kalshiCents,
          estimated_fair_value: externalCents,
          edge_cents: divergence,
          side,
          confidence: Math.min(divergence / 20, 0.9),
          staleness_seconds: Math.round((Date.now() - new Date(market.updated_at).getTime()) / 1000),
          window_seconds: 300,
        });

        alerts.push({ ticker: market.ticker, edge: divergence, side });
      }
    }
  }

  // 2. Check crypto price divergences (CoinGecko signals vs Kalshi crypto markets)
  const { data: cryptoSignals } = await supabase
    .from("external_signals")
    .select("*")
    .eq("source", "coingecko")
    .eq("signal_type", "price")
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("fetched_at", { ascending: false })
    .limit(10);

  if (cryptoSignals) {
    for (const signal of cryptoSignals) {
      const coinSymbol = (signal.data as { symbol?: string }).symbol?.toUpperCase();
      if (!coinSymbol) continue;

      // Find Kalshi markets mentioning this crypto
      const { data: markets } = await supabase
        .from("markets")
        .select("ticker, title, last_price, updated_at")
        .in("status", ["open", "active"])
        .not("last_price", "is", null)
        .ilike("title", `%${coinSymbol}%`)
        .limit(20);

      if (!markets) continue;

      for (const market of markets) {
        const updatedAgo = Date.now() - new Date(market.updated_at).getTime();
        // Only alert if market hasn't been updated in 5+ minutes
        if (updatedAgo < 5 * 60 * 1000) continue;

        const price = (signal.data as { price_usd?: number }).price_usd;
        const change24h = (signal.data as { change_24h_pct?: number }).change_24h_pct;
        if (!price || !change24h || Math.abs(change24h) < 3) continue;

        // Significant crypto move + stale Kalshi market = opportunity
        const title = market.title.toLowerCase();
        const isAbove = title.includes("above") || title.includes("over");
        const isBelow = title.includes("below") || title.includes("under");
        if (!isAbove && !isBelow) continue;

        const direction = change24h > 0 ? "up" : "down";
        const side = (isAbove && direction === "up") || (isBelow && direction === "down") ? "yes" : "no";
        const edgeEstimate = Math.round(Math.min(Math.abs(change24h) * 3, 20));

        if (edgeEstimate < 5) continue;

        await sendOpportunityAlert({
          ticker: market.ticker,
          market_title: market.title,
          category: "crypto",
          trigger_source: "coingecko",
          trigger_event: `${coinSymbol} ${direction} ${Math.abs(change24h).toFixed(1)}% ($${price.toLocaleString()})`,
          trigger_detail: `${coinSymbol} moved ${change24h.toFixed(1)}% in 24h but this market hasn't updated in ${Math.round(updatedAgo / 60000)}min`,
          kalshi_price: market.last_price!,
          estimated_fair_value: side === "yes"
            ? Math.min(market.last_price! + edgeEstimate, 95)
            : Math.max(market.last_price! - edgeEstimate, 5),
          edge_cents: edgeEstimate,
          side,
          confidence: Math.min(Math.abs(change24h) / 10, 0.8),
          staleness_seconds: Math.round(updatedAgo / 1000),
          window_seconds: 300,
        });

        alerts.push({ ticker: market.ticker, edge: edgeEstimate, side });
      }
    }
  }

  return NextResponse.json({
    success: true,
    alerts_sent: alerts.length,
    alerts,
  });
}
