import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- Kalshi API setup (inline to avoid @/ import issues in scripts) ---

const DEMO_BASE = "https://demo-api.kalshi.co/trade-api/v2";

function loadKalshiConfig() {
  const isDemo = (process.env.KALSHI_API_BASE_URL || DEMO_BASE).includes("demo");
  const keyId = isDemo
    ? process.env.KALSHI_API_KEY_ID_DEMO!
    : process.env.KALSHI_API_KEY_ID!;

  let privateKeyPem: string;
  const envPem = isDemo
    ? process.env.KALSHI_PRIVATE_KEY_DEMO
    : process.env.KALSHI_PRIVATE_KEY;

  if (envPem) {
    privateKeyPem = envPem.replace(/\\n/g, "\n");
  } else {
    const keyPath = isDemo
      ? process.env.KALSHI_API_PRIVATE_KEY_PATH_DEMO || "./kalshi/private_key_demo.pem"
      : process.env.KALSHI_API_PRIVATE_KEY_PATH || "./kalshi/private_key.pem";
    privateKeyPem = fs.readFileSync(path.resolve(keyPath), "utf-8");
  }

  return {
    keyId,
    privateKeyPem,
    baseUrl: process.env.KALSHI_API_BASE_URL || DEMO_BASE,
  };
}

