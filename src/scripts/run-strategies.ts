import { config } from "dotenv";
config({ path: ".env.local" });

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

    // Volume spike scan
    if (enabledIds.has("volume-spike")) {
      console.log("\n--- Volume Spike ---");
      await runVolumeSpike(markets ?? [], dbStrategies?.find((s) => s.id === "volume-spike")?.config ?? {});
    }

    // Favorite-longshot bias scan
    if (enabledIds.has("favorite-longshot")) {
      console.log("\n--- Favorite-Longshot Bias ---");
      await runFavoriteLongshot(markets ?? [], dbStrategies?.find((s) => s.id === "favorite-longshot")?.config ?? {});
    }

    // Expiry convergence scan
    if (enabledIds.has("expiry-convergence")) {
      console.log("\n--- Expiry Convergence ---");
      await runExpiryConvergence(markets ?? [], dbStrategies?.find((s) => s.id === "expiry-convergence")?.config ?? {});
    }

    // New listing edge scan
    if (enabledIds.has("new-listing")) {
      console.log("\n--- New Listing Edge ---");
      await runNewListing(markets ?? [], dbStrategies?.find((s) => s.id === "new-listing")?.config ?? {});
    }

    // Liquidity provision scan
    if (enabledIds.has("liquidity-provision")) {
      console.log("\n--- Liquidity Provision ---");
      await runLiquidityProvision(markets ?? [], dbStrategies?.find((s) => s.id === "liquidity-provision")?.config ?? {});
    }

    // Event cluster arbitrage scan
    if (enabledIds.has("event-cluster")) {
      console.log("\n--- Event Cluster Arbitrage ---");
      await runEventCluster(markets ?? []);
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

async function runVolumeSpike(markets: MarketRow[], config: Record<string, unknown>) {
  const multiplier = (config.volume_multiplier as number) ?? 3.0;
  const minPriceMove = (config.min_price_move as number) ?? 0.03;
  const lookbackHours = (config.lookback_hours as number) ?? 48;
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const openMarkets = markets.filter(
    (m) => !m.result && m.last_price != null && (m.volume ?? 0) >= 50
  );
  const tickers = openMarkets.slice(0, 500).map((m) => m.ticker);
  if (tickers.length === 0) { console.log("  No candidates"); return; }

  const { data: snapshots } = await supabase
    .from("price_snapshots")
    .select("ticker, last_price, volume, snapshot_at")
    .in("ticker", tickers)
    .gte("snapshot_at", cutoff)
    .order("snapshot_at", { ascending: true });

  const tickerData = new Map<string, { volumes: number[]; earliestPrice: number }>();
  for (const s of snapshots ?? []) {
    if (!tickerData.has(s.ticker)) tickerData.set(s.ticker, { volumes: [], earliestPrice: s.last_price });
    tickerData.get(s.ticker)!.volumes.push(s.volume);
  }

  let found = 0;
  for (const m of openMarkets) {
    const data = tickerData.get(m.ticker);
    if (!data || data.volumes.length < 3) continue;
    const baselineAvg = data.volumes.reduce((a, b) => a + b, 0) / data.volumes.length;
    if (baselineAvg <= 0) continue;
    const currentVol = m.volume ?? 0;
    const ratio = currentVol / baselineAvg;
    if (ratio < multiplier) continue;
    const priceMove = Math.abs(m.last_price! / 100 - data.earliestPrice / 100);
    if (priceMove < minPriceMove) continue;
    found++;
    if (found <= 10) {
      console.log(`  ${m.ticker}: ${ratio.toFixed(1)}x volume spike, price move=${(priceMove * 100).toFixed(1)}¢ vol=${m.volume}`);
    }
  }
  console.log(`  Total opportunities: ${found}`);
}

async function runFavoriteLongshot(markets: MarketRow[], config: Record<string, unknown>) {
  const longshotHigh = (config.longshot_high as number) ?? 0.15;
  const favoriteLow = (config.favorite_low as number) ?? 0.85;
  const minVolume = (config.min_volume as number) ?? 100;
  const minDays = (config.min_days_to_close as number) ?? 3;
  const maxDays = (config.max_days_to_close as number) ?? 30;
  const now = Date.now();
  let found = 0;

  for (const m of markets) {
    if (m.result || m.last_price == null || m.yes_bid == null || m.yes_ask == null) continue;
    if ((m.volume ?? 0) < minVolume) continue;
    if (!m.close_time) continue;
    const days = (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60 * 24);
    if (days < minDays || days > maxDays) continue;
    const spread = (m.yes_ask - m.yes_bid) / 100;
    if (spread > 0.08) continue;

    const price = m.last_price / 100;
    let zone = "";
    if (price >= 0.05 && price <= longshotHigh) zone = "LONGSHOT→sell";
    else if (price >= favoriteLow && price <= 0.95) zone = "FAVORITE→buy";
    else continue;

    found++;
    if (found <= 10) {
      console.log(`  ${m.ticker}: ${zone} price=${(price * 100).toFixed(0)}¢ spread=${(spread * 100).toFixed(0)}¢ vol=${m.volume} ${days.toFixed(0)}d "${m.title}"`);
    }
  }
  console.log(`  Total opportunities: ${found}`);
}

async function runExpiryConvergence(markets: MarketRow[], config: Record<string, unknown>) {
  const maxHours = (config.max_hours_to_close as number) ?? 48;
  const minHours = (config.min_hours_to_close as number) ?? 1;
  const now = Date.now();
  let found = 0;

  for (const m of markets) {
    if (m.result || m.last_price == null) continue;
    if (!m.close_time) continue;
    const hours = (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60);
    if (hours < minHours || hours > maxHours) continue;
    const price = m.last_price / 100;
    if (price < 0.25 || price > 0.75) continue;
    if ((m.volume ?? 0) < 50) continue;
    found++;
    if (found <= 10) {
      console.log(`  ${m.ticker}: price=${(price * 100).toFixed(0)}¢ ${hours.toFixed(0)}h to close vol=${m.volume} "${m.title}"`);
    }
  }
  console.log(`  Total opportunities: ${found}`);
}

async function runNewListing(markets: MarketRow[], config: Record<string, unknown>) {
  const maxHours = (config.max_hours_since_listing as number) ?? 24;
  const cutoff = new Date(Date.now() - maxHours * 60 * 60 * 1000);
  let found = 0;

  for (const m of markets) {
    if (m.result || m.last_price == null || m.yes_bid == null || m.yes_ask == null) continue;
    // Check created_at — need to query DB for this since MarketRow may not have it
    // Skip for now, just show markets with very low volume (proxy for new)
    if ((m.volume ?? 0) < 5 || (m.volume ?? 0) > 500) continue;
    const spread = (m.yes_ask - m.yes_bid) / 100;
    if (spread < 0.06) continue;
    found++;
    if (found <= 10) {
      const mid = ((m.yes_bid + m.yes_ask) / 2 / 100 * 100).toFixed(0);
      console.log(`  ${m.ticker}: spread=${(spread * 100).toFixed(0)}¢ mid=${mid}¢ vol=${m.volume} "${m.title}"`);
    }
  }
  console.log(`  Total candidates (low-vol wide-spread): ${found}`);
}

async function runLiquidityProvision(markets: MarketRow[], config: Record<string, unknown>) {
  const minSpread = (config.min_spread as number) ?? 0.08;
  const maxSpread = (config.max_spread as number) ?? 0.25;
  const minVolume = (config.min_volume as number) ?? 30;
  const now = Date.now();
  let found = 0;

  for (const m of markets) {
    if (m.result || m.yes_bid == null || m.yes_ask == null) continue;
    if ((m.volume ?? 0) < minVolume) continue;
    const spread = (m.yes_ask - m.yes_bid) / 100;
    if (spread < minSpread || spread > maxSpread) continue;
    if (m.close_time) {
      const days = (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60 * 24);
      if (days < 2 || days > 21) continue;
    }
    found++;
    if (found <= 10) {
      const mid = ((m.yes_bid + m.yes_ask) / 2 / 100 * 100).toFixed(0);
      console.log(`  ${m.ticker}: spread=${(spread * 100).toFixed(0)}¢ mid=${mid}¢ vol=${m.volume} "${m.title}"`);
    }
  }
  console.log(`  Total opportunities: ${found}`);
}

async function runEventCluster(markets: MarketRow[]) {
  const { data: events } = await supabase
    .from("events")
    .select("event_ticker, title, mutually_exclusive")
    .eq("mutually_exclusive", true);

  const meEvents = new Set((events ?? []).map((e) => e.event_ticker));
  const eventGroups = new Map<string, MarketRow[]>();
  for (const m of markets) {
    if (!meEvents.has(m.event_ticker)) continue;
    if (m.result || m.last_price == null) continue;
    const group = eventGroups.get(m.event_ticker) ?? [];
    group.push(m);
    eventGroups.set(m.event_ticker, group);
  }

  let found = 0;
  for (const [eventTicker, siblings] of eventGroups) {
    if (siblings.length < 2 || siblings.length > 15) continue;
    const sum = siblings.reduce((s, m) => s + (m.last_price ?? 0), 0) / 100;
    const deviation = Math.abs(sum - 1.0);
    if (deviation < 0.05) continue;
    found++;
    if (found <= 5) {
      console.log(`  ${eventTicker}: ${siblings.length} markets, sum=${(sum * 100).toFixed(0)}¢ (${sum > 1 ? "over" : "under"}priced by ${(deviation * 100).toFixed(0)}¢)`);
    }
  }
  console.log(`  Total mispriced events: ${found}`);
}

main();
