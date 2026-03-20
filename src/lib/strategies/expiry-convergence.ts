import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";
import { isEntryPriceSafe, takerFee, minEdgeAfterFees } from "./kalshi-math";

/**
 * Expiry Convergence Strategy ("Sniping the Close")
 *
 * Markets approaching expiry with prices still in the uncertain zone (30-70¢)
 * often have a knowable outcome — the underlying event has occurred or data
 * has been released, but the market hasn't converged yet.
 *
 * This is distinct from extreme-value (which targets <8¢/>92¢) and mean-reversion.
 * This targets the MID-RANGE prices near expiry where the outcome is likely
 * already determinable from public information.
 *
 * Approach:
 * - Find markets closing within 48 hours priced 25-75¢
 * - Check if sibling markets in the same event have already resolved
 *   (strong signal the remaining markets' outcomes are knowable)
 * - Check for recent price momentum (informed traders pushing toward resolution)
 * - Higher confidence when price is trending strongly in one direction near close
 */

const STRATEGY_ID = "expiry-convergence";
const DEFAULT_CONFIG = {
  max_hours_to_close: 48,     // only markets closing within 48h
  min_hours_to_close: 1,      // not literally about to close (settlement lag)
  uncertain_low: 0.25,        // price floor of "uncertain zone"
  uncertain_high: 0.75,       // price ceiling of "uncertain zone"
  min_volume: 50,
  momentum_lookback_hours: 12, // check 12h price trend
  min_momentum: 0.05,         // 5¢ move in lookback period = momentum signal
  momentum_confidence_boost: 0.15, // how much momentum boosts our confidence
  sibling_resolved_boost: 0.10,    // boost if siblings already settled
};

function getConfig(dbConfig: StrategyConfig) {
  return { ...DEFAULT_CONFIG, ...dbConfig };
}

