import { createServerClient } from "@/lib/supabase/server";
import type { Market } from "@/lib/supabase/types";
import type { Opportunity, Strategy, StrategyPerformance } from "./types";
import {
  isEntryPriceSafe,
  minEdgeAfterFees,
  sizePosition,
  expectedValue,
  takerFee,
} from "./kalshi-math";
import { wideSpread } from "./wide-spread";
import { stalePrice } from "./stale-price";
import { extremeValue } from "./extreme-value";
import { meanReversion } from "./mean-reversion";
import { volumeSpike } from "./volume-spike";
import { eventCluster } from "./event-cluster";
import { favoriteLongshot } from "./favorite-longshot";
import { expiryConvergence } from "./expiry-convergence";
import { newListing } from "./new-listing";
import { liquidityProvision } from "./liquidity-provision";
import { mlStrategy } from "./ml-strategy";
import { estimateSlippageYes, estimateSlippageNo } from "./slippage";
import type { DepthLevel } from "./slippage";
import { checkCircuitBreakers } from "./circuit-breakers";

const ALL_STRATEGIES: Strategy[] = [
  wideSpread,
  stalePrice,
  extremeValue,
  meanReversion,
  volumeSpike,
  eventCluster,
  favoriteLongshot,
  expiryConvergence,
  newListing,
  liquidityProvision,
  mlStrategy,
];

const STARTING_BALANCE = 10000;
const MAX_OPEN_PER_STRATEGY = 5;
const DECAY_WINDOW = 20; // last N trades to check for performance decay
const DECAY_WIN_RATE_THRESHOLD = 0.40;

export async function scanAll(): Promise<{
  opportunities: Opportunity[];
  strategiesRun: string[];
  strategiesSkipped: string[];
  perStrategy: Record<string, number>;
}> {
  const supabase = await createServerClient();

  // Load enabled strategies from DB
  const { data: dbStrategies } = await supabase
    .from("strategies")
    .select("id, enabled")
    .eq("enabled", true);

  const enabledIds = new Set((dbStrategies ?? []).map((s) => s.id));
  const strategiesRun: string[] = [];
  const strategiesSkipped: string[] = [];

  // Load active markets from DB with pricing data (Kalshi uses "active" not "open")
  // Filter to markets that actually have prices to avoid scanning 40K empty markets
  const { data: markets } = await supabase
    .from("markets")
    .select("*")
    .in("status", ["open", "active"])
    .not("yes_bid", "is", null)
    .not("last_price", "is", null)
    .order("volume", { ascending: false })
    .limit(5000);

  if (!markets || markets.length === 0) {
    return { opportunities: [], strategiesRun, strategiesSkipped, perStrategy: {} };
  }

  // Check for performance decay before running each strategy
  const allOpportunities: Opportunity[] = [];
  const perStrategy: Record<string, number> = {};

  for (const strategy of ALL_STRATEGIES) {
    if (!enabledIds.has(strategy.id)) {
      strategiesSkipped.push(strategy.id);
      continue;
    }

    // Check decay
    const decayed = await checkPerformanceDecay(supabase, strategy.id);
    if (decayed) {
      strategiesSkipped.push(strategy.id);
      // Auto-disable and log
      await supabase
        .from("strategies")
        .update({ enabled: false })
        .eq("id", strategy.id);
      await supabase.from("strategy_learnings").insert({
        strategy_id: strategy.id,
        learning_type: "auto_disabled",
        description: `Auto-disabled: win rate dropped below ${DECAY_WIN_RATE_THRESHOLD * 100}% over last ${DECAY_WINDOW} trades`,
        data: { threshold: DECAY_WIN_RATE_THRESHOLD, window: DECAY_WINDOW },
      });
      continue;
    }

    try {
      const opps = await strategy.scan(markets as Market[], { supabase });
      allOpportunities.push(...opps);
      perStrategy[strategy.id] = opps.length;
      strategiesRun.push(strategy.id);
    } catch (err) {
      console.error(`Strategy ${strategy.id} failed:`, err);
      perStrategy[strategy.id] = -1;
      strategiesSkipped.push(strategy.id);
    }
  }

  // Auto-watchlist top 50 opportunity tickers so price snapshots cover them
  if (allOpportunities.length > 0) {
    const topTickers = allOpportunities
      .sort((a, b) => b.edge - a.edge)
      .slice(0, 50)
      .map((opp) => ({
        ticker: opp.ticker,
        notes: `Auto-watchlisted by strategy scan`,
      }));

    for (const item of topTickers) {
      await supabase
        .from("watchlist")
        .upsert(item, { onConflict: "ticker" });
    }
  }

  // Deduplicate: when multiple strategies flag the same ticker,
  // keep only the opportunity with the highest edge
  const bestByTicker = new Map<string, Opportunity>();
  for (const opp of allOpportunities) {
    const existing = bestByTicker.get(opp.ticker);
    if (!existing || opp.edge > existing.edge) {
      bestByTicker.set(opp.ticker, opp);
    }
  }
  const deduped = Array.from(bestByTicker.values());

  return {
    opportunities: deduped.sort((a, b) => b.edge - a.edge),
    strategiesRun,
    strategiesSkipped,
    perStrategy,
  };
}

