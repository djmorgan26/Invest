import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";
import { isEntryPriceSafe, takerFee, minEdgeAfterFees, riskRewardRatio } from "./kalshi-math";

/**
 * New Listing Edge Strategy ("IPO Pop")
 *
 * When Kalshi launches new markets, initial prices are often set naively or
 * there's thin liquidity that doesn't reflect true probabilities. Early
 * entrants who assess fair value can get favorable fills before the market
 * equilibrates.
 *
 * Approach:
 * - Detect markets created within the last 24 hours (using created_at timestamp)
 * - Look for prices that seem mispriced relative to simple heuristics:
 *   • Binary markets defaulting to 50¢ when outcome is likely skewed
 *   • Prices that don't match sibling markets' implied probabilities
 *   • Very wide spreads indicating no market maker has arrived
 * - Trade toward the likely true value
 */

const STRATEGY_ID = "new-listing";
const DEFAULT_CONFIG = {
  max_hours_since_listing: 48, // recently listed markets
  min_spread: 0.06,            // wide spread = no market maker yet = opportunity
  min_volume: 5,               // some activity (not completely dead)
  max_volume: 1500,            // raised from 500 — new listings can gain traction quickly
  max_entry_price: 0.80,
  min_entry_price: 0.15,
  min_risk_reward: 0.25,
  sibling_weight: 0.70,       // how much to weight sibling-implied fair value
  default_edge_estimate: 0.10, // raised from 0.08 — more aggressive fair value push for new listings
};

function getConfig(dbConfig: StrategyConfig) {
  return { ...DEFAULT_CONFIG, ...dbConfig };
}

