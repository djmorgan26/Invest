import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  try {
    // Get all watchlisted tickers
    const { data: watchlist, error: watchError } = await supabase
      .from("watchlist")
      .select("ticker, notes");

    if (watchError) {
      throw new Error(`Failed to fetch watchlist: ${watchError.message}`);
    }

    if (!watchlist || watchlist.length === 0) {
      console.log(JSON.stringify({ status: "success", markets: [], message: "No tickers in watchlist" }));
      return;
    }

    const analyses = [];

    for (const item of watchlist) {
      // Get market data
      const { data: market, error: marketError } = await supabase
        .from("markets")
        .select("*")
        .eq("ticker", item.ticker)
        .single();

      if (marketError || !market) {
        analyses.push({
          ticker: item.ticker,
          error: marketError?.message || "Market not found",
        });
        continue;
      }

      // Get recent price snapshots (last 48 hours, ordered by time)
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { data: snapshots, error: snapError } = await supabase
        .from("price_snapshots")
        .select("*")
        .eq("ticker", item.ticker)
        .gte("snapshot_at", cutoff)
        .order("snapshot_at", { ascending: true });

      if (snapError) {
        analyses.push({
          ticker: item.ticker,
          error: `Failed to fetch snapshots: ${snapError.message}`,
        });
        continue;
      }

      // Calculate 24h price change
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const oldSnapshot = snapshots?.find(
        (s) => new Date(s.snapshot_at).getTime() >= oneDayAgo
      );
      const latestSnapshot = snapshots && snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

      const currentPrice = latestSnapshot?.last_price ?? market.last_price;
      const priceChange24h =
        oldSnapshot && currentPrice != null
          ? currentPrice - oldSnapshot.last_price
          : null;

      // Calculate days until close
      const closeTime = market.close_time ? new Date(market.close_time) : null;
      const daysUntilClose = closeTime
        ? Math.max(0, (closeTime.getTime() - now) / (1000 * 60 * 60 * 24))
        : null;

      // Build price history array
      const priceHistory = (snapshots || []).map((s) => ({
        time: s.snapshot_at,
        last_price: s.last_price,
        yes_bid: s.yes_bid,
        yes_ask: s.yes_ask,
        volume: s.volume,
      }));

      analyses.push({
        ticker: market.ticker,
        title: market.title,
        event_ticker: market.event_ticker,
        status: market.status,
        current_price: currentPrice,
        yes_bid: market.yes_bid,
        yes_ask: market.yes_ask,
        price_change_24h: priceChange24h != null ? Math.round(priceChange24h * 100) / 100 : null,
        volume: market.volume,
        open_interest: market.open_interest,
        close_time: market.close_time,
        days_until_close: daysUntilClose != null ? Math.round(daysUntilClose * 100) / 100 : null,
        result: market.result,
        notes: item.notes,
        recent_price_history: priceHistory,
        snapshot_count: priceHistory.length,
      });
    }

    const output = {
      status: "success",
      analyzed_at: new Date().toISOString(),
      market_count: analyses.length,
      markets: analyses,
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ status: "error", error: errorMessage }));
    process.exit(1);
  }
}

main();
