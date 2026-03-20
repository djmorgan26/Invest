import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";
import { isEntryPriceSafe, takerFee } from "./kalshi-math";

const STRATEGY_ID = "extreme-value";
const DEFAULT_CONFIG = {
  low_threshold: 0.08, // YES priced below 8¢ → near-certain NO
  high_threshold: 0.92, // YES priced above 92¢ → near-certain YES
  min_volume: 50,
  max_days_to_close: 7, // widened from 3 to capture more
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
      if (!m.close_time) continue;
      const hoursToClose = (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60);
      const daysToClose = hoursToClose / 24;
      if (daysToClose < 0 || daysToClose > config.max_days_to_close) continue;

      let side: "yes" | "no";
      let entryPrice: number;
      let fairValue: number;
      let reasoning: string;

      if (lastPrice <= config.low_threshold) {
        // YES priced very low → bet NO (near-certain NO outcome)
        // Entry price for NO = 1 - yes_bid (or approximate from last_price)
        side = "no";
        entryPrice = m.yes_bid != null ? (100 - m.yes_bid) / 100 : 1 - lastPrice;

        // Fair value of NO — closer to expiry with low YES price → very likely NO
        // Scale confidence by how close to expiry: 2h left at 3¢ → nearly certain
        const timeFactor = Math.min(1, Math.max(0, 1 - daysToClose / config.max_days_to_close));
        fairValue = 0.95 + timeFactor * 0.04; // 95-99% depending on time

        reasoning = `Extreme low: YES at ${(lastPrice * 100).toFixed(0)}¢ with ${hoursToClose.toFixed(0)}h to close. Near-certain NO.`;
      } else if (lastPrice >= config.high_threshold) {
        // YES priced very high → bet YES (near-certain YES outcome)
        side = "yes";
        entryPrice = m.yes_ask != null ? m.yes_ask / 100 : lastPrice;

        const timeFactor = Math.min(1, Math.max(0, 1 - daysToClose / config.max_days_to_close));
        fairValue = 0.95 + timeFactor * 0.04;

        reasoning = `Extreme high: YES at ${(lastPrice * 100).toFixed(0)}¢ with ${hoursToClose.toFixed(0)}h to close. Near-certain YES.`;
      } else {
        continue;
      }

      // Price guardrail (extreme-value gets wider range: up to 92¢)
      if (!isEntryPriceSafe(entryPrice, STRATEGY_ID)) continue;

      const edge = fairValue - entryPrice;
      if (edge < 0.01) continue;

      // Fee check: at extreme prices, fees are very low (P*(1-P) is tiny at 95¢)
      // e.g., at 95¢: fee = ceil(7 * 0.95 * 0.05) = ceil(0.33) = 1¢
      const feePerContract = takerFee(1, entryPrice);
      if (edge <= feePerContract) continue;

      // Profit per contract if win: (1 - entryPrice) minus fee
      const profitIfWin = 1 - entryPrice - feePerContract;
      if (profitIfWin < 0.02) continue; // need at least 2¢ net profit per contract

      opportunities.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        market_title: m.title,
        strategy_id: STRATEGY_ID,
        side,
        confidence: Math.min(fairValue, 0.95),
        fair_value: Math.round(fairValue * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        reasoning: `${reasoning} Entry=${(entryPrice * 100).toFixed(0)}¢ ${side.toUpperCase()}. Net profit/contract=${(profitIfWin * 100).toFixed(1)}¢. Vol=${m.volume}.`,
        quantity: 15, // engine will resize — slightly larger for high-conviction
      });
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
