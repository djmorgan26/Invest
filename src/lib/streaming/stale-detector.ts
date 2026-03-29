/**
 * Stale Price Detector — The speed edge engine.
 *
 * This is the core moneymaker. It:
 * 1. Receives live events (score changes, crypto price moves)
 * 2. Checks if corresponding Kalshi markets have repriced
 * 3. If not → that's a stale opportunity
 *
 * Example:
 *   - NBA: Team scores with 2 min left, going from -3 to +1
 *   - ESPN reports new score in <5 seconds
 *   - Kalshi "Will Team X win?" is still priced at 40¢ (should be ~65¢)
 *   - We buy YES at 40¢, fair value is 65¢ → 25¢ edge
 *
 * For crypto:
 *   - BTC drops $2,000 in 60 seconds on Binance
 *   - Kalshi "BTC above $85K at end of day" is still at 70¢
 *   - BTC is now at $83K → should be ~30¢
 *   - We buy NO (sell YES) at 70¢ → 40¢ edge
 */

import { createServerClient } from "@/lib/supabase/server";
import { sendOpportunityAlert } from "@/lib/notifications";
import type { LiveScore, LiveCryptoPrice, StaleOpportunity } from "./types";

// How long a Kalshi market can go without repricing before we flag it
const STALENESS_THRESHOLD_MS = 60_000; // 60 seconds

// Minimum price move (in cents) to consider an opportunity
const MIN_EDGE_CENTS = 5;

// Track when we last saw each Kalshi ticker update
const lastKalshiUpdate = new Map<string, { price: number; timestamp: number }>();

// Track detected opportunities to avoid duplicates
const recentOpportunities = new Map<string, number>(); // ticker → timestamp

/**
 * Record a Kalshi price update (called from Kalshi WS listener)
 */
export function recordKalshiUpdate(ticker: string, price: number): void {
  lastKalshiUpdate.set(ticker, { price, timestamp: Date.now() });
}

/**
 * Check for stale opportunities after a score change
 */
export async function checkScoreChange(score: LiveScore): Promise<StaleOpportunity[]> {
  const supabase = createServerClient();
  const opportunities: StaleOpportunity[] = [];

  // Find Kalshi markets related to this game
  // Search by team names in market titles
  const searchTerms = [
    score.home_team.toLowerCase(),
    score.away_team.toLowerCase(),
    score.league.toLowerCase(),
  ];

  const { data: markets } = await supabase
    .from("markets")
    .select("ticker, title, last_price, yes_bid, yes_ask, close_time, event_ticker, updated_at")
    .in("status", ["open", "active"])
    .not("last_price", "is", null);

  if (!markets) return opportunities;

  // Filter markets that match this game
  const relatedMarkets = markets.filter((m) => {
    const title = m.title.toLowerCase();
    return searchTerms.some((term) => title.includes(term));
  });

  for (const market of relatedMarkets) {
    const lastUpdate = lastKalshiUpdate.get(market.ticker);
    const kalshiPrice = lastUpdate?.price ?? market.last_price ?? 50;
    const lastUpdateTime = lastUpdate?.timestamp ?? new Date(market.updated_at).getTime();
    const staleness = Date.now() - lastUpdateTime;

    // Only flag if stale enough
    if (staleness < STALENESS_THRESHOLD_MS) continue;

    // Estimate fair value based on score
    const fairValue = estimateFairValueFromScore(score, market.title);
    if (fairValue === null) continue;

    const fairValueCents = Math.round(fairValue * 100);
    const edge = Math.abs(fairValueCents - kalshiPrice);

    if (edge < MIN_EDGE_CENTS) continue;

    // Don't duplicate recent opportunities
    const lastOpp = recentOpportunities.get(market.ticker);
    if (lastOpp && Date.now() - lastOpp < 120_000) continue; // 2 min cooldown

    recentOpportunities.set(market.ticker, Date.now());

    const side = fairValueCents > kalshiPrice ? "yes" : "no";

    opportunities.push({
      id: `${market.ticker}-${Date.now()}`,
      ticker: market.ticker,
      market_title: market.title,
      category: "sports",
      trigger_source: "espn",
      trigger_event: `${score.away_team} ${score.away_score} @ ${score.home_team} ${score.home_score}`,
      trigger_detail: `Score change detected in ${score.league} game (${score.status_desc})`,
      trigger_time: score.timestamp,
      kalshi_price: kalshiPrice,
      kalshi_last_update: lastUpdateTime,
      estimated_fair_value: fairValueCents,
      edge_cents: edge,
      side,
      confidence: Math.min(edge / 30, 0.9), // Higher edge → higher confidence, cap at 90%
      staleness_ms: staleness,
      detected_at: Date.now(),
      expires_at: Date.now() + 120_000, // 2 min window
    });
  }

  // Send email alerts for each opportunity
  for (const opp of opportunities) {
    sendOpportunityAlert({
      ticker: opp.ticker,
      market_title: opp.market_title,
      category: opp.category,
      trigger_source: opp.trigger_source,
      trigger_event: opp.trigger_event,
      trigger_detail: opp.trigger_detail,
      kalshi_price: opp.kalshi_price,
      estimated_fair_value: opp.estimated_fair_value,
      edge_cents: opp.edge_cents,
      side: opp.side,
      confidence: opp.confidence,
      staleness_seconds: Math.round(opp.staleness_ms / 1000),
      window_seconds: Math.round((opp.expires_at - Date.now()) / 1000),
    }).catch(() => {}); // Fire and forget — don't block on email
  }

  return opportunities;
}

