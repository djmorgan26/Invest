import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { getAllActiveMarkets } from "../lib/kalshi/client";
import { dollarsToCents, fpToInt } from "../lib/kalshi/types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BATCH_SIZE = 500;

async function main() {
  const startedAt = new Date().toISOString();
  let marketsProcessed = 0;
  let eventsProcessed = 0;

  try {
    const markets = await getAllActiveMarkets();
    console.error(`Fetched ${markets.length} markets from Kalshi`);

    // Create event stubs from market data (avoids fetching each event individually)
    const eventMap = new Map<string, { event_ticker: string; title: string }>();
    for (const m of markets) {
      if (!eventMap.has(m.event_ticker)) {
        // Use event_ticker as title placeholder — full event details fetched on demand
        eventMap.set(m.event_ticker, {
          event_ticker: m.event_ticker,
          title: m.event_ticker,
        });
      }
    }

    // Batch upsert events
    const eventRows = Array.from(eventMap.values());
    console.error(`Upserting ${eventRows.length} events in batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < eventRows.length; i += BATCH_SIZE) {
      const batch = eventRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("events")
        .upsert(batch, { onConflict: "event_ticker", ignoreDuplicates: true });
      if (error) {
        console.error(`Event batch error at ${i}: ${error.message}`);
      } else {
        eventsProcessed += batch.length;
      }
    }
    console.error(`Events done: ${eventsProcessed}`);

    // Batch upsert markets
    console.error(`Upserting ${markets.length} markets in batches of ${BATCH_SIZE}...`);

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
      }));

      const { error } = await supabase
        .from("markets")
        .upsert(batch, { onConflict: "ticker" });
      if (error) {
        console.error(`Market batch error at ${i}: ${error.message}`);
      } else {
        marketsProcessed += batch.length;
      }
    }
    console.error(`Markets done: ${marketsProcessed}`);

    // Log sync
    const completedAt = new Date().toISOString();
    await supabase.from("sync_log").insert({
      type: "markets",
      status: "success" as const,
      records_processed: marketsProcessed,
      error_message: null,
      started_at: startedAt,
      completed_at: completedAt,
    });

    const summary = {
      status: "success",
      markets_synced: marketsProcessed,
      events_synced: eventsProcessed,
      total_markets_fetched: markets.length,
      started_at: startedAt,
      completed_at: completedAt,
    };

    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    const completedAt = new Date().toISOString();
    const errorMessage = err instanceof Error ? err.message : String(err);

    await supabase.from("sync_log").insert({
      type: "markets",
      status: "error" as const,
      records_processed: marketsProcessed + eventsProcessed,
      error_message: errorMessage,
      started_at: startedAt,
      completed_at: completedAt,
    });

    console.error(`Error: ${errorMessage}`);
    process.exit(1);
  }
}

main();
