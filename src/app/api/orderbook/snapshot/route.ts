import { NextRequest, NextResponse } from "next/server";
import { getOrderBook } from "@/lib/kalshi/client";
import { createServerClient } from "@/lib/supabase/server";
import { dollarsToCents } from "@/lib/kalshi/types";

const MAX_TICKERS_PER_RUN = 20;
const DELAY_MS = 200; // Rate-limit: 200ms between Kalshi API calls

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLevel(entry: [string, string]) {
  return { price: dollarsToCents(entry[0]) ?? 0, quantity: Math.round(parseFloat(entry[1])) };
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerClient();

    // Get watchlisted tickers (most relevant markets)
    const { data: watchlist, error: watchlistError } = await supabase
      .from("watchlist")
      .select("ticker")
      .limit(MAX_TICKERS_PER_RUN);

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

    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < watchlist.length; i++) {
      const { ticker } = watchlist[i];
      try {
        const response = await getOrderBook(ticker, 5);
        const book = response.orderbook_fp;

        const yesLevels = (book.yes_dollars ?? []).map(parseLevel);
        const noLevels = (book.no_dollars ?? []).map(parseLevel);

        // Yes levels are sorted by price (best bid = highest price for yes)
        // No levels sorted by price (lowest no_bid = lowest yes_ask via 100-price)
        const bestYesBid = yesLevels.length > 0 ? yesLevels[0].price : null;
        const bestYesAsk = noLevels.length > 0 ? 100 - noLevels[0].price : null;
        const spread = bestYesBid != null && bestYesAsk != null ? bestYesAsk - bestYesBid : null;

        const { error: insertError } = await supabase
          .from("orderbook_snapshots")
          .insert({
            ticker,
            best_yes_bid: bestYesBid,
            best_yes_ask: bestYesAsk,
            spread,
            depth_yes_bid: yesLevels.slice(0, 5),
            depth_yes_ask: noLevels.slice(0, 5).map((l) => ({
              price: 100 - l.price,
              quantity: l.quantity,
            })),
          });

        if (insertError) {
          throw new Error(insertError.message);
        }
        succeeded++;
      } catch (err) {
        failed++;
        errors.push(`${ticker}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }

      // Rate-limit between API calls
      if (i < watchlist.length - 1) {
        await sleep(DELAY_MS);
      }
    }

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