/**
 * Check for stale opportunities after a crypto price move
 */
export async function checkCryptoMove(
  price: LiveCryptoPrice,
  recentPrices: { price: number; timestamp: number }[]
): Promise<StaleOpportunity[]> {
  const supabase = createServerClient();
  const opportunities: StaleOpportunity[] = [];

  // Calculate recent price movement
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recentStart = recentPrices.filter((p) => p.timestamp >= fiveMinAgo);
  if (recentStart.length === 0) return opportunities;

  const startPrice = recentStart[0].price;
  const movePct = ((price.price - startPrice) / startPrice) * 100;

  // Only trigger on significant moves (>1% in 5 min)
  if (Math.abs(movePct) < 1) return opportunities;

  // Map symbol to search terms
  const symbolMap: Record<string, string[]> = {
    btcusdt: ["bitcoin", "btc"],
    ethusdt: ["ethereum", "eth"],
    solusdt: ["solana", "sol"],
    dogeusdt: ["dogecoin", "doge"],
  };

  const searchTerms = symbolMap[price.symbol] ?? [];
  if (searchTerms.length === 0) return opportunities;

  const { data: markets } = await supabase
    .from("markets")
    .select("ticker, title, last_price, yes_bid, yes_ask, close_time, updated_at")
    .in("status", ["open", "active"])
    .not("last_price", "is", null);

  if (!markets) return opportunities;

  const relatedMarkets = markets.filter((m) => {
    const title = m.title.toLowerCase();
    return searchTerms.some((term) => title.includes(term));
  });

  for (const market of relatedMarkets) {
    const lastUpdate = lastKalshiUpdate.get(market.ticker);
    const kalshiPrice = lastUpdate?.price ?? market.last_price ?? 50;
    const lastUpdateTime = lastUpdate?.timestamp ?? new Date(market.updated_at).getTime();
    const staleness = Date.now() - lastUpdateTime;

    if (staleness < STALENESS_THRESHOLD_MS) continue;

    // For crypto range markets, estimate direction
    // If BTC dropped 3%, "above" markets should be lower, "below" markets higher
    const isAboveMarket = market.title.toLowerCase().includes("above") || market.title.toLowerCase().includes("over");
    const isBelowMarket = market.title.toLowerCase().includes("below") || market.title.toLowerCase().includes("under");

    let estimatedShift = 0;
    if (isAboveMarket) {
      estimatedShift = movePct > 0 ? Math.min(movePct * 5, 20) : Math.max(movePct * 5, -20);
    } else if (isBelowMarket) {
      estimatedShift = movePct > 0 ? Math.max(-movePct * 5, -20) : Math.min(-movePct * 5, 20);
    } else {
      continue; // Can't estimate for generic markets
    }

    const fairValueCents = Math.max(1, Math.min(99, kalshiPrice + estimatedShift));
    const edge = Math.abs(fairValueCents - kalshiPrice);

    if (edge < MIN_EDGE_CENTS) continue;

    const lastOpp = recentOpportunities.get(market.ticker);
    if (lastOpp && Date.now() - lastOpp < 120_000) continue;

    recentOpportunities.set(market.ticker, Date.now());

    const side = fairValueCents > kalshiPrice ? "yes" : "no";

    opportunities.push({
      id: `${market.ticker}-${Date.now()}`,
      ticker: market.ticker,
      market_title: market.title,
      category: "crypto",
      trigger_source: "binance",
      trigger_event: `${price.symbol.toUpperCase()} ${movePct > 0 ? "+" : ""}${movePct.toFixed(2)}% ($${price.price.toLocaleString()})`,
      trigger_detail: `${Math.abs(movePct).toFixed(1)}% move in 5 min (${startPrice.toLocaleString()} → ${price.price.toLocaleString()})`,
      trigger_time: price.timestamp,
      kalshi_price: kalshiPrice,
      kalshi_last_update: lastUpdateTime,
      estimated_fair_value: Math.round(fairValueCents),
      edge_cents: Math.round(edge),
      side,
      confidence: Math.min(Math.abs(movePct) / 5, 0.85),
      staleness_ms: staleness,
      detected_at: Date.now(),
      expires_at: Date.now() + 90_000, // 90 sec window for crypto
    });
  }

  // Send email alerts
  for (const opp of opportunities) {
    sendOpportunityAlert({
      ticker: opp.ticker,
      market_title: opp.market_title,
      category: opp.category,
      trigger_source: opp.trigger_source,
      trigger_event: opp.trigger_event,
      trigger_detail: opp.trigger_detail,
      kalshi_price: opp.kalshi_price,
      estimated_fair_value: opp.estimated_fair_value,
      edge_cents: opp.edge_cents,
      side: opp.side,
      confidence: opp.confidence,
      staleness_seconds: Math.round(opp.staleness_ms / 1000),
      window_seconds: Math.round((opp.expires_at - Date.now()) / 1000),
    }).catch(() => {});
  }

  return opportunities;
}

