/**
 * Historical backtesting engine.
 *
 * The key insight: for settled markets with known results, we can reconstruct
 * what they looked like at historical points in time using trade history,
 * run our strategy scan() functions, and check if the opportunities would
 * have been profitable.
 *
 * This gives us months of backtestable data without waiting for paper trades.
 */

import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext } from "@/lib/strategies/types";
import {
  takerFee,
  isEntryPriceSafe,
  sizePosition,
  expectedValue,
} from "@/lib/strategies/kalshi-math";
import {
  reconstructMarketAt,
  type TradeRecord,
  type MarketMetadata,
} from "./snapshot-reconstructor";

export interface BacktestConfig {
  strategies: Strategy[];
  budget: number;
  maxPositionsPerStrategy: number;
  minEdge: number; // minimum edge to take a trade (0-1)
  slippageBps: number; // basis points of slippage to assume
}

export interface SimulatedTrade {
  ticker: string;
  event_ticker: string;
  strategy_id: string;
  side: "yes" | "no";
  entry_price: number; // 0-1
  fair_value: number;
  edge: number;
  quantity: number;
  cost: number;
  fee: number;
  result: "win" | "loss";
  exit_price: number; // 1.0 or 0.0
  pnl: number;
  entry_time: string;
  close_time: string;
  market_title: string;
  category: string | null;
  reasoning: string;
}

export interface BacktestStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnlPerTrade: number;
  avgEdge: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  profitFactor: number; // gross profit / gross loss
  byStrategy: Record<
    string,
    {
      trades: number;
      wins: number;
      winRate: number;
      pnl: number;
      avgEdge: number;
    }
  >;
  byCategory: Record<
    string,
    {
      trades: number;
      wins: number;
      winRate: number;
      pnl: number;
    }
  >;
  equityCurve: { date: string; value: number }[];
}

const DEFAULT_CONFIG: BacktestConfig = {
  strategies: [],
  budget: 10000,
  maxPositionsPerStrategy: 5,
  minEdge: 0.05,
  slippageBps: 50, // 0.5% slippage
};

/**
 * Run a historical backtest.
 *
 * For each settled market with trade history:
 * 1. Reconstruct the market state at a scan point (e.g., 24h before close)
 * 2. Run strategy.scan() to find opportunities
 * 3. Simulate trade execution with fees + slippage
 * 4. Compare predicted side to actual result
 * 5. Compute PnL
 */
