import { NextResponse } from "next/server";
import { getAllActiveMarkets, getEvent } from "@/lib/kalshi/client";
import { createServerClient } from "@/lib/supabase/server";
import { dollarsToCents, fpToInt } from "@/lib/kalshi/types";

export async function POST() {
  try {
    const startedAt = new Date().toISOString();
    const supabase = createServerClient();

    // Fetch all active markets from Kalshi
    const markets = await getAllActiveMarkets();

    // Collect unique event tickers
    const eventTickers = [...new Set(markets.map((m) => m.event_ticker))];

    // Fetch and upsert events
    const eventResults = await Promise.allSettled(
      eventTickers.map(async (eventTicker) => {
        const { event } = await getEvent(eventTicker);
        return event;
      })
    );

    const events = eventResults
      .filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof getEvent>>["event"]> =>
          r.status === "fulfilled"
      )
      .map((r) => r.value);

    // Upsert events into supabase
    if (events.length > 0) {
      const { error: eventError } = await supabase.from("events").upsert(
        events.map((e) => ({
          event_ticker: e.event_ticker,
          title: e.title,
          category: e.category,
          sub_title: e.sub_title,
          mutually_exclusive: e.mutually_exclusive,
          status: e.status,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "event_ticker" }
      );
      if (eventError) {
        throw new Error(`Event upsert failed: ${eventError.message}`);
      }
    }

    // Upsert markets into supabase
    if (markets.length > 0) {
      const { error: marketError } = await supabase.from("markets").upsert(
        markets.map((m) => ({
          ticker: m.ticker,
          event_ticker: m.event_ticker,
          title: m.title,
          subtitle: m.subtitle,
          status: m.status,
          yes_bid: dollarsToCents(m.yes_bid_dollars),
          yes_ask: dollarsToCents(m.yes_ask_dollars),
          last_price: dollarsToCents(m.last_price_dollars),
          volume: fpToInt(m.volume_fp),
          open_interest: fpToInt(m.open_interest_fp),
          close_time: m.close_time,
          result: m.result || null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "ticker" }
      );
      if (marketError) {
        throw new Error(`Market upsert failed: ${marketError.message}`);
      }
    }

    const completedAt = new Date().toISOString();

    // Log sync result
    await supabase.from("sync_log").insert({
      type: "market_sync",
      status: "success",
      records_processed: markets.length,
      started_at: startedAt,
      completed_at: completedAt,
    });

    return NextResponse.json({
      success: true,
      message: `Synced ${events.length} events and ${markets.length} markets.`,
      events_synced: events.length,
      markets_synced: markets.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Attempt to log the error
    try {
      const supabase = createServerClient();
      await supabase.from("sync_log").insert({
        type: "market_sync",
        status: "error",
        records_processed: 0,
        error_message: message,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    } catch {
      // Silently fail logging — the main error is returned below
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
