import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Derive category from event_ticker prefix.
 * Based on observed Kalshi ticker patterns.
 */
function deriveCategory(eventTicker: string): string | null {
  const t = eventTicker.toUpperCase();

  // Sports
  if (/^KX(NBA|NFL|NHL|MLB|MLS|WNBA|NCAA|PGA|UFC|SOCCER|TENNIS|F1|BOXING)/.test(t)) return "Sports";
  if (/^KX(LIVTOUR|DPWORLDTOUR|MASTERS|USOPEN|WIMBLEDON|MARMAD|ATP|WTA|CS2|EFL|KBL|EPL|LALIGA|BUNDESLIGA|SERIEA|LIGUE1|CHAMPSLEAGUE|EUROCUP|RUGBY|VALORANT|LOL|TEAMSIN|QUICKSETTLE|MOTOGP|DOTA|ROCKETLEAGUE|LIGAMX|LPGA|ARSENAL|SWENCOUNTERS|T20)/.test(t)) return "Sports";
  if (/^KXSUPERBOWL/.test(t)) return "Sports";
  // Catch-all for league games (AHL, KHL, CBA, SHL, ELH, ABA, Euroleague, Argentine basketball, etc.)
  if (/^KX(AHL|KHL|CBA|SHL|ELH|ABA|ARGLNB|EUROLEAGUE|VTB|WNBL|BBL|LNP|ACB|BSL|SUPER14|NBDL|ECHL)/.test(t)) return "Sports";
  if (/GAME-/.test(t) && /^KX/.test(t)) return "Sports"; // any KXFOO...GAME-date pattern is sports
  if (/^KXMVE(SPORTS|CB)/.test(t)) return "Sports";

  // Multi-variable events (cross-category)
  if (/^KXMVECROSSCATEGORY/.test(t)) return "Multi-Category";

  // Crypto
  if (/^KX(BTC|ETH|SOL|DOGE|XRP|ADA|CRYPTO|BNB|HYPE|LTC|XLM|AVAX|LINK|DOT|UNI|SHIB|MATIC|PEPE|ARB|OP|SUI|APT|BCH|NEAR|TRX|TON|ATOM|FIL|ICP|RENDER|FET|AAVE|STX)/.test(t)) return "Crypto";

  // Economics / Financials
  if (/^KX(CPI|GDP|UNEMPLOYMENT|JOBS|NONFARM|FED|FOMC|RATE|INFLATION|RETAIL|HOUSING|ISM|PMI|PCE|CBDECISION)/.test(t)) return "Economics";
  if (/^(KX)?(INX|INXD|INXW|NASDAQ|SPX|SP500|DOW|RUSSELL)/.test(t)) return "Financials";
  if (/^KXSPOTIFY/.test(t)) return "Financials"; // stock/streaming metrics
  if (/^KX(WTI|CRUDE|OIL|GAS|AAAGASM|BRENT|USEDCAR)/.test(t)) return "Financials";
  if (/^KXEARNINGS/.test(t)) return "Financials";

  // Weather / Climate
  if (/^KX(HIGH|LOWT|TEMP|RAIN|SNOW|HURRICANE|WEATHER|HEAT|COLD)/.test(t)) return "Climate and Weather";

  // Politics / Government
  if (/^KX(PRES|POTUS|CONGRESS|SENATE|HOUSE|ELECT|GOV|TRUMP|BIDEN|APPROVAL|SCOTUS|CABINET|BORDER|DHS|MTP|TARIFF|EXECUTIVE)/.test(t)) return "Politics";
  if (/^KX(MTP|BESSENT|FOXNEWS)MENTION/.test(t)) return "Politics"; // TV mentions
  if (/^KXDHSFUND/.test(t)) return "Politics"; // DHS funding

  // Tech / Entertainment
  if (/^KX(AI|CHATGPT|OPENAI|GOOGLE|META|APPLE|MSFT|TESLA|TSLA|LLM|TECHRANK|TOPMODEL|SPOT(STREAM|IFY))/.test(t)) return "Tech";
  if (/^KXOSCAR/.test(t)) return "Entertainment";

  return null;
}

async function main() {
  console.log("Backfilling event categories from ticker prefixes...\n");

  // Get all events with NULL category
  const { data: nullEvents, error } = await supabase
    .from("events")
    .select("event_ticker, title, category")
    .is("category", null);

  if (error) {
    console.error("Failed to query events:", error.message);
    process.exit(1);
  }

  console.log(`Found ${nullEvents?.length ?? 0} events with NULL category\n`);
  if (!nullEvents || nullEvents.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // Derive categories
  const categorized = new Map<string, Array<{ event_ticker: string }>>();
  let unmatched = 0;

  for (const event of nullEvents) {
    const category = deriveCategory(event.event_ticker);
    if (category) {
      if (!categorized.has(category)) categorized.set(category, []);
      categorized.get(category)!.push({ event_ticker: event.event_ticker });
    } else {
      unmatched++;
    }
  }

  // Report
  console.log("Category breakdown:");
  for (const [category, events] of categorized) {
    console.log(`  ${category}: ${events.length} events`);
  }
  console.log(`  Unmatched: ${unmatched} events\n`);

  // Apply updates in batches
  let totalUpdated = 0;
  for (const [category, events] of categorized) {
    const tickers = events.map((e) => e.event_ticker);
    const batchSize = 500;
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const { error: updateError } = await supabase
        .from("events")
        .update({ category })
        .in("event_ticker", batch);

      if (updateError) {
        console.error(`Failed to update ${category} batch:`, updateError.message);
      } else {
        totalUpdated += batch.length;
      }
    }
  }

  console.log(`\nDone. Updated ${totalUpdated} events. ${unmatched} remain unmatched.`);

  // Show sample of unmatched for manual review
  if (unmatched > 0) {
    const unmatchedSamples = nullEvents
      .filter((e) => !deriveCategory(e.event_ticker))
      .slice(0, 20);
    console.log("\nSample unmatched event tickers:");
    for (const e of unmatchedSamples) {
      console.log(`  ${e.event_ticker} — "${e.title}"`);
    }
  }
}

main();