export async function runHistoricalBacktest(
  marketData: Array<{
    meta: MarketMetadata;
    trades: TradeRecord[];
    result: string; // "yes" or "no"
    category: string | null;
  }>,
  config: Partial<BacktestConfig> & { strategies: Strategy[] },
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>
): Promise<{ stats: BacktestStats; trades: SimulatedTrade[] }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const allSimTrades: SimulatedTrade[] = [];
  const openPositions = new Map<string, Set<string>>(); // strategy_id -> Set<ticker>

  // Group markets by close_time for chronological processing
  const sortedMarkets = [...marketData].sort((a, b) => {
    const aTime = a.meta.close_time ? new Date(a.meta.close_time).getTime() : 0;
    const bTime = b.meta.close_time ? new Date(b.meta.close_time).getTime() : 0;
    return aTime - bTime;
  });

  // Process each market: reconstruct state at various scan points and run strategies
  for (const { meta, trades, result, category } of sortedMarkets) {
    if (trades.length < 5) continue; // need enough trades for reconstruction
    if (!meta.close_time) continue;

    const closeTime = new Date(meta.close_time);

    // Define scan points: 48h, 24h, 12h, 6h, 2h before close
    const scanOffsets = [48, 24, 12, 6, 2]; // hours before close
    let alreadyTraded = new Set<string>(); // strategy_id already entered this market

    for (const hoursBeforeClose of scanOffsets) {
      const scanTime = new Date(closeTime.getTime() - hoursBeforeClose * 60 * 60 * 1000);

      // Reconstruct market state at this time
      const reconstructed = reconstructMarketAt(meta, trades, scanTime);
      if (!reconstructed) continue;

      // Build a fake ScanContext that returns snapshots from our trade data
      const mockContext = createMockScanContext(meta.ticker, trades, scanTime, supabase);

      // Run each strategy
      for (const strategy of cfg.strategies) {
        if (alreadyTraded.has(strategy.id)) continue;

        // Check position limits
        const stratPositions = openPositions.get(strategy.id) ?? new Set();
        if (stratPositions.size >= cfg.maxPositionsPerStrategy) continue;

        try {
          const opportunities = await strategy.scan([reconstructed], mockContext);
          if (opportunities.length === 0) continue;

          // Take the best opportunity for this market
          const opp = opportunities[0];

          // Apply slippage
          const slippage = opp.edge * (cfg.slippageBps / 10000);
          let entryPrice =
            opp.side === "yes"
              ? (reconstructed.yes_ask ?? reconstructed.last_price ?? 50) / 100
              : (100 - (reconstructed.yes_bid ?? reconstructed.last_price ?? 50)) / 100;
          entryPrice += slippage;

          // Guardrails
          if (!isEntryPriceSafe(entryPrice, strategy.id)) continue;
          if (opp.edge < cfg.minEdge) continue;

          // Position sizing
          const quantity = sizePosition({
            entryPriceNorm: entryPrice,
            edge: opp.edge,
            volume24h: reconstructed.volume_24h ?? reconstructed.volume ?? 100,
            openInterest: 0,
            availableCapital: cfg.budget, // simplified
            portfolioValue: cfg.budget,
          });

          const fee = takerFee(quantity, entryPrice);
          const cost = quantity * entryPrice + fee;
          const ev = expectedValue(quantity, entryPrice, opp.fair_value);
          if (ev <= 0) continue;

          // Determine outcome
          const won = opp.side === result;
          const exitPrice = won ? 1.0 : 0.0;
          const pnl = won
            ? quantity * (1.0 - entryPrice) - fee
            : -(quantity * entryPrice + fee);

          allSimTrades.push({
            ticker: meta.ticker,
            event_ticker: meta.event_ticker,
            strategy_id: strategy.id,
            side: opp.side,
            entry_price: entryPrice,
            fair_value: opp.fair_value,
            edge: opp.edge,
            quantity,
            cost,
            fee,
            result: won ? "win" : "loss",
            exit_price: exitPrice,
            pnl: Math.round(pnl * 100) / 100,
            entry_time: scanTime.toISOString(),
            close_time: meta.close_time,
            market_title: meta.title,
            category,
            reasoning: opp.reasoning,
          });

          alreadyTraded.add(strategy.id);
          stratPositions.add(meta.ticker);
          openPositions.set(strategy.id, stratPositions);
        } catch {
          // Strategy scan failed for this market — skip silently
          continue;
        }
      }
    }

    // "Close" positions for this market (it settled)
    for (const [stratId, tickers] of openPositions) {
      tickers.delete(meta.ticker);
    }
  }

  // Compute stats
  const stats = computeStats(allSimTrades, cfg.budget);

  return { stats, trades: allSimTrades };
}

