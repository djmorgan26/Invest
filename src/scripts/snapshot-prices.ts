import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { getMarket } from "../lib/kalshi/client";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  try {
    // Get all watchlisted tickers
    const { data: watchlist, error: watchError } = await supabase
      .from("watchlist")
      .select("ticker");

    if (watchError) {
      throw new Error(`Failed to fetch watchlist: ${watchError.message}`);
    }

    if (!watchlist || watchlist.length === 0) {
      console.log(JSON.stringify({ status: "success", snapshots_created: 0, message: "No tickers in watchlist" }));
      return;
    }

    let snapshotsCreated = 0;
    const errors: string[] = [];

    for (const item of watchlist) {
      try {
        const market = await getMarket(item.ticker);

        const { error: insertError } = await supabase.from("price_snapshots").insert({
          ticker: market.ticker,
          yes_bid: market.yes_bid,    // already in cents (0-100) from normalizeMarket
          yes_ask: market.yes_ask,
          last_price: market.last_price,
          volume: market.volume,
        });

        if (insertError) {
          errors.push(`${item.ticker}: ${insertError.message}`);
          continue;
        }
        snapshotsCreated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${item.ticker}: ${msg}`);
      }
    }

    const summary = {
      status: errors.length === 0 ? "success" : "partial",
      watchlist_size: watchlist.length,
      snapshots_created: snapshotsCreated,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ status: "error", error: errorMessage }));
    process.exit(1);
  }
}

main();
