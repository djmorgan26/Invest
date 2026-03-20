import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";

const STRATEGY_ID = "mean-reversion";
const DEFAULT_CONFIG = {
  min_move: 0.15,
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
    const { data: oldSnapshots } = await context.supabase
      .from("price_snapshots")
      .select("ticker, last_price, snapshot_at")
      .in("ticker", tickers)
      .gte("snapshot_at", lookbackCutoff.toISOString())
      .order("snapshot_at", { ascending: true });

    if (!oldSnapshots || oldSnapshots.length === 0) return opportunities;

    // Build map: ticker → earliest snapshot price in lookback window
    const earliestPrice = new Map<string, number>();
    for (const snap of oldSnapshots) {
      if (!earliestPrice.has(snap.ticker)) {
        earliestPrice.set(snap.ticker, snap.last_price);
      }
    }

    for (const m of openMarkets) {
      const oldPrice = earliestPrice.get(m.ticker);
      if (oldPrice == null) continue;

      const currentPrice = m.last_price! / 100; // normalize
      const oldPriceNorm = oldPrice / 100; // snapshots store raw values like markets
      const move = currentPrice - oldPriceNorm;
      const absMove = Math.abs(move);

      if (absMove < config.min_move) continue;

      // Predict partial reversion
      const reversionAmount = absMove * config.reversion_factor;
      let side: "yes" | "no";
      let fairValue: number;

      if (move > 0) {
        // Price went up sharply — bet it reverts down → buy NO
        side = "no";
        fairValue = 1 - (currentPrice - reversionAmount);
      } else {
        // Price went down sharply — bet it reverts up → buy YES
        side = "yes";
        fairValue = currentPrice + reversionAmount;
      }

      // Clamp fair value
      fairValue = Math.max(0.05, Math.min(0.95, fairValue));

      const edge = side === "yes"
        ? fairValue - currentPrice
        : fairValue - (1 - currentPrice);

      if (edge < 0.05) continue;

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
        reasoning: `Mean reversion: price moved ${move > 0 ? "+" : ""}${(move * 100).toFixed(1)}¢ in ${config.lookback_hours}h (${(oldPriceNorm * 100).toFixed(0)}¢ → ${(currentPrice * 100).toFixed(0)}¢). Expecting ${(config.reversion_factor * 100).toFixed(0)}% reversion. Volume=${m.volume}.`,
        quantity: 10,
      });
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
