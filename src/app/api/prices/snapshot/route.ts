import { NextRequest, NextResponse } from "next/server";
import { getMarket } from "@/lib/kalshi/client";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerClient();

    // --- Part 1: Watchlist tickers (live Kalshi API calls) ---
    const { data: watchlist, error: watchlistError } = await supabase
      .from("watchlist")
      .select("ticker");

    if (watchlistError) {
      throw new Error(`Failed to fetch watchlist: ${watchlistError.message}`);
    }

    const watchlistResults = await Promise.allSettled(
      (watchlist ?? []).map(async ({ ticker }) => {
        const market = await getMarket(ticker);
        const { error } = await supabase.from("price_snapshots").insert({
          ticker: market.ticker,
          yes_bid: market.yes_bid,
          yes_ask: market.yes_ask,
          last_price: market.last_price,
          volume: market.volume,
        });
        if (error) {
          throw new Error(`Snapshot insert failed for ${ticker}: ${error.message}`);
        }
        return ticker;
      })
    );

    const watchlistSucceeded = watchlistResults.filter((r) => r.status === "fulfilled").length;
    const watchlistFailed = watchlistResults.filter((r) => r.status === "rejected").length;

    // --- Part 2: Top 200 markets by volume from DB (no Kalshi API calls) ---
    const { data: topMarkets, error: topError } = await supabase
      .from("markets")
      .select("ticker, yes_bid, yes_ask, last_price, volume")
      .in("status", ["open", "active"])
      .not("yes_bid", "is", null)
      .not("last_price", "is", null)
      .order("volume", { ascending: false })
      .limit(200);

    let dbSnapshotsCreated = 0;
    if (!topError && topMarkets && topMarkets.length > 0) {
      // Exclude tickers already snapshotted via watchlist to avoid duplicates
      const watchlistTickers = new Set((watchlist ?? []).map((w) => w.ticker));
      const newMarkets = topMarkets.filter((m) => !watchlistTickers.has(m.ticker));

      if (newMarkets.length > 0) {
        const rows = newMarkets.map((m) => ({
          ticker: m.ticker,
          yes_bid: m.yes_bid,
          yes_ask: m.yes_ask,
          last_price: m.last_price,
          volume: m.volume,
        }));

        const { error: insertError } = await supabase
          .from("price_snapshots")
          .insert(rows);

        if (!insertError) {
          dbSnapshotsCreated = rows.length;
        }
      }
    }

    const errors = watchlistResults
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason?.message || "Unknown error");

    return NextResponse.json({
      success: watchlistFailed === 0,
      watchlist_snapshots: watchlistSucceeded,
      watchlist_failed: watchlistFailed,
      db_snapshots: dbSnapshotsCreated,
      total_snapshots: watchlistSucceeded + dbSnapshotsCreated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
