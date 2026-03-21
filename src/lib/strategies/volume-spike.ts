import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";
import { isEntryPriceSafe, minEdgeAfterFees, riskRewardRatio } from "./kalshi-math";

const STRATEGY_ID = "volume-spike";
const DEFAULT_CONFIG = {
  volume_multiplier: 2.0, // 2x baseline volume = spike
  min_price_move: 0.03, // 3¢ minimum accompanying price move
  momentum_factor: 0.3, // fair value = current + move * factor
  lookback_hours: 48, // baseline window
  min_volume: 50, // minimum absolute volume
  max_days_to_close: 14,
  max_entry_price: 0.85,
  min_entry_price: 0.10,
  min_risk_reward: 0.20,
};

function getConfig(dbConfig: StrategyConfig) {
  return { ...DEFAULT_CONFIG, ...dbConfig };
}

export const volumeSpike: Strategy = {
  id: STRATEGY_ID,
  name: "Volume Spike",

  async scan(markets: Market[], context: ScanContext): Promise<Opportunity[]> {
    const { data: strategy } = await context.supabase
      .from("strategies")
      .select("config")
      .eq("id", STRATEGY_ID)
      .single();

    const config = getConfig((strategy?.config as StrategyConfig) ?? {});
    const now = new Date();
    const lookbackCutoff = new Date(now.getTime() - config.lookback_hours * 60 * 60 * 1000);
    const recentCutoff = new Date(now.getTime() - 4 * 60 * 60 * 1000); // last 4h for "recent" volume
    const opportunities: Opportunity[] = [];

    // Filter to markets with pricing data
    const openMarkets = markets.filter(
      (m) =>
        (m.status === "open" || m.status === "active") &&
        !m.result &&
        m.last_price != null &&
        m.yes_bid != null &&
        m.yes_ask != null &&
        (m.volume ?? 0) >= config.min_volume
    );

    if (openMarkets.length === 0) return opportunities;

    // Get price snapshots for baseline comparison
    const tickers = openMarkets.map((m) => m.ticker);
    const batchSize = 500;
    const allSnapshots: Array<{ ticker: string; last_price: number; volume: number; snapshot_at: string }> = [];

    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const { data: snapshots } = await context.supabase
        .from("price_snapshots")
        .select("ticker, last_price, volume, snapshot_at")
        .in("ticker", batch)
        .gte("snapshot_at", lookbackCutoff.toISOString())
        .order("snapshot_at", { ascending: true });
      if (snapshots) allSnapshots.push(...snapshots);
    }

    if (allSnapshots.length === 0) return opportunities;

    // Build per-ticker baseline: average volume per snapshot in the lookback window
    // and earliest price for price move calculation
    const tickerData = new Map<string, { volumes: number[]; earliestPrice: number; recentVolumes: number[] }>();

    for (const snap of allSnapshots) {
      if (!tickerData.has(snap.ticker)) {
        tickerData.set(snap.ticker, { volumes: [], earliestPrice: snap.last_price, recentVolumes: [] });
      }
      const data = tickerData.get(snap.ticker)!;
      data.volumes.push(snap.volume);
      if (new Date(snap.snapshot_at) >= recentCutoff) {
        data.recentVolumes.push(snap.volume);
      }
    }

    for (const m of openMarkets) {
      const data = tickerData.get(m.ticker);
      if (!data || data.volumes.length < 2) continue; // need baseline data

      // Calculate baseline average volume
      const baselineAvg = data.volumes.reduce((a, b) => a + b, 0) / data.volumes.length;
      if (baselineAvg <= 0) continue;

      // Current volume (use 24h volume or total volume as proxy)
      const currentVolume = m.volume_24h ?? m.volume ?? 0;

      // Check for spike: current volume vs baseline
      const volumeRatio = currentVolume / baselineAvg;
      if (volumeRatio < config.volume_multiplier) continue;

      // Check for accompanying price move
      const currentPrice = m.last_price! / 100;
      const earliestPrice = data.earliestPrice / 100;
      const priceMove = currentPrice - earliestPrice;
      const absPriceMove = Math.abs(priceMove);

      if (absPriceMove < config.min_price_move) continue;

      // Time filter
      if (m.close_time) {
        const daysToClose = (new Date(m.close_time).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        if (daysToClose < 0 || daysToClose > config.max_days_to_close) continue;
      }

      // Trade in direction of price move (momentum continuation)
      const side: "yes" | "no" = priceMove > 0 ? "yes" : "no";

      // Entry price
      const entryPrice = side === "yes"
        ? m.yes_ask! / 100
        : (100 - m.yes_bid!) / 100;

      // Price guardrails
      if (entryPrice > config.max_entry_price || entryPrice < config.min_entry_price) continue;
      if (!isEntryPriceSafe(entryPrice, STRATEGY_ID)) continue;

      // Risk/reward
      if (riskRewardRatio(entryPrice) < config.min_risk_reward) continue;

      // Fair value: momentum continuation in the direction of the move
      // YES: price going up → fair P(YES) = current + momentum
      // NO: price going down → fair P(NO) = (1-current) + momentum
      // Both sides: we're buying the winning direction, so fair value > entry price
      const fairValue = side === "yes"
        ? Math.min(0.90, Math.max(0.10, currentPrice + absPriceMove * config.momentum_factor))
        : Math.min(0.90, Math.max(0.10, (1 - currentPrice) + absPriceMove * config.momentum_factor));

      const edge = fairValue - entryPrice;

      // Edge must clear fees
      if (edge < minEdgeAfterFees(entryPrice)) continue;
      if (edge <= 0) continue;

      opportunities.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        market_title: m.title,
        strategy_id: STRATEGY_ID,
        side,
        confidence: Math.min(0.5 + edge * 0.5, 0.75),
        fair_value: Math.round(fairValue * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        reasoning: `Volume spike: ${volumeRatio.toFixed(1)}x baseline (${currentVolume} vs avg ${baselineAvg.toFixed(0)}). Price ${priceMove > 0 ? "+" : ""}${(priceMove * 100).toFixed(1)}¢ over ${config.lookback_hours}h. Entry=${(entryPrice * 100).toFixed(0)}¢ ${side.toUpperCase()}. R/R=${riskRewardRatio(entryPrice).toFixed(2)}.`,
        quantity: 10, // engine will resize
      });
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
