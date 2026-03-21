Run the autonomous strategy optimizer. This agent decides what to do based on the current state of the system.

The optimizer works through these phases automatically:

1. **Assess** — Check historical data coverage, existing backtest results, live performance, calibration
2. **Collect** — If trade history is sparse, fetch more from Kalshi API
3. **Backtest** — Run strategies against historical data to measure real edge
4. **Optimize** — Run parameter sweeps for promising strategies
5. **Calibrate** — Check prediction accuracy (Brier scores, bias detection)
6. **Decide** — Produce verdicts: KEEP / TUNE / DISABLE for each strategy
7. **Act** — Apply improvements, record learnings, update configs

## How to start

Use the strategy-optimizer skill. It has the full context, queries, decision rules, and toolkit reference.

If $ARGUMENTS contains specific instructions (e.g., "focus on wide-spread" or "just run backtests"), follow those. Otherwise, run the full autonomous workflow from Phase 0.

## Key commands available:
- `npx tsx src/scripts/fetch-historical-trades.ts --max=200` — Fetch trade history
- `npx tsx src/scripts/backtest-historical.ts --strategy all --period 3m` — Backtest
- `npx tsx src/scripts/backtest-historical.ts --strategy X --sweep` — Parameter sweep
- `npx tsx src/scripts/review-performance.ts` — Live performance review

## Decision rules:
- **Disable** strategy if backtest win rate < 45% over 50+ trades
- **Tune** if backtest win rate 45-55% and sweep shows >20% Sharpe improvement
- **Keep** if win rate > 55%, positive PnL, Sharpe > 0.8
- Always ask before applying parameter changes
