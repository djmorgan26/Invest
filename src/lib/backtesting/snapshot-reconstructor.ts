/**
 * Reconstructs what a market "looked like" at a historical point in time
 * using trade history data. Converts raw trades into Market objects that
 * our strategy scan() functions can consume.
 */

import type { Market } from "@/lib/supabase/types";

export interface TradeRecord {
  ticker: string;
  yes_price: number; // cents 0-100
  no_price: number;
  count: number;
  taker_side: string;
  created_time: string;
}

export interface MarketMetadata {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string | null;
  close_time: string | null;
  result: string | null;
  category: string | null;
  created_at: string;
}

/**
 * Reconstruct a Market object at a given timestamp from trade history.
 *
 * Uses trades before the timestamp to estimate:
 * - last_price: most recent trade price
 * - yes_bid/yes_ask: estimated from recent trade spread
 * - volume: total trades in rolling 24h window
 * - volume_24h: same as volume for historical reconstruction
 */
export function reconstructMarketAt(
  meta: MarketMetadata,
  trades: TradeRecord[],
  atTime: Date,
  allTradesBefore?: TradeRecord[] // if pre-filtered
): Market | null {
  const atMs = atTime.getTime();

  // Filter trades that happened before the target time
  const relevantTrades = (allTradesBefore ?? trades).filter(
    (t) => new Date(t.created_time).getTime() <= atMs
  );

  if (relevantTrades.length === 0) return null;

  // Sort by time descending (most recent first)
  relevantTrades.sort(
    (a, b) => new Date(b.created_time).getTime() - new Date(a.created_time).getTime()
  );

  // Last trade price
  const lastTrade = relevantTrades[0];
  const lastPrice = lastTrade.yes_price;

  // Recent trades (last 2 hours) for bid/ask estimation
  const recentWindow = 2 * 60 * 60 * 1000; // 2 hours
  const recentTrades = relevantTrades.filter(
    (t) => atMs - new Date(t.created_time).getTime() <= recentWindow
  );

  // Estimate bid/ask from taker sides
  // Taker buys YES → the trade price is near the ask
  // Taker buys NO → the YES price is near the bid
  let yesBid = lastPrice;
  let yesAsk = lastPrice;

  if (recentTrades.length >= 2) {
    const buyPrices = recentTrades
      .filter((t) => t.taker_side === "yes")
      .map((t) => t.yes_price);
    const sellPrices = recentTrades
      .filter((t) => t.taker_side === "no")
      .map((t) => t.yes_price);

    if (buyPrices.length > 0 && sellPrices.length > 0) {
      // Ask = average of taker-buy prices (they hit the ask)
      yesAsk = Math.round(buyPrices.reduce((s, p) => s + p, 0) / buyPrices.length);
      // Bid = average of taker-sell prices (they hit the bid)
      yesBid = Math.round(sellPrices.reduce((s, p) => s + p, 0) / sellPrices.length);
    } else {
      // Estimate from price variance of all recent trades
      const prices = recentTrades.map((t) => t.yes_price);
      yesBid = Math.min(...prices);
      yesAsk = Math.max(...prices);
    }

    // Enforce minimum realistic spread of 3¢ (Kalshi markets always have some spread)
    const MIN_SPREAD = 3;
    if (yesAsk - yesBid < MIN_SPREAD) {
      const mid = Math.round((yesBid + yesAsk) / 2);
      yesBid = Math.max(1, mid - Math.ceil(MIN_SPREAD / 2));
      yesAsk = Math.min(99, mid + Math.ceil(MIN_SPREAD / 2));
    }
    // Ensure bid <= ask
    if (yesBid > yesAsk) {
      const mid = Math.round((yesBid + yesAsk) / 2);
      yesBid = mid - 1;
      yesAsk = mid + 1;
    }
  } else {
    // Very few trades — assume a wide spread
    yesBid = Math.max(1, lastPrice - 5);
    yesAsk = Math.min(99, lastPrice + 5);
  }

  // 24h volume
  const dayWindow = 24 * 60 * 60 * 1000;
  const dayTrades = relevantTrades.filter(
    (t) => atMs - new Date(t.created_time).getTime() <= dayWindow
  );
  const volume24h = dayTrades.reduce((s, t) => s + t.count, 0);
  const totalVolume = relevantTrades.reduce((s, t) => s + t.count, 0);

  return {
    ticker: meta.ticker,
    event_ticker: meta.event_ticker,
    title: meta.title,
    subtitle: meta.subtitle,
    status: "active", // historical market was active at this point
    yes_bid: yesBid,
    yes_ask: yesAsk,
    last_price: lastPrice,
    volume: totalVolume,
    open_interest: null,
    close_time: meta.close_time,
    result: null, // don't reveal the result during backtesting!
    volume_24h: volume24h,
    liquidity: null,
    created_at: meta.created_at,
    updated_at: atTime.toISOString(),
  };
}

/**
 * Build a series of market snapshots at regular intervals for backtesting.
 * Returns snapshots sorted chronologically.
 */
export function buildSnapshotSeries(
  meta: MarketMetadata,
  trades: TradeRecord[],
  intervalMs: number = 60 * 60 * 1000, // default 1h
  startTime?: Date,
  endTime?: Date
): { time: Date; market: Market }[] {
  if (trades.length === 0) return [];

  const sorted = [...trades].sort(
    (a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime()
  );

  const firstTrade = new Date(sorted[0].created_time);
  const lastTrade = new Date(sorted[sorted.length - 1].created_time);

  const start = startTime && startTime > firstTrade ? startTime : firstTrade;
  const end = endTime && endTime < lastTrade ? endTime : lastTrade;

  const snapshots: { time: Date; market: Market }[] = [];
  let currentTime = new Date(Math.ceil(start.getTime() / intervalMs) * intervalMs);

  while (currentTime <= end) {
    const market = reconstructMarketAt(meta, sorted, currentTime);
    if (market) {
      snapshots.push({ time: new Date(currentTime), market });
    }
    currentTime = new Date(currentTime.getTime() + intervalMs);
  }

  return snapshots;
}
