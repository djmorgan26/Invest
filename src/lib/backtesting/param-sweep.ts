/**
 * Parameter sweep engine for strategy optimization.
 *
 * Tests a grid of parameter combinations via backtesting
 * and ranks by Sharpe ratio / win rate / PnL.
 */

import type { Strategy, StrategyConfig } from "@/lib/strategies/types";
import type { BacktestStats, SimulatedTrade } from "./engine";
import { runHistoricalBacktest } from "./engine";
import type { TradeRecord, MarketMetadata } from "./snapshot-reconstructor";

export interface ParamGrid {
  [paramName: string]: number[];
}

export interface SweepResult {
  config: StrategyConfig;
  stats: BacktestStats;
  rank: number;
}

/** Default parameter grids per strategy */
export const PARAM_GRIDS: Record<string, ParamGrid> = {
  "wide-spread": {
    min_spread: [0.05, 0.08, 0.10, 0.15, 0.20],
    min_volume: [50, 100, 200, 500],
    max_entry_price: [0.70, 0.75, 0.80, 0.85],
    min_risk_reward: [0.15, 0.20, 0.30, 0.40],
  },
  "mean-reversion": {
    min_move: [0.08, 0.10, 0.12, 0.15, 0.20],
    reversion_factor: [0.3, 0.4, 0.5, 0.6, 0.7],
    lookback_hours: [12, 24, 48],
  },
  "extreme-value": {
    low_threshold: [0.05, 0.08, 0.10],
    high_threshold: [0.90, 0.92, 0.95],
    max_days_to_close: [1, 3, 5, 7],
    min_volume: [30, 50, 100],
  },
  "favorite-longshot": {
    longshot_overpricing: [0.20, 0.25, 0.30, 0.35, 0.40],
    favorite_underpricing: [0.02, 0.03, 0.05],
    min_volume: [50, 100, 200],
  },
  "volume-spike": {
    volume_multiplier: [2.0, 3.0, 4.0, 5.0],
    min_price_move: [0.02, 0.03, 0.05],
    momentum_factor: [0.2, 0.3, 0.4, 0.5],
  },
  "expiry-convergence": {
    max_hours_to_close: [24, 48, 72],
    min_momentum: [0.03, 0.05, 0.08],
  },
  "stale-price": {
    max_hours_since_settlement: [12, 24, 48, 72],
  },
  "new-listing": {
    max_hours_since_listing: [6, 12, 24, 48],
    min_spread: [0.05, 0.08, 0.10],
  },
  "liquidity-provision": {
    min_spread: [0.06, 0.08, 0.10, 0.15],
    max_price_volatility: [0.03, 0.05, 0.08],
  },
  "event-cluster": {
    min_mispricing: [0.03, 0.05, 0.08, 0.10],
  },
};

/**
 * Generate all parameter combinations from a grid.
 * Limits to maxCombinations to prevent runaway.
 */
export function generateCombinations(
  grid: ParamGrid,
  maxCombinations: number = 200
): StrategyConfig[] {
  const params = Object.keys(grid);
  const combinations: StrategyConfig[] = [];

  function recurse(index: number, current: StrategyConfig) {
    if (combinations.length >= maxCombinations) return;
    if (index === params.length) {
      combinations.push({ ...current });
      return;
    }

    const param = params[index];
    for (const value of grid[param]) {
      if (combinations.length >= maxCombinations) return;
      current[param] = value;
      recurse(index + 1, current);
    }
  }

  recurse(0, {});
  return combinations;
}

/**
 * Run a parameter sweep for a strategy.
 * Tests each parameter combination via backtesting and ranks results.
 */
export async function runParamSweep(
  strategy: Strategy,
  marketData: Array<{
    meta: MarketMetadata;
    trades: TradeRecord[];
    result: string;
    category: string | null;
  }>,
  grid: ParamGrid,
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  budget: number = 10000,
  onProgress?: (completed: number, total: number, current: StrategyConfig) => void
): Promise<SweepResult[]> {
  const combinations = generateCombinations(grid);
  const results: SweepResult[] = [];

  console.log(`Testing ${combinations.length} parameter combinations for ${strategy.id}...`);

  for (let i = 0; i < combinations.length; i++) {
    const config = combinations[i];
    onProgress?.(i, combinations.length, config);

    // Override strategy config by writing to strategies table temporarily
    // Instead, we'll create a modified strategy that uses this config
    const modifiedStrategy = createConfiguredStrategy(strategy, config, supabase);

    try {
      const { stats } = await runHistoricalBacktest(
        marketData,
        { strategies: [modifiedStrategy], budget },
        supabase
      );

      results.push({ config, stats, rank: 0 });
    } catch {
      // Skip failed combinations
      continue;
    }
  }

  // Rank by composite score: Sharpe * sqrt(trades) * winRate
  // This balances quality (Sharpe), confidence (more trades), and reliability (win rate)
  results.sort((a, b) => {
    const scoreA = compositeScore(a.stats);
    const scoreB = compositeScore(b.stats);
    return scoreB - scoreA;
  });

  results.forEach((r, i) => (r.rank = i + 1));
  return results;
}

function compositeScore(stats: BacktestStats): number {
  if (stats.totalTrades < 5) return -Infinity; // need minimum trades
  const tradeConfidence = Math.sqrt(stats.totalTrades);
  return stats.sharpeRatio * tradeConfidence * stats.winRate;
}

/**
 * Create a strategy instance that uses specific config overrides.
 * Uses a proxy to intercept config queries instead of writing to DB
 * (which would corrupt live strategy configs during sweeps).
 */
function createConfiguredStrategy(
  original: Strategy,
  configOverride: StrategyConfig,
  _supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>
): Strategy {
  return {
    id: original.id,
    name: original.name,
    async scan(markets, context) {
      // Intercept the strategy config query to return our override
      const proxiedContext = {
        supabase: new Proxy(context.supabase, {
          get(target, prop) {
            if (prop === "from") {
              return (table: string) => {
                if (table === "strategies") {
                  // Return a mock query that yields our config override
                  return {
                    select: () => ({
                      eq: () => ({
                        single: () =>
                          Promise.resolve({
                            data: { config: configOverride },
                            error: null,
                          }),
                      }),
                    }),
                  };
                }
                return target.from(table);
              };
            }
            return (target as Record<string, unknown>)[prop as string];
          },
        }),
      };
      return await original.scan(markets, proxiedContext);
    },
  };
}

/**
 * Format sweep results for display
 */
export function formatSweepResults(results: SweepResult[], topN: number = 10): string {
  const lines: string[] = [];
  lines.push(`\nTop ${Math.min(topN, results.length)} parameter combinations:\n`);
  lines.push(
    "Rank | Win Rate | PnL     | Sharpe | Trades | Config"
  );
  lines.push(
    "-----|----------|---------|--------|--------|-------"
  );

  for (const r of results.slice(0, topN)) {
    const params = Object.entries(r.config)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(
      `#${String(r.rank).padStart(3)} | ${(r.stats.winRate * 100).toFixed(1).padStart(5)}% | $${r.stats.totalPnl.toFixed(2).padStart(7)} | ${r.stats.sharpeRatio.toFixed(2).padStart(5)} | ${String(r.stats.totalTrades).padStart(6)} | ${params}`
    );
  }

  return lines.join("\n");
}
