import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";

const STRATEGY_ID = "extreme-value";
const DEFAULT_CONFIG = {
  low_threshold: 0.05,
  high_threshold: 0.95,
  min_volume: 50,
  max_days_to_close: 3,
};

function getConfig(dbConfig: StrategyConfig) {
  return { ...DEFAULT_CONFIG, ...dbConfig };
}

export const extremeValue: Strategy = {
  id: STRATEGY_ID,
  name: "Extreme Value",

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
      if (m.result) continue;
      if (m.last_price == null) continue;

      const lastPrice = m.last_price / 100; // normalize to 0-1

      // Volume filter
      if ((m.volume ?? 0) < config.min_volume) continue;

      // Time filter — only near-expiry markets
      if (m.close_time) {
        const daysToClose = (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60 * 24);
        if (daysToClose < 0 || daysToClose > config.max_days_to_close) continue;
      } else {
        continue; // skip markets without close time
      }

      let side: "yes" | "no";
      let fairValue: number;
      let edge: number;
      let reasoning: string;

      if (lastPrice <= config.low_threshold) {
        // Market priced near zero — bet NO (near-certain NO outcome)
        side = "no";
        fairValue = 1 - lastPrice; // close to 1.0 for NO
        edge = fairValue - (1 - lastPrice); // effectively 0 ... but we want
        // Actually: NO price = 1 - lastPrice. We buy NO at (1 - yes_ask) or similar.
        // Simpler: if YES is at 3¢, NO is at 97¢. If it's nearly certain NO, fair value of NO ≈ 1.0
        // Edge = 1.0 - 0.97 = 0.03. Small per trade but high win rate.
        fairValue = 0.99;
        edge = fairValue - (1 - lastPrice);
        if (edge < 0.01) continue;

        reasoning = `Extreme low: YES priced at ${(lastPrice * 100).toFixed(0)}¢ with ${((new Date(m.close_time!).getTime() - now) / (1000 * 60 * 60)).toFixed(0)}h to close. Near-certain NO. Volume=${m.volume}.`;
      } else if (lastPrice >= config.high_threshold) {
        // Market priced near 100 — bet YES (near-certain YES outcome)
        side = "yes";
        fairValue = 0.99;
        edge = fairValue - lastPrice;
        if (edge < 0.01) continue;

        reasoning = `Extreme high: YES priced at ${(lastPrice * 100).toFixed(0)}¢ with ${((new Date(m.close_time!).getTime() - now) / (1000 * 60 * 60)).toFixed(0)}h to close. Near-certain YES. Volume=${m.volume}.`;
      } else {
        continue;
      }

      opportunities.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        market_title: m.title,
        strategy_id: STRATEGY_ID,
        side,
        confidence: 0.90, // high confidence for extreme values near expiry
        fair_value: Math.round(fairValue * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        reasoning,
        quantity: 20, // higher quantity for high-conviction low-edge trades
      });
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