function computeStats(trades: SimulatedTrade[], budget: number): BacktestStats {
  const wins = trades.filter((t) => t.result === "win").length;
  const losses = trades.length - wins;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgEdge = trades.length > 0 ? trades.reduce((s, t) => s + t.edge, 0) / trades.length : 0;

  // Gross profit / gross loss for profit factor
  const grossProfit = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));

  // Equity curve and drawdown
  const sorted = [...trades].sort(
    (a, b) => new Date(a.close_time).getTime() - new Date(b.close_time).getTime()
  );
  let portfolioValue = budget;
  let peak = budget;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  const equityCurve: { date: string; value: number }[] = [
    { date: sorted.length > 0 ? sorted[0].entry_time : new Date().toISOString(), value: budget },
  ];

  const dailyReturns: number[] = [];
  let lastDate = "";
  let dailyPnl = 0;

  for (const trade of sorted) {
    portfolioValue += trade.pnl;
    const tradeDate = trade.close_time.split("T")[0];

    if (tradeDate !== lastDate && lastDate !== "") {
      dailyReturns.push(dailyPnl / budget);
      dailyPnl = 0;
    }
    dailyPnl += trade.pnl;
    lastDate = tradeDate;

    if (portfolioValue > peak) peak = portfolioValue;
    const dd = peak - portfolioValue;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = peak > 0 ? (dd / peak) * 100 : 0;
    }

    equityCurve.push({
      date: trade.close_time,
      value: Math.round(portfolioValue * 100) / 100,
    });
  }

  // Push final day
  if (dailyPnl !== 0) {
    dailyReturns.push(dailyPnl / budget);
  }

  // Sharpe ratio
  let sharpeRatio = 0;
  if (dailyReturns.length >= 2) {
    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
    const stddev = Math.sqrt(variance);
    if (stddev > 0) {
      sharpeRatio = (mean / stddev) * Math.sqrt(252);
    }
  }

  // By strategy
  const byStrategy: BacktestStats["byStrategy"] = {};
  for (const trade of trades) {
    if (!byStrategy[trade.strategy_id]) {
      byStrategy[trade.strategy_id] = { trades: 0, wins: 0, winRate: 0, pnl: 0, avgEdge: 0 };
    }
    const s = byStrategy[trade.strategy_id];
    s.trades++;
    if (trade.result === "win") s.wins++;
    s.pnl += trade.pnl;
    s.avgEdge += trade.edge;
  }
  for (const s of Object.values(byStrategy)) {
    s.winRate = s.trades > 0 ? s.wins / s.trades : 0;
    s.avgEdge = s.trades > 0 ? s.avgEdge / s.trades : 0;
    s.pnl = Math.round(s.pnl * 100) / 100;
  }

  // By category
  const byCategory: BacktestStats["byCategory"] = {};
  for (const trade of trades) {
    const cat = trade.category || "unknown";
    if (!byCategory[cat]) {
      byCategory[cat] = { trades: 0, wins: 0, winRate: 0, pnl: 0 };
    }
    const c = byCategory[cat];
    c.trades++;
    if (trade.result === "win") c.wins++;
    c.pnl += trade.pnl;
  }
  for (const c of Object.values(byCategory)) {
    c.winRate = c.trades > 0 ? c.wins / c.trades : 0;
    c.pnl = Math.round(c.pnl * 100) / 100;
  }

  return {
    totalTrades: trades.length,
    wins,
    losses,
    winRate: trades.length > 0 ? wins / trades.length : 0,
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgPnlPerTrade: trades.length > 0 ? Math.round((totalPnl / trades.length) * 100) / 100 : 0,
    avgEdge: Math.round(avgEdge * 10000) / 10000,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? Infinity : 0,
    byStrategy,
    byCategory,
    equityCurve,
  };
}

/**
 * Create a mock ScanContext that provides price snapshots from trade data.
 * This allows strategies that query price_snapshots to work in backtesting.
 */
function createMockScanContext(
  ticker: string,
  trades: TradeRecord[],
  atTime: Date,
  realSupabase: ReturnType<typeof import("@supabase/supabase-js").createClient>
): ScanContext {
  const atMs = atTime.getTime();

  // Build synthetic snapshots from trades
  const relevantTrades = trades.filter(
    (t) => new Date(t.created_time).getTime() <= atMs
  );

  // Create a proxy that intercepts price_snapshots queries
  const handler: ProxyHandler<typeof realSupabase> = {
    get(target, prop) {
      if (prop === "from") {
        return (table: string) => {
          if (table === "price_snapshots") {
            return createMockSnapshotQuery(ticker, relevantTrades);
          }
          if (table === "strategies") {
            return target.from(table);
          }
          if (table === "markets") {
            return createMockMarketsQuery(ticker, relevantTrades, atTime);
          }
          // For event-related queries, use real DB
          return target.from(table);
        };
      }
      return (target as Record<string, unknown>)[prop as string];
    },
  };

  return { supabase: new Proxy(realSupabase, handler) as typeof realSupabase };
}

