Run the autonomous strategy optimizer. This agent decides what to do based on the current state of the system.

The optimizer works through these phases automatically:

1. **Assess** — Check historical data coverage, existing backtest results, live performance, calibration
2. **Collect** — If trade history is sparse, fetch more from Kalshi API
3. **Backtest** — Run strategies against historical data to measure real edge
4. **Optimize** — Run parameter sweeps for promising strategies
5. **Calibrate** — Check prediction accuracy (Brier scores, bias detection)
6. **Enrich** — Evaluate external data impact on strategy performance
7. **Decide** — Produce verdicts: KEEP / TUNE / DISABLE for each of the 10 strategies
8. **Act** — Apply improvements, record learnings, update configs

## How to start

Use the strategy-optimizer skill. It has the full context, queries, decision rules, and toolkit reference.

If $ARGUMENTS contains specific instructions (e.g., "focus on wide-spread" or "just run backtests"), follow those. Otherwise, run the full autonomous workflow from Phase 0.

## Key commands available:
- `npx tsx src/scripts/fetch-historical-trades.ts --max=200` — Fetch trade history
- `npx tsx src/scripts/backtest-historical.ts --strategy all --period 3m` — Backtest
- `npx tsx src/scripts/backtest-historical.ts --strategy X --sweep` — Parameter sweep
- `npx tsx src/scripts/review-performance.ts` — Live performance review
- `npx tsx src/scripts/fetch-external-data.ts --divergences` — Check cross-market divergences
- `npx tsx src/scripts/live-monitor.ts` — Real-time stale price detection (WebSocket)
- `npx tsx src/scripts/sync-settled.ts` — Sync settled markets for backtesting data

## All 10 strategies to evaluate:
wide-spread, stale-price, extreme-value, mean-reversion, volume-spike, event-cluster, favorite-longshot, expiry-convergence, new-listing, liquidity-provision

## Decision rules:
- **Disable** strategy if backtest win rate < 45% over 50+ trades
- **Tune** if backtest win rate 45-55% and sweep shows >20% Sharpe improvement
- **Keep** if win rate > 55%, positive PnL, Sharpe > 0.8
- **Enrich** — Consider whether adding external signal filters could improve a borderline strategy
- Always ask before applying parameter changes

## External data enrichment considerations:
- Can stale-price use live monitor WebSocket data for faster detection?
- Can cross-market divergences from Polymarket/PredictIt improve fair value estimates?
- Do sports strategies benefit from ESPN live scores + odds API consensus?
- Does crypto strategy performance correlate with CoinGecko Fear & Greed Index?
- Can weather strategies use Open-Meteo/NWS forecasts for better settlement prediction?