export const expiryConvergence: Strategy = {
  id: STRATEGY_ID,
  name: "Expiry Convergence",

  async scan(markets: Market[], context: ScanContext): Promise<Opportunity[]> {
    const { data: strategy } = await context.supabase
      .from("strategies")
      .select("config")
      .eq("id", STRATEGY_ID)
      .single();

    const config = getConfig((strategy?.config as StrategyConfig) ?? {});
    const now = Date.now();
    const opportunities: Opportunity[] = [];

    // Pre-filter to near-expiry markets in the uncertain zone
    const candidates = markets.filter((m) => {
      if (m.status !== "open" && m.status !== "active") return false;
      if (m.result) return false;
      if (m.last_price == null || m.yes_bid == null || m.yes_ask == null) return false;
      if ((m.volume ?? 0) < config.min_volume) return false;
      if (!m.close_time) return false;

      const hoursToClose = (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60);
      if (hoursToClose < config.min_hours_to_close || hoursToClose > config.max_hours_to_close) return false;

      const lastPrice = m.last_price! / 100;
      return lastPrice >= config.uncertain_low && lastPrice <= config.uncertain_high;
    });

    if (candidates.length === 0) return opportunities;

    // Get price snapshots for momentum detection
    const lookbackCutoff = new Date(now - config.momentum_lookback_hours * 60 * 60 * 1000);
    const tickers = candidates.map((m) => m.ticker);
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

    // Build per-ticker momentum data
    const tickerMomentum = new Map<string, { earliestPrice: number; latestPrice: number; snapshotCount: number }>();
    for (const snap of allSnapshots) {
      if (!tickerMomentum.has(snap.ticker)) {
        tickerMomentum.set(snap.ticker, { earliestPrice: snap.last_price, latestPrice: snap.last_price, snapshotCount: 0 });
      }
      const data = tickerMomentum.get(snap.ticker)!;
      data.latestPrice = snap.last_price;
      data.snapshotCount++;
    }

    // Check for resolved siblings per event (signals the event outcome is knowable)
    const eventTickers = [...new Set(candidates.map((m) => m.event_ticker))];
    const { data: resolvedSiblings } = await context.supabase
      .from("markets")
      .select("event_ticker, ticker, result")
      .in("event_ticker", eventTickers)
      .not("result", "is", null);

    const eventsWithResolutions = new Set(
      (resolvedSiblings ?? []).map((m) => m.event_ticker)
    );

    for (const m of candidates) {
      const lastPrice = m.last_price! / 100;
      const hoursToClose = (new Date(m.close_time!).getTime() - now) / (1000 * 60 * 60);

      // Momentum analysis
      const momentum = tickerMomentum.get(m.ticker);
      let priceMoveNorm = 0;
      let hasMomentum = false;

      if (momentum && momentum.snapshotCount >= 2) {
        priceMoveNorm = (momentum.latestPrice - momentum.earliestPrice) / 100;
        hasMomentum = Math.abs(priceMoveNorm) >= config.min_momentum;
      }

      // Check if siblings have resolved (strong signal)
      const hasResolvedSiblings = eventsWithResolutions.has(m.event_ticker);

      // Allow strong price lean (>60¢ or <40¢) as a signal even without momentum/siblings
      const hasStrongLean = lastPrice > 0.60 || lastPrice < 0.40;
      if (!hasMomentum && !hasResolvedSiblings && !hasStrongLean) continue;

      // Determine trade direction based on signals
      let side: "yes" | "no";
      let fairValue: number;
      let confidenceBase = 0.55;

      if (hasMomentum) {
        // Follow momentum direction — price is converging toward resolution
        if (priceMoveNorm > 0) {
          side = "yes";
          // Fair value: extrapolate momentum toward 1.0, scaled by time pressure
          const timePressure = Math.min(1, (config.max_hours_to_close - hoursToClose) / config.max_hours_to_close);
          fairValue = Math.min(0.92, lastPrice + Math.abs(priceMoveNorm) * (1 + timePressure));
        } else {
          side = "no";
          const timePressure = Math.min(1, (config.max_hours_to_close - hoursToClose) / config.max_hours_to_close);
          fairValue = Math.min(0.92, (1 - lastPrice) + Math.abs(priceMoveNorm) * (1 + timePressure));
        }
        confidenceBase += config.momentum_confidence_boost;
      } else {
        // No momentum but siblings resolved — lean toward the direction
        // that would be consistent with resolved siblings
        // Conservative: just take the side closer to the extreme
        if (lastPrice > 0.50) {
          side = "yes";
          fairValue = Math.min(0.90, lastPrice + 0.08);
        } else {
          side = "no";
          fairValue = Math.min(0.90, (1 - lastPrice) + 0.08);
        }
      }

      if (hasResolvedSiblings) {
        confidenceBase += config.sibling_resolved_boost;
      }

      // Entry price
      const entryPrice = side === "yes"
        ? m.yes_ask! / 100
        : (100 - m.yes_bid!) / 100;

      if (!isEntryPriceSafe(entryPrice, STRATEGY_ID)) continue;

      const edge = fairValue - entryPrice;
      if (edge <= 0) continue;
      if (edge < minEdgeAfterFees(entryPrice)) continue;

      const feePerContract = takerFee(1, entryPrice);
      const netProfit = 1 - entryPrice - feePerContract;
      if (netProfit < 0.02) continue;

      const confidence = Math.min(0.85, confidenceBase + edge * 0.3);

      opportunities.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        market_title: m.title,
        strategy_id: STRATEGY_ID,
        side,
        confidence: Math.round(confidence * 100) / 100,
        fair_value: Math.round(fairValue * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        reasoning: `Expiry convergence: ${hoursToClose.toFixed(0)}h to close, price at ${(lastPrice * 100).toFixed(0)}¢.` +
          (hasMomentum ? ` Momentum: ${priceMoveNorm > 0 ? "+" : ""}${(priceMoveNorm * 100).toFixed(1)}¢ over ${config.momentum_lookback_hours}h.` : "") +
          (hasResolvedSiblings ? " Siblings already settled." : "") +
          ` Entry=${(entryPrice * 100).toFixed(0)}¢ ${side.toUpperCase()}. Net=${(netProfit * 100).toFixed(1)}¢/contract.`,
        quantity: 10,
      });
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