/**
 * Estimate fair value of a sports market based on current score.
 * Returns null if we can't estimate.
 */
function estimateFairValueFromScore(
  score: LiveScore,
  marketTitle: string
): number | null {
  const title = marketTitle.toLowerCase();

  // "Will [team] win?" type markets
  const isHomeWin = title.includes(score.home_team.toLowerCase()) && title.includes("win");
  const isAwayWin = title.includes(score.away_team.toLowerCase()) && title.includes("win");

  if (!isHomeWin && !isAwayWin) return null;

  const teamScore = isHomeWin ? score.home_score : score.away_score;
  const opponentScore = isHomeWin ? score.away_score : score.home_score;
  const scoreDiff = teamScore - opponentScore;

  // Simple heuristic: larger lead = higher win probability
  // This is intentionally rough — even a rough estimate beats a stale price
  const baseProbability = 0.5;
  const adjustmentPerPoint: Record<string, number> = {
    NFL: 0.07,
    NBA: 0.015,
    MLB: 0.08,
    NHL: 0.1,
    MLS: 0.12,
  };

  const perPoint = adjustmentPerPoint[score.league] ?? 0.05;
  const probability = Math.max(0.05, Math.min(0.95, baseProbability + scoreDiff * perPoint));

  return probability;
}

/**
 * Clean up old entries from tracking maps
 */
export function cleanup(): void {
  const cutoff = Date.now() - 10 * 60 * 1000; // 10 min

  for (const [key, ts] of recentOpportunities) {
    if (ts < cutoff) recentOpportunities.delete(key);
  }

  for (const [key, data] of lastKalshiUpdate) {
    if (data.timestamp < cutoff) lastKalshiUpdate.delete(key);
  }
}
