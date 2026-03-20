import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";
import { isEntryPriceSafe, minEdgeAfterFees, riskRewardRatio } from "./kalshi-math";

const STRATEGY_ID = "mean-reversion";
const DEFAULT_CONFIG = {
  min_move: 0.12, // lowered from 0.15 to catch more opportunities
  lookback_hours: 24,
  reversion_factor: 0.5,
};

function getConfig(dbConfig: StrategyConfig) {
  return { ...DEFAULT_CONFIG, ...dbConfig };
}

export const meanReversion: Strategy = {
  id: STRATEGY_ID,
  name: "Mean Reversion",

  async scan(markets: Market[], context: ScanContext): Promise<Opportunity[]> {
    const { data: strategy } = await context.supabase
      .from("strategies")
      .select("config")
      .eq("id", STRATEGY_ID)
      .single();

    const config = getConfig((strategy?.config as StrategyConfig) ?? {});
    const now = new Date();
    const lookbackCutoff = new Date(now.getTime() - config.lookback_hours * 60 * 60 * 1000);
    const opportunities: Opportunity[] = [];

    // Only look at open markets with recent activity
    const openMarkets = markets.filter(
      (m) => (m.status === "open" || m.status === "active") && !m.result && m.last_price != null && (m.volume ?? 0) > 50
    );

    // Batch: get tickers that have enough snapshots
    const tickers = openMarkets.map((m) => m.ticker);
    if (tickers.length === 0) return opportunities;

    // Get oldest snapshot within lookback window per ticker
    // Query in batches to avoid URL length issues with large IN clauses
    const batchSize = 500;
    const allSnapshots: Array<{ ticker: string; last_price: number; snapshot_at: string }> = [];
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const { data: snapshots } = await context.supabase
        .from("price_snapshots")
        .select("ticker, last_price, snapshot_at")
        .in("ticker", batch)
        .gte("snapshot_at", lookbackCutoff.toISOString())
        .order("snapshot_at", { ascending: true });
      if (snapshots) allSnapshots.push(...snapshots);
    }

    if (allSnapshots.length === 0) return opportunities;

    // Build map: ticker → earliest snapshot price in lookback window
    const earliestPrice = new Map<string, number>();
    for (const snap of allSnapshots) {
      if (!earliestPrice.has(snap.ticker)) {
        earliestPrice.set(snap.ticker, snap.last_price);
      }
    }

    for (const m of openMarkets) {
      const oldPrice = earliestPrice.get(m.ticker);
      if (oldPrice == null) continue;

      const currentPrice = m.last_price! / 100; // normalize
      const oldPriceNorm = oldPrice / 100;
      const move = currentPrice - oldPriceNorm;
      const absMove = Math.abs(move);

      if (absMove < config.min_move) continue;

      // Predict partial reversion
      const reversionAmount = absMove * config.reversion_factor;
      let side: "yes" | "no";
      let fairValue: number;
      let entryPrice: number;

      if (move > 0) {
        // Price went up sharply — bet it reverts down → buy NO
        side = "no";
        fairValue = 1 - (currentPrice - reversionAmount);
        entryPrice = m.yes_bid != null ? (100 - m.yes_bid) / 100 : 1 - currentPrice;
      } else {
        // Price went down sharply — bet it reverts up → buy YES
        side = "yes";
        fairValue = currentPrice + reversionAmount;
        entryPrice = m.yes_ask != null ? m.yes_ask / 100 : currentPrice;
      }

      // Clamp fair value
      fairValue = Math.max(0.10, Math.min(0.90, fairValue));

      // Entry price guardrails
      if (!isEntryPriceSafe(entryPrice, STRATEGY_ID)) continue;

      // Risk/reward check
      if (riskRewardRatio(entryPrice) < 0.20) continue;

      const edge = side === "yes"
        ? fairValue - entryPrice
        : fairValue - (1 - currentPrice);

      // Edge must clear fees
      if (edge < minEdgeAfterFees(entryPrice)) continue;

      const daysToClose = m.close_time
        ? (new Date(m.close_time).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        : null;

      // Skip if market closes too soon (need time for reversion)
      if (daysToClose != null && daysToClose < 0.5) continue;

      opportunities.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        market_title: m.title,
        strategy_id: STRATEGY_ID,
        side,
        confidence: Math.min(0.5 + edge * 0.3, 0.70),
        fair_value: Math.round(fairValue * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        reasoning: `Mean reversion: ${(move > 0 ? "+" : "")}${(move * 100).toFixed(1)}¢ in ${config.lookback_hours}h (${(oldPriceNorm * 100).toFixed(0)}¢→${(currentPrice * 100).toFixed(0)}¢). Entry=${(entryPrice * 100).toFixed(0)}¢ ${side.toUpperCase()}. R/R=${riskRewardRatio(entryPrice).toFixed(2)}. Vol=${m.volume}.`,
        quantity: 10, // engine will resize
      });
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
