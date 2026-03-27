import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getMarketRaw } from "@/lib/kalshi/client";
import { dollarsToCents, fpToInt } from "@/lib/kalshi/types";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerClient();

    // Find all open paper trades
    const { data: openTrades, error: tradesError } = await supabase
      .from("paper_trades")
      .select("*")
      .eq("status", "open");

    if (tradesError) {
      throw new Error(`Failed to fetch open trades: ${tradesError.message}`);
    }

    if (!openTrades || openTrades.length === 0) {
      return NextResponse.json({
        success: true,
        resolved: 0,
        message: "No open trades to resolve",
      });
    }

    // Fetch fresh market data from Kalshi API for each open trade ticker
    const tickers = [...new Set(openTrades.map((t) => t.ticker))];
    const resultMap = new Map<string, string>();

    for (const ticker of tickers) {
      try {
        const market = await getMarketRaw(ticker);
        // Update DB with fresh data (result, volume, status)
        await supabase
          .from("markets")
          .update({
            result: market.result || null,
            status: market.status,
            volume: fpToInt(market.volume_fp),
            volume_24h: fpToInt(market.volume_24h_fp),
            yes_bid: dollarsToCents(market.yes_bid_dollars),
            yes_ask: dollarsToCents(market.yes_ask_dollars),
            last_price: dollarsToCents(market.last_price_dollars),
          })
          .eq("ticker", ticker);

        if (market.result && market.result !== "") {
          resultMap.set(ticker, market.result);
        } else if (
          market.status === "closed" ||
          market.status === "finalized" ||
          market.status === "settled"
        ) {
          // Market settled but result field empty — infer from last price
          const lastPrice = dollarsToCents(market.last_price_dollars) ?? 50;
          if (lastPrice >= 90) {
            resultMap.set(ticker, "yes");
          } else if (lastPrice <= 10) {
            resultMap.set(ticker, "no");
          }
        } else if (market.close_time) {
          // Fallback: market still "active" but close_time has passed by >24h
          const closeTime = new Date(market.close_time).getTime();
          const now = Date.now();
          const hoursSinceClose = (now - closeTime) / (1000 * 60 * 60);
          if (hoursSinceClose > 24) {
            const lastPrice = dollarsToCents(market.last_price_dollars) ?? 50;
            if (lastPrice >= 90) {
              resultMap.set(ticker, "yes");
            } else if (lastPrice <= 10) {
              resultMap.set(ticker, "no");
            }
          }
        }
        // Rate limit Kalshi API
        await new Promise((r) => setTimeout(r, 200));
      } catch {
        // Skip if API call fails (market may have been delisted)
      }
    }

    if (resultMap.size === 0) {
      return NextResponse.json({
        success: true,
        resolved: 0,
        message: `Checked ${tickers.length} tickers via Kalshi API — none settled yet`,
      });
    }

    let resolved = 0;
    const errors: string[] = [];
    const resolvedPredictionIds: { id: string; correct: boolean }[] = [];

    // Resolve each trade against its market result
    for (const trade of openTrades) {
      const result = resultMap.get(trade.ticker);
      if (!result) continue;

      // Determine exit price: if result matches trade side, payout is $1; otherwise $0
      const won =
        (trade.side === "yes" && result === "yes") ||
        (trade.side === "no" && result === "no");
      const exitPrice = won ? 1 : 0;
      // PnL includes entry fee: profit = (exit - entry) * qty - fee
      const fee = trade.fee ?? 0;
      const pnl = (exitPrice - trade.price) * trade.quantity - fee;

      const { error: updateError } = await supabase
        .from("paper_trades")
        .update({
          status: "closed",
          exit_price: exitPrice,
          pnl,
          closed_at: new Date().toISOString(),
        })
        .eq("id", trade.id);

      if (updateError) {
        errors.push(`Failed to close trade ${trade.id}: ${updateError.message}`);
      } else {
        resolved++;
        // Track linked prediction for resolution
        if (trade.prediction_id) {
          resolvedPredictionIds.push({ id: trade.prediction_id, correct: won });
        }
      }
    }

    // Resolve linked predictions
    let predictionsResolved = 0;
    for (const { id, correct } of resolvedPredictionIds) {
      const { error: predError } = await supabase
        .from("predictions")
        .update({
          status: correct ? "correct" : "incorrect",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "pending");

      if (predError) {
        errors.push(`Failed to resolve prediction ${id}: ${predError.message}`);
      } else {
        predictionsResolved++;
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      resolved,
      predictions_resolved: predictionsResolved,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
