import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { getMarket } from "../lib/kalshi/client";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function parseArgs(): {
  ticker: string;
  side: "yes" | "no";
  quantity: number;
  predictionId: string | null;
} {
  const args = process.argv.slice(2);
  let ticker = "";
  let side = "";
  let quantity = NaN;
  let predictionId: string | null = null;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--ticker":
        ticker = args[++i];
        break;
      case "--side":
        side = args[++i];
        break;
      case "--quantity":
        quantity = parseInt(args[++i], 10);
        break;
      case "--prediction-id":
        predictionId = args[++i];
        break;
    }
  }

  if (!ticker) throw new Error("Missing required arg: --ticker");
  if (side !== "yes" && side !== "no") throw new Error("--side must be 'yes' or 'no'");
  if (isNaN(quantity) || quantity <= 0) throw new Error("--quantity must be a positive integer");

  return { ticker, side: side as "yes" | "no", quantity, predictionId };
}

async function main() {
  try {
    const { ticker, side, quantity, predictionId } = parseArgs();

    // Fetch current market price from Kalshi
    const market = await getMarket(ticker);

    // Price is the yes_ask if buying yes, or (1 - yes_bid) if buying no
    // Kalshi prices are in cents (0-99), normalize to 0-1
    const price = side === "yes" ? market.yes_ask : (100 - market.yes_bid);
    const priceNormalized = price / 100;
    const cost = quantity * priceNormalized;

    // Insert paper trade
    const { data: trade, error: insertError } = await supabase
      .from("paper_trades")
      .insert({
        ticker,
        side,
        quantity,
        price: priceNormalized,
        cost: Math.round(cost * 100) / 100,
        status: "open" as const,
        exit_price: null,
        pnl: null,
        prediction_id: predictionId,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to insert paper trade: ${insertError.message}`);
    }

    const output = {
      status: "success",
      trade,
      metadata: {
        market_title: market.title,
        market_status: market.status,
        yes_bid: market.yes_bid,
        yes_ask: market.yes_ask,
        last_price: market.last_price,
      },
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ status: "error", error: errorMessage }));
    process.exit(1);
  }
}

main();