export const newListing: Strategy = {
  id: STRATEGY_ID,
  name: "New Listing Edge",

  async scan(markets: Market[], context: ScanContext): Promise<Opportunity[]> {
    const { data: strategy } = await context.supabase
      .from("strategies")
      .select("config")
      .eq("id", STRATEGY_ID)
      .single();

    const config = getConfig((strategy?.config as StrategyConfig) ?? {});
    const now = Date.now();
    const cutoff = new Date(now - config.max_hours_since_listing * 60 * 60 * 1000);
    const opportunities: Opportunity[] = [];

    // Filter to recently created markets with wide spreads
    const newMarkets = markets.filter((m) => {
      if (m.status !== "open" && m.status !== "active") return false;
      if (m.result) return false;
      if (m.last_price == null || m.yes_bid == null || m.yes_ask == null) return false;
      if (!m.created_at) return false;

      const createdAt = new Date(m.created_at);
      if (createdAt < cutoff) return false;

      const volume = m.volume ?? 0;
      if (volume < config.min_volume || volume > config.max_volume) return false;

      const spread = (m.yes_ask - m.yes_bid) / 100;
      return spread >= config.min_spread;
    });

    if (newMarkets.length === 0) return opportunities;

    // Group markets by event to find sibling-implied fair values
    const eventTickers = [...new Set(newMarkets.map((m) => m.event_ticker))];
    const { data: siblingMarkets } = await context.supabase
      .from("markets")
      .select("ticker, event_ticker, title, last_price, volume, result, yes_bid, yes_ask")
      .in("event_ticker", eventTickers)
      .not("last_price", "is", null);

    // Build event context: what do sibling markets tell us?
    const eventContext = new Map<string, {
      totalMarkets: number;
      resolvedMarkets: number;
      avgPrice: number;
      priceSum: number;
    }>();

    for (const sibling of siblingMarkets ?? []) {
      if (!eventContext.has(sibling.event_ticker)) {
        eventContext.set(sibling.event_ticker, {
          totalMarkets: 0,
          resolvedMarkets: 0,
          avgPrice: 0,
          priceSum: 0,
        });
      }
      const ctx = eventContext.get(sibling.event_ticker)!;
      ctx.totalMarkets++;
      if (sibling.result) ctx.resolvedMarkets++;
      if (sibling.last_price != null) {
        ctx.priceSum += sibling.last_price / 100;
      }
    }

    for (const ctx of eventContext.values()) {
      ctx.avgPrice = ctx.totalMarkets > 0 ? ctx.priceSum / ctx.totalMarkets : 0.50;
    }

    for (const m of newMarkets) {
      const lastPrice = m.last_price! / 100;
      const yesBid = m.yes_bid! / 100;
      const yesAsk = m.yes_ask! / 100;
      const spread = yesAsk - yesBid;
      const midpoint = (yesBid + yesAsk) / 2;
      const hoursSinceListing = (now - new Date(m.created_at).getTime()) / (1000 * 60 * 60);

      const ctx = eventContext.get(m.event_ticker);

      // Determine if the price seems mispriced
      // Heuristic 1: Default 50¢ pricing on a market where siblings suggest otherwise
      // Heuristic 2: Wide spread with midpoint far from 50¢ — one side has an edge
      let side: "yes" | "no";
      let fairValue: number;
      let reasoning: string;

      // Check if sibling context suggests a direction
      let siblingSignal = 0; // positive = lean YES, negative = lean NO

      if (ctx && ctx.totalMarkets > 1) {
        // If the event has many markets and this one is near 50¢,
        // the average sibling price can hint at the likely direction
        if (ctx.avgPrice > 0.60) {
          siblingSignal = 0.05; // event tends toward YES outcomes
        } else if (ctx.avgPrice < 0.40) {
          siblingSignal = -0.05; // event tends toward NO outcomes
        }
      }

      // Primary signal: midpoint deviation from 50¢ + spread size
      // Wide spread at 35¢ midpoint → someone knows it's likely NO
      // Wide spread at 65¢ midpoint → someone knows it's likely YES
      const deviationFrom50 = midpoint - 0.50;

      if (Math.abs(deviationFrom50) < 0.03 && Math.abs(siblingSignal) < 0.02) {
        // Price is very close to 50¢ with no sibling signal — skip, no edge
        continue;
      }

      // Combined signal
      const signal = deviationFrom50 + siblingSignal;

      let entryPrice: number;

      if (signal > 0) {
        side = "yes";
        entryPrice = yesAsk;
        // Fair value: push further in the signal direction
        fairValue = Math.min(0.85, midpoint + config.default_edge_estimate);
      } else {
        side = "no";
        entryPrice = (100 - m.yes_bid!) / 100;
        fairValue = Math.min(0.85, (1 - midpoint) + config.default_edge_estimate);
      }

      // Entry price guardrails
      if (entryPrice > config.max_entry_price || entryPrice < config.min_entry_price) continue;
      if (!isEntryPriceSafe(entryPrice, STRATEGY_ID)) continue;

      if (riskRewardRatio(entryPrice) < config.min_risk_reward) continue;

      const edge = fairValue - entryPrice;
      if (edge <= 0) continue;
      if (edge < minEdgeAfterFees(entryPrice)) continue;

      const feePerContract = takerFee(1, entryPrice);
      const netProfit = 1 - entryPrice - feePerContract;
      if (netProfit < 0.02) continue; // lowered from 3¢ — 2¢ net profit acceptable for new listings

      // Lower confidence — this is a heuristic strategy
      const freshnessBoost = Math.min(0.05, (config.max_hours_since_listing - hoursSinceListing) / config.max_hours_since_listing * 0.05);
      const confidence = Math.min(0.70, 0.50 + edge * 0.4 + freshnessBoost);

      reasoning = `New listing: ${hoursSinceListing.toFixed(0)}h old, spread=${(spread * 100).toFixed(0)}¢, vol=${m.volume}.` +
        ` Midpoint=${(midpoint * 100).toFixed(0)}¢.` +
        (Math.abs(siblingSignal) > 0 ? ` Sibling signal: ${siblingSignal > 0 ? "bullish" : "bearish"}.` : "");

      opportunities.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        market_title: m.title,
        strategy_id: STRATEGY_ID,
        side,
        confidence: Math.round(confidence * 100) / 100,
        fair_value: Math.round(fairValue * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        reasoning: `${reasoning} Entry=${(entryPrice * 100).toFixed(0)}¢ ${side.toUpperCase()}. R/R=${riskRewardRatio(entryPrice).toFixed(2)}.`,
        quantity: 8, // smaller size for lower-conviction
      });
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
