import { NextRequest, NextResponse } from "next/server";
import { getAllActiveMarkets, getSettledMarkets, getEvent } from "@/lib/kalshi/client";
import { createServerClient } from "@/lib/supabase/server";
import { dollarsToCents, fpToInt } from "@/lib/kalshi/types";

export const maxDuration = 60;

const BATCH_SIZE = 500;
const MAX_PAGES = 25; // ~5000 markets per invocation to stay within timeout
const EVENT_ENRICH_LIMIT = 10; // fewer enrichments to stay fast
const EVENT_ENRICH_DELAY_MS = 200;

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

    // Check for a cursor from previous partial sync
    const url = new URL(request.url);
    const resumeCursor = url.searchParams.get("cursor") || undefined;

    const markets = await getAllActiveMarkets(MAX_PAGES, resumeCursor);

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

    const nextCursor = (markets as { nextCursor?: string }).nextCursor;
    const isPartial = !!nextCursor;

    // Only do settled sync + event enrichment on final chunk (no more cursor)
    let settledCount = 0;
    let eventsEnriched = 0;

    if (!isPartial) {
      // --- Sync recently settled markets ---
      try {
        const settledMarkets = await getSettledMarkets(500);
        for (let i = 0; i < settledMarkets.length; i += BATCH_SIZE) {
          const batch = settledMarkets.slice(i, i + BATCH_SIZE).map((m) => ({
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
          await supabase.from("markets").upsert(batch, { onConflict: "ticker" });
        }
        settledCount = settledMarkets.length;
      } catch {
        // Non-fatal
      }

      // --- Event enrichment ---
      const { data: bareEvents } = await supabase
        .from("events")
        .select("event_ticker")
        .is("category", null)
        .limit(EVENT_ENRICH_LIMIT);

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
            // Skip
          }
          if (i < bareEvents.length - 1) {
            await sleep(EVENT_ENRICH_DELAY_MS);
          }
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
      settled_synced: settledCount,
      partial: isPartial,
      next_cursor: nextCursor || null,
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
