---
name: kalshi-advisor
description: "Strategic advisor for the Kalshi prediction market trading system. This skill should be used when evaluating trading performance, deciding whether to change strategies or parameters, planning next steps, checking system health, reviewing PnL, or making any strategic decision about the trading engine. Triggers on strategy files, performance scripts, plan docs, review files, and cron/trading infrastructure."
---

# Kalshi Strategic Advisor

This skill turns Claude into the strategic brain for an autonomous prediction market trading system on Kalshi. It provides the full context, queries, benchmarks, and decision framework to evaluate the system and decide what to do next.

## When This Skill Applies

- Evaluating whether strategies are working
- Deciding what to change (parameters, enable/disable strategies, new strategies)
- Checking if the system is healthy and data is flowing
- Planning next development phases
- Reviewing P&L and trade outcomes
- Evaluating external data impact on trading performance
- Assessing live monitor / speed edge effectiveness
- Any "what should I do next" question about this project

## System Overview

The system has three layers of intelligence:

1. **Internal analysis** — 10 strategies scanning 43K+ Kalshi markets every 5 minutes
2. **External data** — 8 connectors pulling signals from Polymarket, PredictIt, ESPN, Odds API, FRED, CoinGecko, Open-Meteo, NWS every 15 minutes
3. **Live speed edge** — WebSocket streaming from Binance (crypto prices), ESPN (live scores), Kalshi (orderbook/trades) to detect stale markets in real-time

## Advisor Workflow

Work through these phases in order. Read `references/queries.md` for the full SQL query library. Use the Supabase MCP `execute_sql` tool for all queries (project ID: `mewhujreglvsqllupbjl`).

### Phase 1: System Health

Run the health queries from `references/queries.md` (cron status, data coverage, orderbook coverage, watchlist size, **external data freshness**, **alert system status**).

**Decision gate:** If any cron job hasn't run in 2+ hours (except weekly tune and daily trade history fetch), flag DEGRADED and investigate before continuing. Check GitHub Actions workflow runs if needed.

**New checks:**
- External data: Are all 8 connectors returning fresh signals?
- Alert system: Is the 5-min alert check cron running?
- Market mappings: Do we have Kalshi-to-external mappings for cross-market comparison?

### Phase 2: Performance Assessment

Run the performance queries (overall P&L, per-strategy breakdown, portfolio trend, recent learnings).

Assess each of the **10 strategies**:
- **KEEP** — Win rate > 55%, positive P&L, generating trades
- **TUNE** — Win rate 40-55%, or positive trades but suboptimal parameters
- **DISABLE** — Win rate < 40% over 20+ trades, or bleeding money
- **INVESTIGATE** — No trades in 7+ days despite being enabled (params too restrictive? no matching markets?)

Strategies: wide-spread, stale-price, extreme-value, mean-reversion, volume-spike, event-cluster, favorite-longshot, expiry-convergence, new-listing, liquidity-provision

Compare current metrics against go-live thresholds in `references/queries.md`.

### Phase 3: External Data Assessment

Run the external data queries from `references/queries.md`:
- Signal coverage by source and category
- Cross-market divergences (Kalshi vs Polymarket/PredictIt/sportsbooks)
- Alert effectiveness

**Key questions:**
- Are divergences translating into profitable trades?
- Which external sources have the best signal-to-noise ratio?
- Are there categories where external data gives us clear edge?
- Is the live monitor catching stale prices before the 5-min cron?

### Phase 4: Market Opportunity Scan

Run the market scan queries (expiring markets, price movers, wide spreads, open positions, category performance, **cross-market divergences**).

Look for:
- Open positions that have moved against us — prepare for potential losses?
- Categories consistently producing winners — focus strategies there?
- Market patterns the automated strategies are missing — new strategy ideas?
- Spreads or movers that suggest parameter tuning
- **Cross-market mispricings** — Kalshi vs external sources disagreeing by >5 cents

### Phase 5: Strategic Decisions

Produce this structured output:

