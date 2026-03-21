import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";
import { isEntryPriceSafe, minEdgeAfterFees, riskRewardRatio } from "./kalshi-math";

const STRATEGY_ID = "wide-spread";
const DEFAULT_CONFIG = {
  min_spread: 0.10, // 10¢ minimum spread
  min_volume: 100,
  max_days_to_close: 14,
  // Tightened guardrails — backtesting showed 75¢ max is more profitable
  max_entry_price: 0.75, // never pay more than 75¢ (was 85¢ — too risky)
  min_entry_price: 0.15, // avoid longshots below 15¢ (was 10¢)
  min_risk_reward: 0.35, // minimum reward/risk ratio (was 0.20 — allowed terrible trades)
};

function getConfig(dbConfig: StrategyConfig) {
  return { ...DEFAULT_CONFIG, ...dbConfig };
}

export const wideSpread: Strategy = {
  id: STRATEGY_ID,
  name: "Wide Spread",

  async scan(markets: Market[], context: ScanContext): Promise<Opportunity[]> {
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

      // Kalshi prices stored as 0-100 (cents)
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

      // Strategy: buy at the ask (taker), edge = midpoint - ask for YES, or midpoint for NO
      const midpoint = (bid + ask) / 2 / 100; // 0-1

      // Determine side: buy YES if midpoint < 0.5, NO if > 0.5
      const side: "yes" | "no" = midpoint <= 0.5 ? "yes" : "no";

      // Entry price = what we actually pay as a taker
      const entryPrice = side === "yes" ? ask / 100 : (100 - bid) / 100;

      // --- PRICE GUARDRAILS ---
      if (entryPrice > config.max_entry_price || entryPrice < config.min_entry_price) continue;
      if (!isEntryPriceSafe(entryPrice, STRATEGY_ID)) continue;

      // Risk/reward check: at 90¢ entry, you risk 90¢ to make 10¢ (ratio 0.11) — bad
      // at 60¢ entry, you risk 60¢ to make 40¢ (ratio 0.67) — good
      const rr = riskRewardRatio(entryPrice);
      if (rr < config.min_risk_reward) continue;

      // Edge = half spread (we capture the spread by buying at midpoint theory)
      // But realistically we pay the ask, so edge = fairValue - entryPrice
      const fairValue = side === "yes" ? midpoint : 1 - midpoint;
      const edge = fairValue - entryPrice;

      // Edge must clear Kalshi fees
      if (edge < minEdgeAfterFees(entryPrice)) continue;

      // Must have positive edge after fee calculation
      if (edge <= 0) continue;

      opportunities.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        market_title: m.title,
        strategy_id: STRATEGY_ID,
        side,
        confidence: Math.min(0.5 + edge, 0.8),
        fair_value: Math.round(fairValue * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        reasoning: `Wide spread: bid=${bid}¢ ask=${ask}¢ spread=${spread}¢. Entry=${(entryPrice * 100).toFixed(0)}¢ ${side.toUpperCase()}. R/R=${rr.toFixed(2)}. Edge=${(edge * 100).toFixed(1)}¢. Vol=${m.volume}.`,
        quantity: 10, // engine will resize based on liquidity
      });
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
