import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";
import { isEntryPriceSafe, takerFee, makerFee, minEdgeAfterFees } from "./kalshi-math";

/**
 * Liquidity Provision Strategy (Passive Market Making)
 *
 * Instead of directional bets, capture bid-ask spread by identifying markets
 * where the spread is wide enough to profit after fees, but the price is
 * relatively stable (low adverse selection risk).
 *
 * Distinct from wide-spread strategy: wide-spread takes a directional bet
 * at the midpoint. This strategy identifies markets where BOTH sides are
 * tradeable — the spread itself is the edge, not the direction.
 *
 * In paper trading we simulate this as: buy at the midpoint and target
 * a small, reliable profit. We lean toward the side where the orderbook
 * shows more depth (less adverse selection risk).
 *
 * Approach:
 * - Find markets with spread > 8¢ (enough to profit after both-side fees)
 * - Require price stability over last 24h (low adverse selection)
 * - Use orderbook depth asymmetry to pick the safer side
 * - Target modest edge (spread/2 minus fees)
 * - Higher position limits — this is a volume strategy, not a conviction strategy
 */

const STRATEGY_ID = "liquidity-provision";
const DEFAULT_CONFIG = {
  min_spread: 0.08,          // 8¢ minimum spread to cover both-side fees
  max_spread: 0.25,          // skip absurdly wide spreads (dead markets)
  min_volume: 30,            // needs some baseline activity
  max_price_volatility: 0.08, // max 8¢ price range in 24h (stability filter)
  lookback_hours: 24,
  min_depth_ratio: 1.5,      // orderbook asymmetry: lean toward deeper side
  max_days_to_close: 21,     // avoid near-expiry (prices move fast)
  min_days_to_close: 2,
  min_entry_price: 0.15,
  max_entry_price: 0.85,
};

function getConfig(dbConfig: StrategyConfig) {
  return { ...DEFAULT_CONFIG, ...dbConfig };
}