export async function autoTrade(opportunities: Opportunity[]): Promise<{
  trades_placed: number;
  predictions_written: number;
  skipped: number;
  details: Array<{ ticker: string; strategy_id: string; side: string; edge: number; action: string }>;
}> {
  const supabase = await createServerClient();
  let tradesPlaced = 0;
  let predictionsWritten = 0;
  let skipped = 0;
  const details: Array<{ ticker: string; strategy_id: string; side: string; edge: number; action: string }> = [];

  // Get current portfolio state for position sizing
  const { data: openTrades } = await supabase
    .from("paper_trades")
    .select("ticker, strategy_id, cost")
    .eq("status", "open");

  const totalOpenCost = (openTrades ?? []).reduce((sum, t) => sum + (t.cost ?? 0), 0);
  const availableCapital = STARTING_BALANCE - totalOpenCost;

  // Count open trades per strategy
  const openByStrategy = new Map<string, number>();
  const openByTicker = new Set<string>();
  for (const t of openTrades ?? []) {
    openByStrategy.set(t.strategy_id ?? "", (openByStrategy.get(t.strategy_id ?? "") ?? 0) + 1);
    openByTicker.add(t.ticker);
  }

  // Track which filter kills opportunities, grouped by strategy
  const filterStats = new Map<string, Map<string, number>>();
  const incrFilter = (strategyId: string, filterName: string) => {
    if (!filterStats.has(strategyId)) filterStats.set(strategyId, new Map());
    const m = filterStats.get(strategyId)!;
    m.set(filterName, (m.get(filterName) ?? 0) + 1);
  };

  for (const opp of opportunities) {
    // Get current market data for accurate pricing
    const { data: market } = await supabase
      .from("markets")
      .select("yes_ask, yes_bid, volume, open_interest")
      .eq("ticker", opp.ticker)
      .single();

    // For maker-style strategies (e.g., liquidity-provision), use the strategy's
    // own entry price — they assume limit-order fills near midpoint, not taker fills.
    // For taker strategies (default), use live yes_ask/yes_bid.
    let entryPrice: number;
    if (opp.entry_type === "maker") {
      // Strategy already computed a realistic maker entry price
      entryPrice = opp.side === "yes"
        ? opp.fair_value - opp.edge  // entry = fair_value - edge
        : opp.fair_value - opp.edge;
    } else {
      // Default taker entry: use live market prices
      entryPrice = opp.side === "yes"
        ? (market?.yes_ask ?? opp.fair_value * 100) / 100
        : (100 - (market?.yes_bid ?? (1 - opp.fair_value) * 100)) / 100;
    }

    // --- SLIPPAGE ADJUSTMENT: use orderbook depth for realistic entry ---
    // Skip slippage override for maker strategies — they don't take liquidity
    if (opp.entry_type !== "maker") {
      const { data: latestOb } = await supabase
        .from("orderbook_snapshots")
        .select("depth_yes_bid, depth_yes_ask")
        .eq("ticker", opp.ticker)
        .order("snapshot_at", { ascending: false })
        .limit(1)
        .single();

      if (latestOb) {
        const depthBid = (latestOb.depth_yes_bid ?? []) as DepthLevel[];
        const depthAsk = (latestOb.depth_yes_ask ?? []) as DepthLevel[];
        const slipEst = opp.side === "yes"
          ? estimateSlippageYes(depthAsk, opp.quantity)
          : estimateSlippageNo(depthBid, opp.quantity);

        if (slipEst.canFill && slipEst.effectivePrice > 0) {
          entryPrice = slipEst.effectivePrice;
        }

        // Skip trade if slippage exceeds 3¢
        if (slipEst.slippageCents > 3) {
          details.push({ ...pick(opp), action: `skipped: slippage ${slipEst.slippageCents.toFixed(1)}¢ > 3¢ max` });
          incrFilter(opp.strategy_id, "slippage");
          skipped++;
          continue;
        }
      }
    }

    // --- GUARDRAIL: Entry price safety ---
    if (!isEntryPriceSafe(entryPrice, opp.strategy_id)) {
      details.push({ ...pick(opp), action: `skipped: entry price ${(entryPrice * 100).toFixed(0)}¢ outside safe range` });
      incrFilter(opp.strategy_id, "entry_price_safety");
      skipped++;
      continue;
    }

    // --- GUARDRAIL: Edge must clear fees ---
    const minEdge = minEdgeAfterFees(entryPrice);
    if (opp.edge < minEdge) {
      details.push({ ...pick(opp), action: `skipped: edge ${(opp.edge * 100).toFixed(1)}¢ < min ${(minEdge * 100).toFixed(1)}¢ (fees + buffer)` });
      incrFilter(opp.strategy_id, "edge_vs_fees");
      skipped++;
      continue;
    }

    // Don't double up on the same ticker (open positions)
    if (openByTicker.has(opp.ticker)) {
      details.push({ ...pick(opp), action: "skipped: already have position" });
      incrFilter(opp.strategy_id, "duplicate_ticker");
      skipped++;
      continue;
    }

    // Don't re-enter a ticker that was recently traded (within 48h) — prevents churn
    const { data: recentTrade } = await supabase
      .from("paper_trades")
      .select("id")
      .eq("ticker", opp.ticker)
      .gte("created_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .single();
    if (recentTrade) {
      details.push({ ...pick(opp), action: "skipped: ticker traded within 48h" });
      incrFilter(opp.strategy_id, "recent_trade_cooldown");
      skipped++;
      continue;
    }

    // Max open trades per strategy
    const strategyOpen = openByStrategy.get(opp.strategy_id) ?? 0;
    if (strategyOpen >= MAX_OPEN_PER_STRATEGY) {
      details.push({ ...pick(opp), action: "skipped: strategy at max positions" });
      incrFilter(opp.strategy_id, "max_positions");
      skipped++;
      continue;
    }

    // --- POSITION SIZING: fee-aware, liquidity-aware, realistic ---
    const volume = market?.volume ?? opp.quantity;
    const oi = market?.open_interest ?? 0;
    const quantity = sizePosition({
      entryPriceNorm: entryPrice,
      edge: opp.edge,
      volume24h: volume,
      openInterest: oi,
      availableCapital,
      portfolioValue: STARTING_BALANCE,
    });

    const cost = Math.round(quantity * entryPrice * 100) / 100;
    const fee = takerFee(quantity, entryPrice);

    if (cost + fee > availableCapital || quantity <= 0) {
      details.push({ ...pick(opp), action: "skipped: insufficient capital" });
      incrFilter(opp.strategy_id, "insufficient_capital");
      skipped++;
      continue;
    }

    // --- GUARDRAIL: Expected value must be positive ---
    const ev = expectedValue(quantity, entryPrice, opp.fair_value);
    if (ev <= 0) {
      details.push({ ...pick(opp), action: `skipped: negative EV ($${ev.toFixed(2)}) after fees` });
      incrFilter(opp.strategy_id, "negative_ev");
      skipped++;
      continue;
    }

    // --- CIRCUIT BREAKERS: portfolio-level safety checks ---
    const breakerResult = await checkCircuitBreakers(opp.ticker, opp.strategy_id);
    if (!breakerResult.allowed) {
      details.push({ ...pick(opp), action: `halted: ${breakerResult.reason}` });
      incrFilter(opp.strategy_id, "circuit_breaker");
      skipped++;
      continue;
    }

    // Write prediction
    const { data: prediction, error: predError } = await supabase
      .from("predictions")
      .insert({
        ticker: opp.ticker,
        side: opp.side,
        confidence: opp.confidence,
        fair_value: opp.fair_value,
        edge: opp.edge,
        reasoning: opp.reasoning + ` | Fee: ${(fee * 100).toFixed(0)}¢, EV: $${ev.toFixed(2)}, Qty: ${quantity}`,
        status: "pending",
        strategy_id: opp.strategy_id,
      })
      .select("id")
      .single();

    if (predError) {
      details.push({ ...pick(opp), action: `error: prediction insert failed - ${predError.message}` });
      continue;
    }
    predictionsWritten++;

    // Execute paper trade (cost includes fee for realistic paper trading)
    const totalCost = Math.round((cost + fee) * 100) / 100;

    const { error: tradeError } = await supabase
      .from("paper_trades")
      .insert({
        ticker: opp.ticker,
        side: opp.side,
        quantity,
        price: Math.round(entryPrice * 10000) / 10000,
        cost: totalCost,
        fee: Math.round(fee * 100) / 100,
        status: "open",
        prediction_id: prediction.id,
        strategy_id: opp.strategy_id,
      });

    if (tradeError) {
      details.push({ ...pick(opp), action: `error: trade insert failed - ${tradeError.message}` });
      continue;
    }
    tradesPlaced++;

    // Add to watchlist for price tracking
    await supabase
      .from("watchlist")
      .upsert(
        { ticker: opp.ticker, notes: `Auto-added by ${opp.strategy_id}` },
        { onConflict: "ticker" }
      );

    openByStrategy.set(opp.strategy_id, strategyOpen + 1);
    openByTicker.add(opp.ticker);
    details.push({ ...pick(opp), action: `traded: ${quantity}x @ ${(entryPrice * 100).toFixed(0)}¢, cost=$${totalCost}, EV=$${ev.toFixed(2)}` });
  }

  // Log filter stats summary for debugging which guardrails are killing opportunities
  if (filterStats.size > 0) {
    const summary: Record<string, Record<string, number>> = {};
    for (const [stratId, filters] of filterStats) {
      summary[stratId] = Object.fromEntries(filters);
    }
    console.log("Filter stats by strategy:", JSON.stringify(summary));
  }

  return { trades_placed: tradesPlaced, predictions_written: predictionsWritten, skipped, details };
}

async function checkPerformanceDecay(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  strategyId: string
): Promise<boolean> {
  const { data: recentTrades } = await supabase
    .from("paper_trades")
    .select("pnl")
    .eq("strategy_id", strategyId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(DECAY_WINDOW);

  if (!recentTrades || recentTrades.length < DECAY_WINDOW) return false;

  const wins = recentTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRate = wins / recentTrades.length;
  return winRate < DECAY_WIN_RATE_THRESHOLD;
}

export async function getPerformance(strategyId?: string): Promise<StrategyPerformance[]> {
  const supabase = await createServerClient();

  // Get all strategies
  const { data: strategies } = await supabase
    .from("strategies")
    .select("id, name");

  if (!strategies) return [];

  const results: StrategyPerformance[] = [];

  for (const s of strategies) {
    if (strategyId && s.id !== strategyId) continue;

    const { data: closedTrades } = await supabase
      .from("paper_trades")
      .select("pnl, edge, closed_at")
      .eq("strategy_id", s.id)
      .eq("status", "closed")
      .order("closed_at", { ascending: false });

    const trades = closedTrades ?? [];
    const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
    const losses = trades.length - wins;
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

    // Get avg edge from predictions
    const { data: preds } = await supabase
      .from("predictions")
      .select("edge")
      .eq("strategy_id", s.id);

    const avgEdge = preds && preds.length > 0
      ? preds.reduce((sum, p) => sum + (p.edge ?? 0), 0) / preds.length
      : 0;

    results.push({
      strategy_id: s.id,
      strategy_name: s.name,
      total_trades: trades.length,
      wins,
      losses,
      win_rate: trades.length > 0 ? wins / trades.length : 0,
      total_pnl: Math.round(totalPnl * 100) / 100,
      avg_edge: Math.round(avgEdge * 10000) / 10000,
      avg_pnl_per_trade: trades.length > 0 ? Math.round((totalPnl / trades.length) * 100) / 100 : 0,
      last_trade_at: trades.length > 0 ? trades[0].closed_at : null,
    });
  }

  return results;
}

function pick(opp: Opportunity) {
  return {
    ticker: opp.ticker,
    strategy_id: opp.strategy_id,
    side: opp.side,
    edge: opp.edge,
  };
}
