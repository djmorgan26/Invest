import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";

const STRATEGY_ID = "wide-spread";
const DEFAULT_CONFIG = {
  min_spread: 0.10,
  min_volume: 100,
  max_days_to_close: 14,
};

function getConfig(dbConfig: StrategyConfig) {
  return { ...DEFAULT_CONFIG, ...dbConfig };
}

export const wideSpread: Strategy = {
  id: STRATEGY_ID,
  name: "Wide Spread",

  async scan(markets: Market[], context: ScanContext): Promise<Opportunity[]> {
    // Load strategy config from DB
    const { data: strategy } = await context.supabase
      .from("strategies")
      .select("config")
      .eq("id", STRATEGY_ID)
      .single();

    const config = getConfig((strategy?.config as StrategyConfig) ?? {});
    const now = Date.now();
    const opportunities: Opportunity[] = [];

    for (const m of markets) {
      if (m.status !== "open" && m.status !== "active") continue;
      if (m.yes_bid == null || m.yes_ask == null) continue;
      if (m.result) continue;

      // Kalshi prices are stored as 0-100 in DB (cents)
      const bid = m.yes_bid;
      const ask = m.yes_ask;
      const spread = ask - bid;

      // Normalize to 0-1 for threshold comparison
      const spreadNorm = spread / 100;
      if (spreadNorm < config.min_spread) continue;

      // Volume filter
      if ((m.volume ?? 0) < config.min_volume) continue;

      // Time filter
      if (m.close_time) {
        const daysToClose = (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60 * 24);
        if (daysToClose < 0 || daysToClose > config.max_days_to_close) continue;
      }

      // Strategy: buy at midpoint, edge = half the spread
      const midpoint = (bid + ask) / 2 / 100; // normalize to 0-1
      const edge = spreadNorm / 2;

      // Buy YES if midpoint < 0.5, NO if midpoint > 0.5
      const side: "yes" | "no" = midpoint <= 0.5 ? "yes" : "no";
      const price = side === "yes" ? ask / 100 : (100 - bid) / 100;
      const fairValue = side === "yes" ? midpoint : 1 - midpoint;

      opportunities.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        market_title: m.title,
        strategy_id: STRATEGY_ID,
        side,
        confidence: Math.min(0.5 + edge, 0.8), // moderate confidence
        fair_value: Math.round(fairValue * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        reasoning: `Wide spread detected: bid=${bid}¢ ask=${ask}¢ spread=${spread}¢. Midpoint=${(midpoint * 100).toFixed(1)}¢. Edge=${(edge * 100).toFixed(1)}¢ from spread capture. Volume=${m.volume}.`,
        quantity: 10, // default quantity, engine will adjust
      });
    }

    // Sort by edge descending
    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
