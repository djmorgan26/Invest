import { NextRequest, NextResponse } from "next/server";
import { getAllActiveMarkets, getEvent } from "@/lib/kalshi/client";
import { createServerClient } from "@/lib/supabase/server";
import { dollarsToCents, fpToInt } from "@/lib/kalshi/types";

const BATCH_SIZE = 500;
const EVENT_ENRICH_LIMIT = 50; // max events to enrich per run
const EVENT_ENRICH_DELAY_MS = 200; // rate limit between Kalshi API calls

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startedAt = new Date().toISOString();
    const supabase = createServerClient();

    const markets = await getAllActiveMarkets();

    // Create event stubs from market data
    const eventMap = new Map<string, { event_ticker: string; title: string }>();
    for (const m of markets) {
      if (!eventMap.has(m.event_ticker)) {
        eventMap.set(m.event_ticker, {
          event_ticker: m.event_ticker,
          title: m.event_ticker,
        });
      }
    }

    // Batch upsert events first
    const eventRows = Array.from(eventMap.values());
    for (let i = 0; i < eventRows.length; i += BATCH_SIZE) {
      const batch = eventRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("events")
        .upsert(batch, { onConflict: "event_ticker", ignoreDuplicates: true });
      if (error) throw new Error(`Event upsert failed: ${error.message}`);
    }

    // Batch upsert markets
    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE).map((m) => ({
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
        volume_24h: fpToInt(m.volume_24h_fp),
        liquidity: m.liquidity_dollars ? parseFloat(m.liquidity_dollars) : null,
      }));
      const { error } = await supabase
        .from("markets")
        .upsert(batch, { onConflict: "ticker" });
      if (error) throw new Error(`Market upsert failed: ${error.message}`);
    }

    // --- Event enrichment: fetch mutually_exclusive + category for bare stubs ---
    // Find events missing category (bare stubs from initial sync)
    const { data: bareEvents } = await supabase
      .from("events")
      .select("event_ticker")
      .is("category", null)
      .limit(EVENT_ENRICH_LIMIT);

    let eventsEnriched = 0;
    if (bareEvents && bareEvents.length > 0) {
      for (let i = 0; i < bareEvents.length; i++) {
        const { event_ticker } = bareEvents[i];
        try {
          const eventData = await getEvent(event_ticker);
          const ev = eventData.event;
          await supabase
            .from("events")
            .update({
              title: ev.title,
              category: ev.category || null,
              sub_title: ev.sub_title || null,
              mutually_exclusive: ev.mutually_exclusive ?? false,
            })
            .eq("event_ticker", event_ticker);
          eventsEnriched++;
        } catch {
          // Skip events that fail (may have been delisted)
        }
        if (i < bareEvents.length - 1) {
          await sleep(EVENT_ENRICH_DELAY_MS);
        }
      }
    }

    const completedAt = new Date().toISOString();

    await supabase.from("sync_log").insert({
      type: "market_sync",
      status: "success",
      records_processed: markets.length,
      started_at: startedAt,
      completed_at: completedAt,
    });

    return NextResponse.json({
      success: true,
      events_synced: eventRows.length,
      events_enriched: eventsEnriched,
      markets_synced: markets.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
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
      // silently fail logging
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
