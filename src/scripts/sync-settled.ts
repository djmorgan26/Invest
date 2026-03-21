import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { getMarkets } from "../lib/kalshi/client";
import { dollarsToCents, fpToInt } from "../lib/kalshi/types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log("Syncing settled markets from production API...");
  let cursor: string | undefined;
  let total = 0;

  do {
    const r = await getMarkets({ limit: 200, status: "settled", cursor });

    // Insert event stubs first to satisfy FK constraint
    const eventMap = new Map<string, { event_ticker: string; title: string }>();
    for (const m of r.markets) {
      if (!eventMap.has(m.event_ticker)) {
        eventMap.set(m.event_ticker, { event_ticker: m.event_ticker, title: m.event_ticker });
      }
    }
    await supabase
      .from("events")
      .upsert(Array.from(eventMap.values()), { onConflict: "event_ticker", ignoreDuplicates: true });

    const batch = r.markets.map((m) => ({
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
    if (error) console.error("Upsert error:", error.message);

    total += batch.length;
    cursor = r.cursor || undefined;
    process.stdout.write(`\r  ${total} markets synced...`);
  } while (cursor && total < 2000);

  console.log(`\nDone. Synced ${total} settled markets from production API.`);

  // Check results
  const { count } = await supabase
    .from("markets")
    .select("*", { count: "exact", head: true })
    .not("result", "is", null)
    .neq("result", "");
  console.log(`Markets with real results: ${count}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