/**
 * Mock snapshot query builder that returns synthetic snapshots from trade data.
 */
function createMockSnapshotQuery(ticker: string, trades: TradeRecord[]) {
  // Build hourly snapshots from trades
  const snapshots = buildSyntheticSnapshots(ticker, trades);

  // Return a chainable query builder that resolves to snapshots
  let filterTickers: string[] = [];
  let afterTime: string | null = null;
  let ascending = true;

  const builder = {
    select: () => builder,
    in: (_col: string, values: string[]) => {
      filterTickers = values;
      return builder;
    },
    eq: () => builder,
    gte: (_col: string, val: string) => {
      afterTime = val;
      return builder;
    },
    lte: () => builder,
    order: (_col: string, opts?: { ascending?: boolean }) => {
      ascending = opts?.ascending ?? true;
      return builder;
    },
    limit: () => builder,
    single: () => builder,
    then: (resolve: (value: { data: typeof snapshots; error: null }) => void) => {
      let filtered = snapshots;
      if (filterTickers.length > 0) {
        filtered = filtered.filter((s) => filterTickers.includes(s.ticker));
      }
      if (afterTime) {
        filtered = filtered.filter(
          (s) => new Date(s.snapshot_at) >= new Date(afterTime!)
        );
      }
      if (ascending) {
        filtered.sort(
          (a, b) => new Date(a.snapshot_at).getTime() - new Date(b.snapshot_at).getTime()
        );
      } else {
        filtered.sort(
          (a, b) => new Date(b.snapshot_at).getTime() - new Date(a.snapshot_at).getTime()
        );
      }
      resolve({ data: filtered, error: null });
    },
  };

  return builder;
}

function createMockMarketsQuery(ticker: string, trades: TradeRecord[], atTime: Date) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    not: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => ({
      then: (resolve: (value: { data: null; error: null }) => void) => {
        resolve({ data: null, error: null });
      },
    }),
    then: (resolve: (value: { data: never[]; error: null }) => void) => {
      resolve({ data: [], error: null });
    },
  };
  return builder;
}

function buildSyntheticSnapshots(ticker: string, trades: TradeRecord[]) {
  if (trades.length === 0) return [];

  const sorted = [...trades].sort(
    (a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime()
  );

  const snapshots: Array<{
    ticker: string;
    last_price: number;
    yes_bid: number;
    yes_ask: number;
    volume: number;
    snapshot_at: string;
  }> = [];

  // Build hourly snapshots
  const hourMs = 60 * 60 * 1000;
  const firstTime = new Date(sorted[0].created_time).getTime();
  const lastTime = new Date(sorted[sorted.length - 1].created_time).getTime();

  for (let t = firstTime; t <= lastTime; t += hourMs) {
    const beforeTime = trades.filter(
      (tr) => new Date(tr.created_time).getTime() <= t
    );
    if (beforeTime.length === 0) continue;

    const recent = beforeTime.slice(-10); // last 10 trades
    const lastTrade = recent[recent.length - 1];
    const prices = recent.map((tr) => tr.yes_price);
    const vol = beforeTime
      .filter((tr) => t - new Date(tr.created_time).getTime() <= 24 * hourMs)
      .reduce((s, tr) => s + tr.count, 0);

    snapshots.push({
      ticker,
      last_price: lastTrade.yes_price,
      yes_bid: Math.min(...prices),
      yes_ask: Math.max(...prices),
      volume: vol,
      snapshot_at: new Date(t).toISOString(),
    });
  }

  return snapshots;
}
