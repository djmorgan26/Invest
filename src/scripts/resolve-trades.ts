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
    // Fetch all open paper trades
    const { data: openTrades, error: fetchError } = await supabase
      .from("paper_trades")
      .select("*")
      .eq("status", "open");

    if (fetchError) {
      throw new Error(`Failed to fetch open trades: ${fetchError.message}`);
    }

    if (!openTrades || openTrades.length === 0) {
      console.log(JSON.stringify({ status: "success", message: "No open trades to resolve", resolved: 0 }));
      return;
    }

    const resolved: Array<{
      id: string;
      ticker: string;
      side: string;
      entry_price: number;
      exit_price: number;
      quantity: number;
      pnl: number;
      result: string;
    }> = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    // Group trades by ticker to avoid redundant API calls
    const tradesByTicker: Record<string, typeof openTrades> = {};
    for (const trade of openTrades) {
      if (!tradesByTicker[trade.ticker]) {
        tradesByTicker[trade.ticker] = [];
      }
      tradesByTicker[trade.ticker].push(trade);
    }

    for (const [ticker, trades] of Object.entries(tradesByTicker)) {
      let market;
      try {
        market = await getMarket(ticker);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${ticker}: Failed to fetch market - ${msg}`);
        continue;
      }

      // Check if market has settled
      if (!market.result || market.result === "") {
        skipped.push(ticker);
        continue;
      }

      for (const trade of trades) {
        // Determine exit price: 1.00 if result matches side, 0.00 if not
        const won =
          (trade.side === "yes" && market.result === "yes") ||
          (trade.side === "no" && market.result === "no");
        const exitPrice = won ? 1.0 : 0.0;
        const pnl = (exitPrice - trade.price) * trade.quantity;

        const { error: updateError } = await supabase
          .from("paper_trades")
          .update({
            status: "closed" as const,
            exit_price: exitPrice,
            pnl: Math.round(pnl * 100) / 100,
            closed_at: new Date().toISOString(),
          })
          .eq("id", trade.id);

        if (updateError) {
          errors.push(`${trade.id}: Failed to update - ${updateError.message}`);
          continue;
        }

        resolved.push({
          id: trade.id,
          ticker: trade.ticker,
          side: trade.side,
          entry_price: trade.price,
          exit_price: exitPrice,
          quantity: trade.quantity,
          pnl: Math.round(pnl * 100) / 100,
          result: market.result,
        });
      }
    }

    const totalPnl = resolved.reduce((sum, r) => sum + r.pnl, 0);

    const summary = {
      status: "success",
      resolved_at: new Date().toISOString(),
      open_trades_found: openTrades.length,
      resolved: resolved.length,
      skipped_not_settled: skipped.length,
      skipped_tickers: skipped.length > 0 ? skipped : undefined,
      errors: errors.length > 0 ? errors : undefined,
      total_pnl: Math.round(totalPnl * 100) / 100,
      trades: resolved,
    };

    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ status: "error", error: errorMessage }));
    process.exit(1);
  }
}

main();
