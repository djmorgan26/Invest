import { config } from "dotenv";
config({ path: ".env.local" });

// Must set module alias for @ imports used by strategy engine
import { register } from "tsx/esm/api";
register();

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  try {
    console.log("Loading markets from DB...");

    const { data: markets, error: marketsError } = await supabase
      .from("markets")
      .select("*")
      .in("status", ["open", "active"])
      .not("yes_bid", "is", null)
      .not("last_price", "is", null)
      .order("volume", { ascending: false })
      .limit(5000);

    if (marketsError) throw new Error(`Failed to load markets: ${marketsError.message}`);
    console.log(`Loaded ${markets?.length ?? 0} open markets`);

    // Load enabled strategies
    const { data: dbStrategies } = await supabase
      .from("strategies")
      .select("id, name, enabled, config");

    console.log("\nStrategies:");
    for (const s of dbStrategies ?? []) {
      console.log(`  ${s.id}: ${s.enabled ? "ENABLED" : "disabled"} — ${s.name}`);
    }

    // Import strategies dynamically (they use @/ aliases that work in Next.js)
    // For scripts, we work directly with supabase
    const enabledIds = new Set((dbStrategies ?? []).filter((s) => s.enabled).map((s) => s.id));

    // Wide spread scan
    if (enabledIds.has("wide-spread")) {
      console.log("\n--- Wide Spread ---");
      await runWideSpread(markets ?? [], dbStrategies?.find((s) => s.id === "wide-spread")?.config ?? {});
    }

    // Extreme value scan
    if (enabledIds.has("extreme-value")) {
      console.log("\n--- Extreme Value ---");
      await runExtremeValue(markets ?? [], dbStrategies?.find((s) => s.id === "extreme-value")?.config ?? {});
    }

    // Stale price scan
    if (enabledIds.has("stale-price")) {
      console.log("\n--- Stale Price ---");
      await runStalePrice(markets ?? [], dbStrategies?.find((s) => s.id === "stale-price")?.config ?? {});
    }

    // Mean reversion scan
    if (enabledIds.has("mean-reversion")) {
      console.log("\n--- Mean Reversion ---");
      await runMeanReversion(markets ?? [], dbStrategies?.find((s) => s.id === "mean-reversion")?.config ?? {});
    }

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ status: "error", error: errorMessage }));
    process.exit(1);
  }
}

interface MarketRow {
  ticker: string;
  event_ticker: string;
  title: string;
  status: string;
  yes_bid: number | null;
  yes_ask: number | null;
  last_price: number | null;
  volume: number | null;
  close_time: string | null;
  result: string | null;
  updated_at: string;
}

async function runWideSpread(markets: MarketRow[], config: Record<string, unknown>) {
  const minSpread = (config.min_spread as number) ?? 0.10;
  const minVolume = (config.min_volume as number) ?? 100;
  const maxDays = (config.max_days_to_close as number) ?? 14;
  const now = Date.now();
  let found = 0;

  for (const m of markets) {
    if (m.yes_bid == null || m.yes_ask == null || m.result) continue;
    const spread = (m.yes_ask - m.yes_bid) / 100;
    if (spread < minSpread) continue;
    if ((m.volume ?? 0) < minVolume) continue;
    if (m.close_time) {
      const days = (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60 * 24);
      if (days < 0 || days > maxDays) continue;
    }
    found++;
    if (found <= 10) {
      console.log(`  ${m.ticker}: spread=${(spread * 100).toFixed(0)}¢ vol=${m.volume} "${m.title}"`);
    }
  }
  console.log(`  Total opportunities: ${found}`);
}

