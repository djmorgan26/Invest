import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";
import { isEntryPriceSafe, minEdgeAfterFees, riskRewardRatio } from "./kalshi-math";

const STRATEGY_ID = "event-cluster";
const DEFAULT_CONFIG = {
  min_mispricing: 0.05, // 5¢ minimum deviation from expected sum
  max_markets_per_event: 15, // skip events with too many granular markets
  min_volume: 20, // minimum volume per market
  max_entry_price: 0.85,
  min_entry_price: 0.08,
  min_risk_reward: 0.15,
};

function getConfig(dbConfig: StrategyConfig) {
  return { ...DEFAULT_CONFIG, ...dbConfig };
}

export const eventCluster: Strategy = {
  id: STRATEGY_ID,
  name: "Event Cluster Arbitrage",

  async scan(markets: Market[], context: ScanContext): Promise<Opportunity[]> {
    const { data: strategy } = await context.supabase
      .from("strategies")
      .select("config")
      .eq("id", STRATEGY_ID)
      .single();

    const config = getConfig((strategy?.config as StrategyConfig) ?? {});
    const now = Date.now();
    const opportunities: Opportunity[] = [];

    // Find mutually exclusive events
    const { data: meEvents } = await context.supabase
      .from("events")
      .select("event_ticker, title, mutually_exclusive, category")
      .eq("mutually_exclusive", true);

    if (!meEvents || meEvents.length === 0) return opportunities;

    const meEventTickers = new Set(meEvents.map((e) => e.event_ticker));

    // Group markets by event
    const eventMarkets = new Map<string, Market[]>();
    for (const m of markets) {
      if (!meEventTickers.has(m.event_ticker)) continue;
      if (m.status !== "open" && m.status !== "active") continue;
      if (m.result) continue;
      if (m.last_price == null) continue;

      if (!eventMarkets.has(m.event_ticker)) {
        eventMarkets.set(m.event_ticker, []);
      }
      eventMarkets.get(m.event_ticker)!.push(m);
    }

    for (const [eventTicker, siblings] of eventMarkets) {
      // Skip events with too many markets (edge spread too thin)
      if (siblings.length > config.max_markets_per_event) continue;
      // Need at least 2 markets for arbitrage
      if (siblings.length < 2) continue;

      // Sum last prices — for mutually exclusive events, should sum to ~100¢
      const sumCents = siblings.reduce((sum, m) => sum + (m.last_price ?? 0), 0);
      const expectedSum = 100; // cents
      const deviation = sumCents - expectedSum;
      const absDeviation = Math.abs(deviation);

      // Deviation must exceed threshold (in cents, convert config from normalized)
      if (absDeviation / 100 < config.min_mispricing) continue;

      // Strategy: if sum > 100, markets are overpriced → sell (buy NO on most overpriced)
      // If sum < 100, markets are underpriced → buy (buy YES on most underpriced)
      if (deviation > 0) {
        // Overpriced: find markets to buy NO on (the most overpriced ones)
        // The market with the highest last_price relative to its ask is most overpriced
        const sorted = [...siblings]
          .filter((m) => m.yes_bid != null && (m.volume ?? 0) >= config.min_volume)
          .sort((a, b) => (b.last_price ?? 0) - (a.last_price ?? 0));

        for (const m of sorted.slice(0, 2)) {
          const entryPrice = (100 - m.yes_bid!) / 100; // cost to buy NO
          if (entryPrice > config.max_entry_price || entryPrice < config.min_entry_price) continue;
          if (!isEntryPriceSafe(entryPrice, STRATEGY_ID)) continue;
          if (riskRewardRatio(entryPrice) < config.min_risk_reward) continue;

          // Fair value: the "true" NO probability based on the overpricing
          // If sum is 108, excess is 8¢ spread across markets
          // This market's share of the excess ~ its proportion of the total
          const marketShare = (m.last_price ?? 0) / sumCents;
          const excessForMarket = (absDeviation * marketShare) / 100;
          const currentNoProb = 1 - (m.last_price ?? 0) / 100;
          const fairValue = Math.min(0.90, currentNoProb + excessForMarket);

          const edge = fairValue - entryPrice;
          if (edge < minEdgeAfterFees(entryPrice)) continue;
          if (edge <= 0) continue;

          const daysToClose = m.close_time
            ? (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60 * 24)
            : null;
          if (daysToClose != null && daysToClose < 0) continue;

          opportunities.push({
            ticker: m.ticker,
            event_ticker: m.event_ticker,
            market_title: m.title,
            strategy_id: STRATEGY_ID,
            side: "no",
            confidence: Math.min(0.55 + edge * 0.5, 0.80),
            fair_value: Math.round(fairValue * 10000) / 10000,
            edge: Math.round(edge * 10000) / 10000,
            reasoning: `Event cluster arb: ${eventTicker} sum=${sumCents}¢ (expected 100¢, dev=${deviation > 0 ? "+" : ""}${deviation}¢). ${siblings.length} siblings. Entry=${(entryPrice * 100).toFixed(0)}¢ NO. R/R=${riskRewardRatio(entryPrice).toFixed(2)}. Vol=${m.volume}.`,
            quantity: 10,
          });
        }
      } else {
        // Underpriced: find markets to buy YES on (the most underpriced ones)
        const sorted = [...siblings]
          .filter((m) => m.yes_ask != null && (m.volume ?? 0) >= config.min_volume)
          .sort((a, b) => (a.last_price ?? 0) - (b.last_price ?? 0));

        for (const m of sorted.slice(0, 2)) {
          const entryPrice = m.yes_ask! / 100;
          if (entryPrice > config.max_entry_price || entryPrice < config.min_entry_price) continue;
          if (!isEntryPriceSafe(entryPrice, STRATEGY_ID)) continue;
          if (riskRewardRatio(entryPrice) < config.min_risk_reward) continue;

          const marketShare = (m.last_price ?? 0) / (sumCents || 1);
          const deficitForMarket = (absDeviation * marketShare) / 100;
          const currentYesProb = (m.last_price ?? 0) / 100;
          const fairValue = Math.min(0.90, currentYesProb + deficitForMarket);

          const edge = fairValue - entryPrice;
          if (edge < minEdgeAfterFees(entryPrice)) continue;
          if (edge <= 0) continue;

          const daysToClose = m.close_time
            ? (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60 * 24)
            : null;
          if (daysToClose != null && daysToClose < 0) continue;

          opportunities.push({
            ticker: m.ticker,
            event_ticker: m.event_ticker,
            market_title: m.title,
            strategy_id: STRATEGY_ID,
            side: "yes",
            confidence: Math.min(0.55 + edge * 0.5, 0.80),
            fair_value: Math.round(fairValue * 10000) / 10000,
            edge: Math.round(edge * 10000) / 10000,
            reasoning: `Event cluster arb: ${eventTicker} sum=${sumCents}¢ (expected 100¢, dev=${deviation}¢). ${siblings.length} siblings. Entry=${(entryPrice * 100).toFixed(0)}¢ YES. R/R=${riskRewardRatio(entryPrice).toFixed(2)}. Vol=${m.volume}.`,
            quantity: 10,
          });
        }
      }
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
