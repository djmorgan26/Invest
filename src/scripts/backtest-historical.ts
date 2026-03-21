import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Dynamic imports for strategies (works with tsx)
async function loadStrategies() {
  const { wideSpread } = await import("@/lib/strategies/wide-spread");
  const { stalePrice } = await import("@/lib/strategies/stale-price");
  const { extremeValue } = await import("@/lib/strategies/extreme-value");
  const { meanReversion } = await import("@/lib/strategies/mean-reversion");
  const { volumeSpike } = await import("@/lib/strategies/volume-spike");
  const { eventCluster } = await import("@/lib/strategies/event-cluster");
  const { favoriteLongshot } = await import("@/lib/strategies/favorite-longshot");
  const { expiryConvergence } = await import("@/lib/strategies/expiry-convergence");
  const { newListing } = await import("@/lib/strategies/new-listing");
  const { liquidityProvision } = await import("@/lib/strategies/liquidity-provision");

  return {
    "wide-spread": wideSpread,
    "stale-price": stalePrice,
    "extreme-value": extremeValue,
    "mean-reversion": meanReversion,
    "volume-spike": volumeSpike,
    "event-cluster": eventCluster,
    "favorite-longshot": favoriteLongshot,
    "expiry-convergence": expiryConvergence,
    "new-listing": newListing,
    "liquidity-provision": liquidityProvision,
  };
}

interface TradeRecord {
  ticker: string;
  yes_price: number;
  no_price: number;
  count: number;
  taker_side: string;
  created_time: string;
}

interface MarketMeta {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string | null;
  close_time: string | null;
  result: string | null;
  category: string | null;
  created_at: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  return {
    strategy: get("--strategy") ?? "all",
    period: get("--period") ?? "3m",
    budget: parseFloat(get("--budget") ?? "10000"),
    category: get("--category"),
    sweep: args.includes("--sweep"),
    verbose: args.includes("--verbose"),
    maxMarkets: parseInt(get("--max-markets") ?? "500"),
  };
}

function getPeriodCutoff(period: string): Date | null {
  if (period === "all") return null;
  const now = new Date();
  const days: Record<string, number> = { "1w": 7, "1m": 30, "3m": 90, "6m": 180 };
  const d = days[period];
  return d ? new Date(now.getTime() - d * 24 * 60 * 60 * 1000) : null;
}

async function loadMarketData(
  maxMarkets: number,
  periodCutoff: Date | null,
  category?: string
): Promise<
  Array<{
    meta: MarketMeta;
    trades: TradeRecord[];
    result: string;
    category: string | null;
  }>
> {
  console.log("Loading settled markets with trade history...");

  // Get settled markets
  let query = supabase
    .from("markets")
    .select("ticker, event_ticker, title, subtitle, close_time, result, volume, created_at")
    .not("result", "is", null)
    .order("volume", { ascending: false })
    .limit(maxMarkets);

  if (periodCutoff) {
    query = query.gte("close_time", periodCutoff.toISOString());
  }

  const { data: markets, error: mErr } = await query;
  if (mErr) throw new Error(`Failed to load markets: ${mErr.message}`);
  if (!markets || markets.length === 0) {
    console.log("No settled markets found.");
    return [];
  }

  console.log(`Found ${markets.length} settled markets`);

  // Get categories from events
  const eventTickers = [...new Set(markets.map((m) => m.event_ticker))];
  const { data: events } = await supabase
    .from("events")
    .select("event_ticker, category")
    .in("event_ticker", eventTickers.slice(0, 500));

  const categoryMap = new Map<string, string>();
  for (const e of events ?? []) {
    if (e.category) categoryMap.set(e.event_ticker, e.category);
  }

  // Filter by category if specified
  let filteredMarkets = markets;
  if (category) {
    filteredMarkets = markets.filter(
      (m) => categoryMap.get(m.event_ticker)?.toLowerCase() === category.toLowerCase()
    );
    console.log(`Filtered to ${filteredMarkets.length} markets in category "${category}"`);
  }

  // Load trade history for these markets
  const tickers = filteredMarkets.map((m) => m.ticker);
  console.log(`Loading trade history for ${tickers.length} markets...`);

  const result: Array<{
    meta: MarketMeta;
    trades: TradeRecord[];
    result: string;
    category: string | null;
  }> = [];

  // Batch load trades
  for (let i = 0; i < tickers.length; i += 100) {
    const batch = tickers.slice(i, i + 100);
    const { data: trades } = await supabase
      .from("market_trades")
      .select("ticker, yes_price, no_price, count, taker_side, created_time")
      .in("ticker", batch)
      .order("created_time", { ascending: true });

    if (!trades || trades.length === 0) continue;

    // Group trades by ticker
    const byTicker = new Map<string, TradeRecord[]>();
    for (const t of trades) {
      if (!byTicker.has(t.ticker)) byTicker.set(t.ticker, []);
      byTicker.get(t.ticker)!.push(t);
    }

    for (const market of filteredMarkets.filter((m) => batch.includes(m.ticker))) {
      const marketTrades = byTicker.get(market.ticker);
      if (!marketTrades || marketTrades.length < 5) continue;

      result.push({
        meta: {
          ticker: market.ticker,
          event_ticker: market.event_ticker,
          title: market.title,
          subtitle: market.subtitle,
          close_time: market.close_time,
          result: market.result,
          category: categoryMap.get(market.event_ticker) ?? null,
          created_at: market.created_at,
        },
        trades: marketTrades,
        result: market.result!,
        category: categoryMap.get(market.event_ticker) ?? null,
      });
    }
  }

  console.log(`Loaded ${result.length} markets with trade history (${result.reduce((s, r) => s + r.trades.length, 0)} total trades)`);
  return result;
}