export const liquidityProvision: Strategy = {
  id: STRATEGY_ID,
  name: "Liquidity Provision",

  async scan(markets: Market[], context: ScanContext): Promise<Opportunity[]> {
    const { data: strategy } = await context.supabase
      .from("strategies")
      .select("config")
      .eq("id", STRATEGY_ID)
      .single();

    const config = getConfig((strategy?.config as StrategyConfig) ?? {});
    const now = Date.now();
    const opportunities: Opportunity[] = [];

    // Pre-filter: markets with wide spreads and reasonable volume
    const candidates = markets.filter((m) => {
      if (m.status !== "open" && m.status !== "active") return false;
      if (m.result) return false;
      if (m.last_price == null || m.yes_bid == null || m.yes_ask == null) return false;
      if ((m.volume ?? 0) < config.min_volume) return false;

      const spread = (m.yes_ask - m.yes_bid) / 100;
      if (spread < config.min_spread || spread > config.max_spread) return false;

      if (m.close_time) {
        const daysToClose = (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60 * 24);
        if (daysToClose < config.min_days_to_close || daysToClose > config.max_days_to_close) return false;
      }

      return true;
    });

    if (candidates.length === 0) return opportunities;

    // Get price snapshots for volatility check
    const lookbackCutoff = new Date(now - config.lookback_hours * 60 * 60 * 1000);
    const tickers = candidates.map((m) => m.ticker);
    const batchSize = 500;
    const allSnapshots: Array<{ ticker: string; last_price: number }> = [];

    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const { data: snapshots } = await context.supabase
        .from("price_snapshots")
        .select("ticker, last_price")
        .in("ticker", batch)
        .gte("snapshot_at", lookbackCutoff.toISOString());
      if (snapshots) allSnapshots.push(...snapshots);
    }

    // Build per-ticker volatility: max - min price range
    const tickerVolatility = new Map<string, { min: number; max: number; count: number }>();
    for (const snap of allSnapshots) {
      const priceNorm = snap.last_price / 100;
      if (!tickerVolatility.has(snap.ticker)) {
        tickerVolatility.set(snap.ticker, { min: priceNorm, max: priceNorm, count: 0 });
      }
      const data = tickerVolatility.get(snap.ticker)!;
      data.min = Math.min(data.min, priceNorm);
      data.max = Math.max(data.max, priceNorm);
      data.count++;
    }

    // Get orderbook depth for side selection
    const { data: orderbooks } = await context.supabase
      .from("orderbook_snapshots")
      .select("ticker, depth_yes_bid, depth_yes_ask")
      .in("ticker", tickers)
      .order("snapshot_at", { ascending: false });

    // Deduplicate to latest per ticker
    const latestOrderbook = new Map<string, { depth_yes_bid: unknown; depth_yes_ask: unknown }>();
    for (const ob of orderbooks ?? []) {
      if (!latestOrderbook.has(ob.ticker)) {
        latestOrderbook.set(ob.ticker, {
          depth_yes_bid: ob.depth_yes_bid,
          depth_yes_ask: ob.depth_yes_ask,
        });
      }
    }

    for (const m of candidates) {
      const lastPrice = m.last_price! / 100;
      const yesBid = m.yes_bid! / 100;
      const yesAsk = m.yes_ask! / 100;
      const spread = yesAsk - yesBid;
      const midpoint = (yesBid + yesAsk) / 2;

      // Volatility filter: skip markets with large recent price swings
      const vol = tickerVolatility.get(m.ticker);
      if (vol && vol.count >= 3) {
        const priceRange = vol.max - vol.min;
        if (priceRange > config.max_price_volatility) continue;
      }

      // Determine side using orderbook depth asymmetry
      // Lean toward the side with MORE resting liquidity (less adverse selection)
      let side: "yes" | "no";
      const ob = latestOrderbook.get(m.ticker);

      if (ob) {
        const bidDepth = Array.isArray(ob.depth_yes_bid)
          ? (ob.depth_yes_bid as Array<{ quantity: number }>).reduce((s, l) => s + (l.quantity ?? 0), 0)
          : 0;
        const askDepth = Array.isArray(ob.depth_yes_ask)
          ? (ob.depth_yes_ask as Array<{ quantity: number }>).reduce((s, l) => s + (l.quantity ?? 0), 0)
          : 0;

        if (bidDepth > 0 && askDepth > 0) {
          const ratio = bidDepth / askDepth;
          if (ratio >= config.min_depth_ratio) {
            // More bid depth → bid side is safer → buy YES (join the strong side)
            side = "yes";
          } else if (1 / ratio >= config.min_depth_ratio) {
            // More ask depth → ask side is safer → buy NO
            side = "no";
          } else {
            // No clear asymmetry — lean toward whichever side is cheaper
            side = midpoint < 0.50 ? "yes" : "no";
          }
        } else {
          side = midpoint < 0.50 ? "yes" : "no";
        }
      } else {
        // No orderbook data — default to cheaper side
        side = midpoint < 0.50 ? "yes" : "no";
      }

      // Entry price: we're providing liquidity, so we'd ideally place a limit order
      // In paper trading, approximate as midpoint (between taker and maker)
      const entryPrice = side === "yes"
        ? Math.min(yesAsk, midpoint + 0.01) // slightly above mid but below ask
        : Math.min((100 - m.yes_bid!) / 100, (1 - midpoint) + 0.01);

      if (entryPrice < config.min_entry_price || entryPrice > config.max_entry_price) continue;
      if (!isEntryPriceSafe(entryPrice, STRATEGY_ID)) continue;

      // Fair value: midpoint IS our fair value estimate (market is balanced)
      // Our edge comes from entering better than the taker price
      const fairValue = side === "yes"
        ? Math.min(0.85, midpoint + spread * 0.25) // slight lean toward our side
        : Math.min(0.85, (1 - midpoint) + spread * 0.25);

      const edge = fairValue - entryPrice;
      if (edge <= 0) continue;
      if (edge < minEdgeAfterFees(entryPrice)) continue;

      const feePerContract = takerFee(1, entryPrice);
      const netProfit = 1 - entryPrice - feePerContract;
      if (netProfit < 0.03) continue;

      // Stability-based confidence: less volatile = more reliable spread capture
      const volRange = vol ? (vol.max - vol.min) : config.max_price_volatility;
      const stabilityScore = 1 - (volRange / config.max_price_volatility);
      const confidence = Math.min(0.70, 0.45 + stabilityScore * 0.15 + edge * 0.3);

      const daysToClose = m.close_time
        ? (new Date(m.close_time).getTime() - now) / (1000 * 60 * 60 * 24)
        : 0;

      opportunities.push({
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        market_title: m.title,
        strategy_id: STRATEGY_ID,
        side,
        confidence: Math.round(confidence * 100) / 100,
        fair_value: Math.round(fairValue * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        reasoning: `Liquidity provision: spread=${(spread * 100).toFixed(0)}¢, ` +
          `midpoint=${(midpoint * 100).toFixed(0)}¢, ` +
          `24h range=${vol ? (volRange * 100).toFixed(0) : "?"}¢ (stable). ` +
          `${daysToClose.toFixed(0)}d to close, vol=${m.volume}. ` +
          `Entry=${(entryPrice * 100).toFixed(0)}¢ ${side.toUpperCase()}. ` +
          `Spread capture strategy.`,
        quantity: 10,
      });
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