```
### System Status: OK / DEGRADED / DOWN
One sentence covering core system + external data + alerts.

### Performance Scorecard
| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Resolved trades | ? | 200+ | |
| Win rate | ? | >55% | |
| Total P&L | ? | Positive | |
| Max losing strategy | ? | <$500 loss | |

### External Data Health
| Source | Signals (24h) | Last Fetch | Status |
|--------|--------------|------------|--------|
| Polymarket | ? | ? | |
| PredictIt | ? | ? | |
| ESPN | ? | ? | |
| Odds API | ? | ? | |
| FRED | ? | ? | |
| CoinGecko | ? | ? | |
| Open-Meteo | ? | ? | |
| NWS | ? | ? | |

### Per-Strategy Verdict
For each of 10: KEEP / TUNE / DISABLE / INVESTIGATE + reasoning.

### Top 3 Actions (ranked by impact)
Specific, actionable. Examples:
- "Widen extreme-value low_threshold from 8 to 10"
- "Create external_market_mappings for crypto markets to enable divergence-based trading"
- "Tune stale-price to use live monitor staleness data"

### External Data Opportunities
0-2 opportunities identified from cross-market divergences.

### Strategy Ideas
0-2 new concepts based on patterns in data or external signals.

### Next Check-In
Recommended interval based on trade velocity.
```

### Phase 6: Persist and Act

1. **Record learnings** — Insert key insights into `strategy_learnings` via SQL (types: `strategy_idea`, `category_insight`, `regime_change`, `failure_analysis`, `market_pattern`)
2. **Save review** — Write timestamped review to `docs/reviews/YYYY-MM-DD.md`
3. **Update plan** — If actions require code changes, update `docs/plan.md` backlog
4. **Parameter changes** — Provide exact SQL UPDATE statements and **ask before executing**
5. **Code changes** — If the session identifies bugs, missing features, or new strategies, proceed to implement after confirming with the user

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/strategies/engine.ts` | Strategy scanner, auto-trader, auto-watchlist |
| `src/lib/strategies/*.ts` | 10 individual strategy implementations |
| `src/lib/strategies/kalshi-math.ts` | Fee calculator, position sizing, EV |
| `src/lib/strategies/tuner.ts` | Auto-parameter tuning |
| `src/lib/external-data/aggregator.ts` | External signal fetching, storage, cross-market divergence detection |
| `src/lib/external-data/types.ts` | ExternalSignal, SignalSource, SignalType types |
| `src/lib/external-data/index.ts` | ALL_CONNECTORS / FREE_CONNECTORS registry |
| `src/lib/streaming/stale-detector.ts` | Live speed edge detection engine |
| `src/lib/streaming/binance-ws.ts` | Binance WebSocket for live crypto prices |
| `src/lib/streaming/espn-poller.ts` | ESPN live scores polling |
| `src/lib/streaming/kalshi-ws.ts` | Kalshi WebSocket for orderbook/trade updates |
| `src/lib/intelligence/context.ts` | Market context aggregation (includes external signals) |
| `src/scripts/live-monitor.ts` | CLI for real-time stale price detection |
| `src/scripts/fetch-external-data.ts` | CLI for external data fetch + divergence check |
| `docs/plan.md` | Implementation plan and backlog |
| `.github/workflows/crons.yml` | GitHub Actions cron schedules (10 jobs) |
| `CLAUDE.md` | Full project context and architecture |

## Database Tables

| Table | Key Data |
|-------|----------|
| `paper_trades` | All trades with P&L, fees, strategy_id |
| `strategies` | Enabled/disabled state, config params |
| `strategy_learnings` | Tuner changes, insights, ideas |
| `price_snapshots` | Price history for mean reversion |
| `orderbook_snapshots` | Bid/ask depth data |
| `portfolio_snapshots` | Portfolio value over time |
| `markets` | 43K+ synced markets with volume_24h, liquidity |
| `reviews` | Past review reports |
| `external_signals` | Signals from 8 external APIs (source, type, implied_probability) |
| `external_market_mappings` | Links Kalshi tickers to Polymarket/PredictIt/etc. market IDs |
| `market_trades` | Historical trade data from Kalshi API |
| `market_candles` | OHLCV candles for backtesting |
| `backtest_results` | Stored backtest configs and results |
| `prediction_calibration` | Calibration metrics per strategy |