async function main() {
  const args = parseArgs();
  console.log("=== Historical Backtester ===");
  console.log(`Strategy: ${args.strategy}`);
  console.log(`Period: ${args.period}`);
  console.log(`Budget: $${args.budget}`);
  if (args.category) console.log(`Category: ${args.category}`);
  if (args.sweep) console.log("Mode: PARAMETER SWEEP");
  console.log("");

  const allStrategies = await loadStrategies();
  const periodCutoff = getPeriodCutoff(args.period);
  const marketData = await loadMarketData(args.maxMarkets, periodCutoff, args.category);

  if (marketData.length === 0) {
    console.log("\nNo data to backtest. Run 'npx tsx src/scripts/fetch-historical-trades.ts' first to collect trade history.");
    return;
  }

  // Select strategies
  const strategyIds =
    args.strategy === "all"
      ? Object.keys(allStrategies)
      : args.strategy.split(",");

  if (args.sweep) {
    // Parameter sweep mode
    const { runParamSweep, PARAM_GRIDS, formatSweepResults } = await import(
      "@/lib/backtesting/param-sweep"
    );

    for (const stratId of strategyIds) {
      const strategy = allStrategies[stratId as keyof typeof allStrategies];
      if (!strategy) {
        console.log(`Unknown strategy: ${stratId}`);
        continue;
      }

      const grid = PARAM_GRIDS[stratId];
      if (!grid) {
        console.log(`No parameter grid defined for ${stratId}`);
        continue;
      }

      console.log(`\n${"=".repeat(60)}`);
      console.log(`SWEEP: ${strategy.name} (${strategy.id})`);
      console.log(`${"=".repeat(60)}`);

      const results = await runParamSweep(
        strategy,
        marketData,
        grid,
        supabase,
        args.budget,
        (completed, total) => {
          if (completed % 10 === 0) {
            process.stdout.write(`  Progress: ${completed}/${total}\r`);
          }
        }
      );

      console.log(formatSweepResults(results, 15));

      // Store best result
      if (results.length > 0) {
        const best = results[0];
        await supabase.from("backtest_results").insert({
          strategy_id: stratId,
          config: best.config,
          period_start: periodCutoff?.toISOString() ?? new Date(0).toISOString(),
          period_end: new Date().toISOString(),
          total_trades: best.stats.totalTrades,
          wins: best.stats.wins,
          losses: best.stats.losses,
          win_rate: best.stats.winRate,
          total_pnl: best.stats.totalPnl,
          sharpe_ratio: best.stats.sharpeRatio,
          max_drawdown: best.stats.maxDrawdown,
          max_drawdown_pct: best.stats.maxDrawdownPct,
          avg_edge: best.stats.avgEdge,
          avg_pnl_per_trade: best.stats.avgPnlPerTrade,
          by_category: best.stats.byCategory,
          trade_log: null, // skip for sweep results
        });

        console.log(`\nBest config stored in backtest_results table.`);
        console.log(`Recommended config: ${JSON.stringify(best.config, null, 2)}`);
      }
    }
  } else {
    // Single backtest mode
    const { runHistoricalBacktest } = await import("@/lib/backtesting/engine");

    const strategies = strategyIds
      .map((id) => allStrategies[id as keyof typeof allStrategies])
      .filter(Boolean);

    if (strategies.length === 0) {
      console.log("No valid strategies selected.");
      return;
    }

    console.log(`\nRunning backtest with ${strategies.length} strategies on ${marketData.length} markets...`);

    const { stats, trades } = await runHistoricalBacktest(
      marketData,
      { strategies, budget: args.budget },
      supabase
    );

    // Print results
    console.log("\n" + "=".repeat(60));
    console.log("BACKTEST RESULTS");
    console.log("=".repeat(60));
    console.log(`Total Trades:   ${stats.totalTrades}`);
    console.log(`Wins:           ${stats.wins} (${(stats.winRate * 100).toFixed(1)}%)`);
    console.log(`Losses:         ${stats.losses}`);
    console.log(`Total PnL:      $${stats.totalPnl.toFixed(2)}`);
    console.log(`Avg PnL/Trade:  $${stats.avgPnlPerTrade.toFixed(2)}`);
    console.log(`Avg Edge:       ${(stats.avgEdge * 100).toFixed(1)}¢`);
    console.log(`Sharpe Ratio:   ${stats.sharpeRatio.toFixed(2)}`);
    console.log(`Max Drawdown:   $${stats.maxDrawdown.toFixed(2)} (${stats.maxDrawdownPct.toFixed(1)}%)`);
    console.log(`Profit Factor:  ${stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}`);

    // By strategy
    console.log("\n--- By Strategy ---");
    for (const [stratId, s] of Object.entries(stats.byStrategy)) {
      console.log(
        `  ${stratId.padEnd(22)} | ${String(s.trades).padStart(4)} trades | ` +
          `${(s.winRate * 100).toFixed(1).padStart(5)}% win | ` +
          `$${s.pnl.toFixed(2).padStart(8)} PnL | ` +
          `${(s.avgEdge * 100).toFixed(1).padStart(5)}¢ avg edge`
      );
    }

    // By category
    if (Object.keys(stats.byCategory).length > 0) {
      console.log("\n--- By Category ---");
      const catEntries = Object.entries(stats.byCategory).sort((a, b) => b[1].pnl - a[1].pnl);
      for (const [cat, c] of catEntries) {
        console.log(
          `  ${cat.padEnd(22)} | ${String(c.trades).padStart(4)} trades | ` +
            `${(c.winRate * 100).toFixed(1).padStart(5)}% win | ` +
            `$${c.pnl.toFixed(2).padStart(8)} PnL`
        );
      }
    }

    // Verbose: show individual trades
    if (args.verbose && trades.length > 0) {
      console.log("\n--- Trade Log ---");
      for (const t of trades.slice(0, 50)) {
        const icon = t.result === "win" ? "✓" : "✗";
        console.log(
          `  ${icon} ${t.ticker.padEnd(30)} | ${t.strategy_id.padEnd(18)} | ` +
            `${t.side.padEnd(3)} @ ${(t.entry_price * 100).toFixed(0).padStart(3)}¢ | ` +
            `$${t.pnl.toFixed(2).padStart(6)} | edge=${(t.edge * 100).toFixed(1)}¢`
        );
      }
      if (trades.length > 50) {
        console.log(`  ... and ${trades.length - 50} more trades`);
      }
    }

    // Go-live readiness check
    console.log("\n--- Go-Live Readiness ---");
    const checks = [
      { name: "200+ resolved trades", pass: stats.totalTrades >= 200, value: `${stats.totalTrades}/200` },
      { name: "Win rate > 55%", pass: stats.winRate > 0.55, value: `${(stats.winRate * 100).toFixed(1)}%` },
      { name: "Positive PnL", pass: stats.totalPnl > 0, value: `$${stats.totalPnl.toFixed(2)}` },
      { name: "Sharpe > 1.0", pass: stats.sharpeRatio > 1.0, value: `${stats.sharpeRatio.toFixed(2)}` },
      { name: "Max DD < 15%", pass: stats.maxDrawdownPct < 15, value: `${stats.maxDrawdownPct.toFixed(1)}%` },
    ];
    for (const check of checks) {
      console.log(`  ${check.pass ? "[PASS]" : "[FAIL]"} ${check.name}: ${check.value}`);
    }
    const allPass = checks.every((c) => c.pass);
    console.log(`\n  ${allPass ? "READY FOR LIVE TRADING" : "NOT READY — keep optimizing"}`);

    // Calibration analysis
    if (trades.length >= 10) {
      const { analyzeCalibration, formatCalibrationReport, storeCalibration } = await import(
        "@/lib/backtesting/calibration"
      );
      const calibReports = analyzeCalibration(trades);
      console.log(formatCalibrationReport(calibReports));
      await storeCalibration(calibReports, supabase);
    }

    // Store results
    for (const stratId of strategyIds) {
      const stratTrades = trades.filter((t) => t.strategy_id === stratId);
      if (stratTrades.length === 0) continue;

      const stratStats = stats.byStrategy[stratId];
      if (!stratStats) continue;

      await supabase.from("backtest_results").insert({
        strategy_id: stratId,
        config: {},
        period_start: periodCutoff?.toISOString() ?? new Date(0).toISOString(),
        period_end: new Date().toISOString(),
        total_trades: stratStats.trades,
        wins: stratStats.wins,
        losses: stratStats.trades - stratStats.wins,
        win_rate: stratStats.winRate,
        total_pnl: stratStats.pnl,
        sharpe_ratio: stats.sharpeRatio,
        max_drawdown: stats.maxDrawdown,
        max_drawdown_pct: stats.maxDrawdownPct,
        avg_edge: stratStats.avgEdge,
        avg_pnl_per_trade: stratStats.trades > 0 ? stratStats.pnl / stratStats.trades : 0,
        by_category: stats.byCategory,
        trade_log: stratTrades.slice(0, 100),
      });
    }

    console.log("\nResults stored in backtest_results table.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
