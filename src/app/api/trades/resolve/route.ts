import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

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

    // Get unique tickers and check settlement status
    const tickers = [...new Set(openTrades.map((t) => t.ticker))];
    const { data: settledMarkets, error: marketsError } = await supabase
      .from("markets")
      .select("ticker, result, status")
      .in("ticker", tickers)
      .not("result", "is", null);

    if (marketsError) {
      throw new Error(`Failed to fetch market results: ${marketsError.message}`);
    }

    if (!settledMarkets || settledMarkets.length === 0) {
      return NextResponse.json({
        success: true,
        resolved: 0,
        message: "No settled markets for open trades",
      });
    }

    // Build a map of settled results
    const resultMap = new Map(
      settledMarkets.map((m) => [m.ticker, m.result])
    );

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
