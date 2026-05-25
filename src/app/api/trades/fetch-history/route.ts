import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getTrades } from "@/lib/kalshi/client";
import { normalizeTrade } from "@/lib/kalshi/types";

export const maxDuration = 300; // 5 minute timeout for this route

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createServerClient();
    const maxMarkets = 50; // conservative per run

    // Find settled markets that need trade history
    const { data: settledMarkets } = await supabase
      .from("markets")
      .select("ticker, volume")
      .not("result", "is", null)
      .gte("volume", 100)
      .order("volume", { ascending: false })
      .limit(maxMarkets * 3);

    if (!settledMarkets || settledMarkets.length === 0) {
      return NextResponse.json({ success: true, fetched: 0, message: "No settled markets" });
    }

    // Check which settled markets already have trades by querying just their tickers
    const settledTickers = settledMarkets.map((m: { ticker: string }) => m.ticker);
    const { data: existing } = await supabase
      .from("market_trades")
      .select("ticker")
      .in("ticker", settledTickers.slice(0, 500));

    const existingTickers = new Set((existing ?? []).map((t: { ticker: string }) => t.ticker));
    const toFetch = settledMarkets
      .filter((m: { ticker: string }) => !existingTickers.has(m.ticker))
      .slice(0, maxMarkets);

    let totalTrades = 0;
    let errors = 0;

    for (const market of toFetch) {
      try {
        const response = await getTrades(market.ticker, { limit: 200 });
        const trades = response.trades;
        if (trades.length === 0) continue;

        // Store trades — use normalizeTrade to handle both legacy and _dollars/_fp fields
        const batch = trades.map((t) => {
          const normalized = normalizeTrade(t);
          return {
            ticker: t.ticker,
            trade_id: t.trade_id,
            count: normalized.count,
            yes_price: normalized.yes_price,
            no_price: normalized.no_price,
            taker_side: t.taker_side,
            created_time: t.created_time,
          };
        });

        const { error: insertErr } = await supabase
          .from("market_trades")
          .upsert(batch, { onConflict: "trade_id" });

        if (insertErr) {
          errors++;
        } else {
          totalTrades += trades.length;
        }

        // Build hourly candles using normalized trade data
        const normalizedTrades = trades.map((t) => ({ ...t, ...normalizeTrade(t) }));
        const sortedTrades = [...normalizedTrades].sort(
          (a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime()
        );

        const hourMs = 60 * 60 * 1000;
        const candles: Array<{
          ticker: string;
          interval: string;
          open_price: number;
          high_price: number;
          low_price: number;
          close_price: number;
          volume: number;
          vwap: number;
          trade_count: number;
          bucket_start: string;
        }> = [];

        const buckets = new Map<number, typeof sortedTrades>();
        for (const trade of sortedTrades) {
          const ts = new Date(trade.created_time).getTime();
          const bucketStart = Math.floor(ts / hourMs) * hourMs;
          if (!buckets.has(bucketStart)) buckets.set(bucketStart, []);
          buckets.get(bucketStart)!.push(trade);
        }

        for (const [bucketStart, bucketTrades] of buckets) {
          const prices = bucketTrades.map((t) => t.yes_price);
          const totalVol = bucketTrades.reduce((s, t) => s + t.count, 0);
          const vwapNum = bucketTrades.reduce((s, t) => s + t.yes_price * t.count, 0);

          candles.push({
            ticker: market.ticker,
            interval: "1h",
            open_price: prices[0],
            high_price: Math.max(...prices),
            low_price: Math.min(...prices),
            close_price: prices[prices.length - 1],
            volume: totalVol,
            vwap: totalVol > 0 ? Math.round(vwapNum / totalVol) : prices[0],
            trade_count: bucketTrades.length,
            bucket_start: new Date(bucketStart).toISOString(),
          });
        }

        if (candles.length > 0) {
          await supabase
            .from("market_candles")
            .upsert(candles, { onConflict: "ticker,interval,bucket_start" });
        }

        // Rate limit
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to fetch trades for ${market.ticker}: ${errMsg}`);
        errors++;
      }
    }

    // Log
    await supabase.from("sync_log").insert({
      type: "historical_trades",
      status: errors > 0 ? "error" : "success",
      records_processed: totalTrades,
      error_message: errors > 0 ? `${errors} errors` : null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      fetched: toFetch.length,
      totalTrades,
      errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