async function runExtremeValue(markets: MarketRow[], config: Record<string, unknown>) {
  const lowThresh = (config.low_threshold as number) ?? 0.05;
  const highThresh = (config.high_threshold as number) ?? 0.95;
  const minVolume = (config.min_volume as number) ?? 50;
  const maxDays = (config.max_days_to_close as number) ?? 3;
  const now = Date.now();
  let found = 0;

  for (const m of markets) {
    if (m.last_price == null || m.result) continue;
    const price = m.last_price / 100;
    if ((m.volume ?? 0) < minVolume) continue;
    if (!m.close_time) continue;
    const days = (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60 * 24);
    if (days < 0 || days > maxDays) continue;
    if (price > lowThresh && price < highThresh) continue;
    found++;
    if (found <= 10) {
      const side = price <= lowThresh ? "NO" : "YES";
      console.log(`  ${m.ticker}: price=${(price * 100).toFixed(0)}¢ → ${side} vol=${m.volume} closes=${days.toFixed(1)}d`);
    }
  }
  console.log(`  Total opportunities: ${found}`);
}

async function runStalePrice(markets: MarketRow[], config: Record<string, unknown>) {
  const maxHours = (config.max_hours_since_settlement as number) ?? 48;
  const now = Date.now();

  const eventGroups = new Map<string, MarketRow[]>();
  for (const m of markets) {
    const group = eventGroups.get(m.event_ticker) ?? [];
    group.push(m);
    eventGroups.set(m.event_ticker, group);
  }

  // Also need settled markets
  const { data: settledMarkets } = await supabase
    .from("markets")
    .select("*")
    .not("result", "is", null);

  for (const sm of settledMarkets ?? []) {
    const group = eventGroups.get(sm.event_ticker) ?? [];
    group.push(sm as MarketRow);
    eventGroups.set(sm.event_ticker, group);
  }

  let found = 0;
  for (const [eventTicker, siblings] of eventGroups) {
    const settled = siblings.filter((m) => m.result && m.result !== "");
    const open = siblings.filter((m) => !m.result && m.status === "open");
    if (settled.length === 0 || open.length === 0) continue;

    const recentlySettled = settled.some((m) => {
      const hours = (now - new Date(m.updated_at).getTime()) / (1000 * 60 * 60);
      return hours <= maxHours;
    });
    if (!recentlySettled) continue;

    for (const m of open) {
      if ((m.volume ?? 0) < 20) continue;
      found++;
      if (found <= 10) {
        console.log(`  ${m.ticker}: event=${eventTicker} settled_siblings=${settled.length} price=${m.last_price}¢`);
      }
    }
  }
  console.log(`  Total candidates: ${found}`);
}

async function runMeanReversion(markets: MarketRow[], config: Record<string, unknown>) {
  const minMove = (config.min_move as number) ?? 0.15;
  const lookbackHours = (config.lookback_hours as number) ?? 24;
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const openMarkets = markets.filter(
    (m) => !m.result && m.last_price != null && (m.volume ?? 0) > 50
  );

  const tickers = openMarkets.map((m) => m.ticker);
  if (tickers.length === 0) {
    console.log("  No markets with snapshots to analyze");
    return;
  }

  const { data: snapshots } = await supabase
    .from("price_snapshots")
    .select("ticker, last_price, snapshot_at")
    .in("ticker", tickers.slice(0, 500)) // limit query size
    .gte("snapshot_at", cutoff)
    .order("snapshot_at", { ascending: true });

  const earliest = new Map<string, number>();
  for (const s of snapshots ?? []) {
    if (!earliest.has(s.ticker)) earliest.set(s.ticker, s.last_price);
  }

  let found = 0;
  for (const m of openMarkets) {
    const old = earliest.get(m.ticker);
    if (old == null) continue;
    const move = Math.abs(m.last_price! / 100 - old / 100);
    if (move < minMove) continue;
    found++;
    if (found <= 10) {
      console.log(`  ${m.ticker}: moved ${(move * 100).toFixed(1)}¢ in ${lookbackHours}h (${old}→${m.last_price})`);
    }
  }
  console.log(`  Total opportunities: ${found}`);
}

main();
