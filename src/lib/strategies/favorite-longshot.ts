import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";
import { isEntryPriceSafe, takerFee, minEdgeAfterFees } from "./kalshi-math";

/**
 * Favorite-Longshot Bias Strategy
 *
 * Academic finding (Snowberg & Wolfers 2010): participants systematically
 * overpay for longshots (low-probability events) and underpay for favorites
 * (high-probability events). The bias is strongest in the 5-15¢ / 85-95¢ zone.
 *
 * This is distinct from extreme-value which targets <8¢/>92¢ near expiry.
 * This strategy targets the WIDER 5-15¢/85-95¢ band with LONGER time horizons,
 * exploiting the structural bias rather than time decay.
 *
 * Approach:
 * - Sell longshots: markets priced 5-15¢ YES → buy NO (longshots are overpriced)
 * - Buy favorites: markets priced 85-95¢ YES → buy YES (favorites are underpriced)
 * - Require decent volume (not dead markets)
 * - Prefer 7-30 day horizons (not too short, not too long)
 * - Weight confidence by volume and spread tightness
 */

const STRATEGY_ID = "favorite-longshot";
const DEFAULT_CONFIG = {
  longshot_low: 0.05,        // YES price floor for longshot zone
  longshot_high: 0.15,       // YES price ceiling for longshot zone
  favorite_low: 0.85,        // YES price floor for favorite zone
  favorite_high: 0.95,       // YES price ceiling for favorite zone
  min_volume: 100,           // minimum contracts traded
  min_days_to_close: 3,      // avoid last-minute markets (extreme-value handles those)
  max_days_to_close: 30,     // don't hold too long
  longshot_overpricing: 0.30, // longshots overpriced by ~30% on average (academic estimate)
  favorite_underpricing: 0.03, // favorites underpriced by ~3% on average
  min_spread_tightness: 0.08, // max bid-ask spread (tighter = more liquid = better fills)
};

function getConfig(dbConfig: StrategyConfig) {
  return { ...DEFAULT_CONFIG, ...dbConfig };
}

export const favoriteLongshot: Strategy = {
  id: STRATEGY_ID,
  name: "Favorite-Longshot Bias",

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
      if (m.last_price == null || m.yes_bid == null || m.yes_ask == null) continue;
      if ((m.volume ?? 0) < config.min_volume) continue;

      // Time filter: 3-30 days to close
      if (!m.close_time) continue;
      const daysToClose = (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60 * 24);
      if (daysToClose < config.min_days_to_close || daysToClose > config.max_days_to_close) continue;

      const lastPrice = m.last_price / 100;
      const yesBid = m.yes_bid / 100;
      const yesAsk = m.yes_ask / 100;
      const spread = yesAsk - yesBid;

      // Skip very wide spreads — we need decent liquidity for this strategy
      if (spread > config.min_spread_tightness) continue;

      let side: "yes" | "no";
      let entryPrice: number;
      let fairValue: number;
      let reasoning: string;

      if (lastPrice >= config.longshot_low && lastPrice <= config.longshot_high) {
        // LONGSHOT ZONE: YES is overpriced → sell YES (buy NO)
        // Academic finding: contracts at 10¢ are really worth ~7¢ on average
        // The overpricing factor scales with how cheap the contract is
        side = "no";
        entryPrice = (100 - m.yes_bid) / 100; // cost of NO

        // Fair value of NO: if YES is overpriced by 30%, true YES prob is lower
        // e.g., YES at 10¢ → true prob ~7¢ → NO fair value ~93¢
        const trueYesProb = lastPrice * (1 - config.longshot_overpricing);
        fairValue = 1 - trueYesProb;

        reasoning = `Longshot bias: YES at ${(lastPrice * 100).toFixed(0)}¢ likely overpriced. ` +
          `Academic estimate: true prob ~${(trueYesProb * 100).toFixed(0)}¢. ` +
          `${daysToClose.toFixed(0)}d to close, spread=${(spread * 100).toFixed(0)}¢.`;
      } else if (lastPrice >= config.favorite_low && lastPrice <= config.favorite_high) {
        // FAVORITE ZONE: YES is underpriced → buy YES
        // Favorites are underpriced because retail prefers cheap lottery tickets
        side = "yes";
        entryPrice = yesAsk;

        // Fair value: slightly higher than market price
        // e.g., YES at 90¢ → true prob ~93¢
        fairValue = Math.min(0.98, lastPrice + config.favorite_underpricing);

        reasoning = `Favorite bias: YES at ${(lastPrice * 100).toFixed(0)}¢ likely underpriced. ` +
          `Academic estimate: true prob ~${(fairValue * 100).toFixed(0)}¢. ` +
          `${daysToClose.toFixed(0)}d to close, spread=${(spread * 100).toFixed(0)}¢.`;
      } else {
        continue;
      }

      // Entry price safety
      if (!isEntryPriceSafe(entryPrice, STRATEGY_ID)) continue;

      const edge = fairValue - entryPrice;
      if (edge <= 0) continue;

      // Must clear fees
      if (edge < minEdgeAfterFees(entryPrice)) continue;

      // Fee check
      const feePerContract = takerFee(1, entryPrice);
      const netProfit = 1 - entryPrice - feePerContract;
      if (netProfit < 0.02) continue;

      // Confidence scales with volume (more liquid = more reliable signal)
      const volumeBoost = Math.min(0.10, Math.log10(Math.max(1, m.volume ?? 0)) / 50);
      const confidence = Math.min(0.80, 0.55 + edge * 0.5 + volumeBoost);

      opportunities.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        market_title: m.title,
        strategy_id: STRATEGY_ID,
        side,
        confidence: Math.round(confidence * 100) / 100,
        fair_value: Math.round(fairValue * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        reasoning: `${reasoning} Entry=${(entryPrice * 100).toFixed(0)}¢ ${side.toUpperCase()}. ` +
          `Net profit/contract=${(netProfit * 100).toFixed(1)}¢. Vol=${m.volume}.`,
        quantity: 10, // engine resizes
      });
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