function signRequest(privateKeyPem: string, timestamp: number, method: string, requestPath: string): string {
  const message = `${timestamp}${method.toUpperCase()}${requestPath}`;
  const key = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign("sha256", Buffer.from(message), {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString("base64");
}

async function kalshiFetch<T>(method: string, endpoint: string, params?: Record<string, string>): Promise<T> {
  const cfg = loadKalshiConfig();
  const url = new URL(`${cfg.baseUrl}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const requestPath = url.pathname + url.search;
  const signature = signRequest(cfg.privateKeyPem, timestamp, method, requestPath);

  const response = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      "KALSHI-ACCESS-KEY": cfg.keyId,
      "KALSHI-ACCESS-SIGNATURE": signature,
      "KALSHI-ACCESS-TIMESTAMP": timestamp.toString(),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kalshi API ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}

interface KalshiTrade {
  ticker: string;
  trade_id: string;
  count?: number;
  count_fp?: string;
  yes_price?: number;
  yes_price_dollars?: string;
  no_price?: number;
  no_price_dollars?: string;
  created_time: string;
  taker_side: string;
}

function normalizeTrade(t: KalshiTrade): { count: number; yes_price: number; no_price: number } {
  const count = t.count ?? (t.count_fp ? Math.round(parseFloat(t.count_fp)) : 0);
  const yes_price = t.yes_price ?? (t.yes_price_dollars ? Math.round(parseFloat(t.yes_price_dollars) * 100) : 0);
  const no_price = t.no_price ?? (t.no_price_dollars ? Math.round(parseFloat(t.no_price_dollars) * 100) : 0);
  return { count, yes_price, no_price };
}

interface KalshiTradesResponse {
  trades: KalshiTrade[];
  cursor: string;
}

async function fetchTradesForTicker(ticker: string): Promise<KalshiTrade[]> {
  const allTrades: KalshiTrade[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = { ticker, limit: "200" };
    if (cursor) params.cursor = cursor;

    const response = await kalshiFetch<KalshiTradesResponse>("GET", "/markets/trades", params);
    allTrades.push(...response.trades);
    cursor = response.cursor || undefined;

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (cursor);

  return allTrades;
}

function buildCandles(
  ticker: string,
  trades: KalshiTrade[],
  intervalMs: number,
  intervalLabel: string
): Array<{
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
}> {
  if (trades.length === 0) return [];

  // Sort by time
  const sorted = [...trades].sort(
    (a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime()
  );

  const candles: ReturnType<typeof buildCandles> = [];
  const buckets = new Map<number, KalshiTrade[]>();

  for (const trade of sorted) {
    const ts = new Date(trade.created_time).getTime();
    const bucketStart = Math.floor(ts / intervalMs) * intervalMs;
    if (!buckets.has(bucketStart)) buckets.set(bucketStart, []);
    buckets.get(bucketStart)!.push(trade);
  }

  for (const [bucketStart, bucketTrades] of buckets) {
    const normalized = bucketTrades.map((t) => normalizeTrade(t));
    const prices = normalized.map((t) => t.yes_price);
    const totalVolume = normalized.reduce((s, t) => s + t.count, 0);
    const vwapNum = normalized.reduce((s, t) => s + t.yes_price * t.count, 0);
    const vwap = totalVolume > 0 ? Math.round(vwapNum / totalVolume) : prices[0];

    candles.push({
      ticker,
      interval: intervalLabel,
      open_price: prices[0],
      high_price: Math.max(...prices),
      low_price: Math.min(...prices),
      close_price: prices[prices.length - 1],
      volume: totalVolume,
      vwap,
      trade_count: bucketTrades.length,
      bucket_start: new Date(bucketStart).toISOString(),
    });
  }

  return candles;
}

async function main() {
  const args = process.argv.slice(2);
  const maxMarkets = parseInt(args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? "200");
  const minVolume = parseInt(args.find((a) => a.startsWith("--min-volume="))?.split("=")[1] ?? "100");
  const category = args.find((a) => a.startsWith("--category="))?.split("=")[1];
  const listCategories = args.includes("--list-categories");

  // --list-categories: show distribution of settled markets by category and exit
  if (listCategories) {
    const { data: rows } = await supabase.rpc("exec_sql", {
      sql: `SELECT e.category, COUNT(*) as market_count,
             COUNT(*) FILTER (WHERE m.result IS NOT NULL AND m.result != '') as settled_count,
             ROUND(AVG(m.volume)) as avg_volume,
             MAX(m.close_time) as latest_close
             FROM events e JOIN markets m ON e.event_ticker = m.event_ticker
             GROUP BY e.category ORDER BY settled_count DESC`
    });
    // Fallback: direct query if RPC doesn't exist
    if (!rows) {
      // Use two queries to approximate
      const { data: events } = await supabase
        .from("events")
        .select("event_ticker, category");
      const { data: markets } = await supabase
        .from("markets")
        .select("event_ticker, volume, result")
        .not("result", "is", null)
        .neq("result", "")
        .limit(10000);

      if (events && markets) {
        const catMap = new Map<string, string>();
        for (const e of events) catMap.set(e.event_ticker, e.category ?? "unknown");

        const stats = new Map<string, { count: number; totalVol: number }>();
        for (const m of markets) {
          const cat = catMap.get(m.event_ticker) ?? "unknown";
          const s = stats.get(cat) ?? { count: 0, totalVol: 0 };
          s.count++;
          s.totalVol += m.volume ?? 0;
          stats.set(cat, s);
        }

        console.log("\nSettled markets by category:");
        console.log("Category".padEnd(20) + "Settled".padStart(8) + "Avg Volume".padStart(12));
        console.log("-".repeat(40));
        for (const [cat, s] of [...stats.entries()].sort((a, b) => b[1].count - a[1].count)) {
          console.log(
            cat.padEnd(20) +
            String(s.count).padStart(8) +
            String(Math.round(s.totalVol / s.count)).padStart(12)
          );
        }
      }
    } else {
      console.log("\nSettled markets by category:");
      console.log(JSON.stringify(rows, null, 2));
    }
    return;
  }

  console.log(`Fetching historical trades for settled markets (max=${maxMarkets}, minVol=${minVolume}${category ? `, category=${category}` : ""})`);

  // If category specified, get event tickers for that category
  let categoryEventTickers: string[] | null = null;
  if (category) {
    const { data: events } = await supabase
      .from("events")
      .select("event_ticker")
      .ilike("category", category);
    categoryEventTickers = events?.map((e) => e.event_ticker) ?? [];
    console.log(`Found ${categoryEventTickers.length} events in category "${category}"`);
    if (categoryEventTickers.length === 0) {
      console.log("No events found for this category. Try --list-categories to see available categories.");
      return;
    }
  }

  // Find settled markets — order by volume DESC to get high-trade-count markets first
  let query = supabase
    .from("markets")
    .select("ticker, event_ticker, title, volume, close_time, result")
    .not("result", "is", null)
    .neq("result", "")
    .gte("volume", minVolume)
    .order("volume", { ascending: false })
    .limit(maxMarkets * 3);

  if (categoryEventTickers) {
    // Supabase .in() has a limit, batch if needed
    query = query.in("event_ticker", categoryEventTickers.slice(0, 500));
  }

  let { data: settledMarkets, error: settledErr } = await query;

  if (settledErr) {
    console.error("Failed to query settled markets:", settledErr.message);
    process.exit(1);
  }

  // Also find markets that should have settled (close_time in past) but result is missing
  if (!settledMarkets || settledMarkets.length < maxMarkets) {
    console.log("Checking for recently closed markets missing results...");
    const { data: closedMarkets } = await supabase
      .from("markets")
      .select("ticker")
      .lt("close_time", new Date().toISOString())
      .or("result.is.null,result.eq.")
      .order("close_time", { ascending: false })
      .limit(maxMarkets);

    if (closedMarkets && closedMarkets.length > 0) {
      console.log(`Found ${closedMarkets.length} closed markets to refresh from Kalshi API`);
      let refreshed = 0;
      for (const cm of closedMarkets.slice(0, 100)) {
        try {
          const response = await kalshiFetch<{ market: { ticker: string; result: string; volume_fp: string; volume_24h_fp: string; status: string } }>(
            "GET", `/markets/${cm.ticker}`
          );
          const m = response.market;
          if (m.result && m.result !== "") {
            await supabase.from("markets").update({
              result: m.result,
              status: m.status,
              volume: m.volume_fp ? Math.round(parseFloat(m.volume_fp)) : null,
            }).eq("ticker", cm.ticker);
            refreshed++;
          }
          await new Promise((r) => setTimeout(r, 200));
        } catch {
          // skip failures
        }
      }
      console.log(`Refreshed ${refreshed} markets with settlement data`);

      // Re-query with updated data
      const { data: updated } = await supabase
        .from("markets")
        .select("ticker, event_ticker, title, volume, close_time, result")
        .not("result", "is", null)
        .neq("result", "")
        .order("close_time", { ascending: false })
        .limit(maxMarkets * 3);
      settledMarkets = updated;
    }
  }

  if (!settledMarkets || settledMarkets.length === 0) {
    console.log("No settled markets found. Markets may not have closed yet.");
    return;
  }

  console.log(`Found ${settledMarkets.length} settled markets with vol >= ${minVolume}`);

  // Check which tickers already have trades stored
  const { data: existingTrades } = await supabase
    .from("market_trades")
    .select("ticker")
    .limit(100000);

  const existingTickers = new Set((existingTrades ?? []).map((t) => t.ticker));
  const toFetch = settledMarkets.filter((m) => !existingTickers.has(m.ticker)).slice(0, maxMarkets);

  console.log(`${existingTickers.size} tickers already have trades. Fetching ${toFetch.length} new tickers.`);

  let totalTrades = 0;
  let totalCandles = 0;
  let errors = 0;

  for (let i = 0; i < toFetch.length; i++) {
    const market = toFetch[i];
    try {
      process.stdout.write(`[${i + 1}/${toFetch.length}] ${market.ticker} (vol=${market.volume})... `);

      const trades = await fetchTradesForTicker(market.ticker);
      if (trades.length === 0) {
        console.log("0 trades (skipping)");
        continue;
      }

      // Store trades in batches of 500
      for (let j = 0; j < trades.length; j += 500) {
        const batch = trades.slice(j, j + 500).map((t) => {
          const norm = normalizeTrade(t);
          return {
            ticker: t.ticker,
            trade_id: t.trade_id,
            count: norm.count,
            yes_price: norm.yes_price, // already in cents from normalizeTrade
            no_price: norm.no_price,
            taker_side: t.taker_side,
            created_time: t.created_time,
          };
        });

        const { error: insertErr } = await supabase
          .from("market_trades")
          .upsert(batch, { onConflict: "trade_id" });

        if (insertErr) {
          console.error(`Insert error: ${insertErr.message}`);
          errors++;
        }
      }
      totalTrades += trades.length;

      // Build and store candles (1h, 4h, 1d)
      const intervals = [
        { ms: 60 * 60 * 1000, label: "1h" },
        { ms: 4 * 60 * 60 * 1000, label: "4h" },
        { ms: 24 * 60 * 60 * 1000, label: "1d" },
      ];

      for (const { ms, label } of intervals) {
        const candles = buildCandles(market.ticker, trades, ms, label);
        if (candles.length > 0) {
          // Store in batches
          for (let j = 0; j < candles.length; j += 500) {
            const batch = candles.slice(j, j + 500);
            const { error: candleErr } = await supabase
              .from("market_candles")
              .upsert(batch, { onConflict: "ticker,interval,bucket_start" });
            if (candleErr) {
              console.error(`Candle insert error (${label}): ${candleErr.message}`);
            }
          }
          totalCandles += candles.length;
        }
      }

      console.log(`${trades.length} trades → candles built`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${msg}`);
      errors++;
      // If rate limited, wait longer
      if (msg.includes("429")) {
        console.log("Rate limited, waiting 5s...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  console.log(`\nDone. Total trades: ${totalTrades}, candles: ${totalCandles}, errors: ${errors}`);

  // Log sync
  await supabase.from("sync_log").insert({
    type: "historical_trades",
    status: errors > 0 ? "error" : "success",
    records_processed: totalTrades,
    error_message: errors > 0 ? `${errors} fetch/insert errors` : null,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
