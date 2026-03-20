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

    // Get all watchlist tickers
    const { data: watchlist, error: watchlistError } = await supabase
      .from("watchlist")
      .select("ticker");

    if (watchlistError) {
      throw new Error(`Failed to fetch watchlist: ${watchlistError.message}`);
    }

    if (!watchlist || watchlist.length === 0) {
      return NextResponse.json({
        success: true,
        snapshots_created: 0,
        message: "No tickers on watchlist",
      });
    }

    // Fetch current prices and insert snapshots
    const results = await Promise.allSettled(
      watchlist.map(async ({ ticker }) => {
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

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason?.message || "Unknown error");

    return NextResponse.json({
      success: failed === 0,
      snapshots_created: succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
