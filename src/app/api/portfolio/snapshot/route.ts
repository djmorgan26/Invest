import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

const STARTING_BALANCE = 10000;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerClient();

    // Get all closed trades for realized P&L
    const { data: closedTrades } = await supabase
      .from("paper_trades")
      .select("pnl")
      .eq("status", "closed");

    const realizedPnl = (closedTrades ?? []).reduce((sum, t) => sum + (t.pnl ?? 0), 0);

    // Get all open trades for cost basis and unrealized P&L
    const { data: openTrades } = await supabase
      .from("paper_trades")
      .select("ticker, side, quantity, price, cost")
      .eq("status", "open");

    let totalOpenCost = 0;
    let unrealizedPnl = 0;

    if (openTrades && openTrades.length > 0) {
      // Get current prices for open positions
      const tickers = [...new Set(openTrades.map((t) => t.ticker))];
      const { data: currentMarkets } = await supabase
        .from("markets")
        .select("ticker, last_price")
        .in("ticker", tickers);

      const priceMap = new Map(
        (currentMarkets ?? []).map((m) => [m.ticker, m.last_price])
      );

      for (const trade of openTrades) {
        totalOpenCost += trade.cost ?? 0;
        const currentPrice = priceMap.get(trade.ticker);
        if (currentPrice != null) {
          const currentNorm = currentPrice / 100;
          const currentValue = trade.side === "yes"
            ? currentNorm * trade.quantity
            : (1 - currentNorm) * trade.quantity;
          unrealizedPnl += currentValue - (trade.cost ?? 0);
        }
      }
    }

    const cash = STARTING_BALANCE - totalOpenCost + realizedPnl;
    const openPositionValue = totalOpenCost + unrealizedPnl;
    const totalValue = cash + openPositionValue;

    const { error } = await supabase.from("portfolio_snapshots").insert({
      cash: Math.round(cash * 100) / 100,
      unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
      realized_pnl: Math.round(realizedPnl * 100) / 100,
      total_value: Math.round(totalValue * 100) / 100,
    });

    if (error) {
      throw new Error(`Failed to insert portfolio snapshot: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      snapshot: {
        cash: Math.round(cash * 100) / 100,
        unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
        realized_pnl: Math.round(realizedPnl * 100) / 100,
        total_value: Math.round(totalValue * 100) / 100,
        open_positions: openTrades?.length ?? 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
