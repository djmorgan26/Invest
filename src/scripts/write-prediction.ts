import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function parseArgs(): {
  ticker: string;
  side: "yes" | "no";
  confidence: number;
  fairValue: number;
  reasoning: string;
} {
  const args = process.argv.slice(2);
  let ticker = "";
  let side = "";
  let confidence = NaN;
  let fairValue = NaN;
  let reasoning = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--ticker":
        ticker = args[++i];
        break;
      case "--side":
        side = args[++i];
        break;
      case "--confidence":
        confidence = parseFloat(args[++i]);
        break;
      case "--fair-value":
        fairValue = parseFloat(args[++i]);
        break;
      case "--reasoning":
        reasoning = args[++i];
        break;
    }
  }

  if (!ticker) throw new Error("Missing required arg: --ticker");
  if (side !== "yes" && side !== "no") throw new Error("--side must be 'yes' or 'no'");
  if (isNaN(confidence) || confidence < 0 || confidence > 1) throw new Error("--confidence must be between 0 and 1");
  if (isNaN(fairValue) || fairValue < 0 || fairValue > 1) throw new Error("--fair-value must be between 0 and 1");
  if (!reasoning) throw new Error("Missing required arg: --reasoning");

  return { ticker, side: side as "yes" | "no", confidence, fairValue, reasoning };
}

async function main() {
  try {
    const { ticker, side, confidence, fairValue, reasoning } = parseArgs();

    // Get latest price for edge calculation
    const { data: snapshot, error: snapError } = await supabase
      .from("price_snapshots")
      .select("last_price")
      .eq("ticker", ticker)
      .order("snapshot_at", { ascending: false })
      .limit(1)
      .single();

    let lastPrice: number;
    if (snapError || !snapshot) {
      // Fall back to markets table
      const { data: market, error: marketError } = await supabase
        .from("markets")
        .select("last_price")
        .eq("ticker", ticker)
        .single();

      if (marketError || !market || market.last_price == null) {
        throw new Error(`Cannot find price for ticker ${ticker}. Sync markets first.`);
      }
      lastPrice = market.last_price;
    } else {
      lastPrice = snapshot.last_price;
    }

    // Calculate edge
    const edge = Math.abs(fairValue - lastPrice);

    // Insert prediction
    const { data: prediction, error: insertError } = await supabase
      .from("predictions")
      .insert({
        ticker,
        side,
        confidence,
        fair_value: fairValue,
        edge: Math.round(edge * 10000) / 10000,
        reasoning,
        status: "pending" as const,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to insert prediction: ${insertError.message}`);
    }

    const output = {
      status: "success",
      prediction,
      metadata: {
        last_price: lastPrice,
        calculated_edge: Math.round(edge * 10000) / 10000,
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
