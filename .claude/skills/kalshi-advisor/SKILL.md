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
- Any "what should I do next" question about this project

## Advisor Workflow

Work through these phases in order. Read `references/queries.md` for the full SQL query library. Use the Supabase MCP `execute_sql` tool for all queries (project ID: `mewhujreglvsqllupbjl`).

### Phase 1: System Health

Run the health queries from `references/queries.md` (cron status, data coverage, orderbook coverage, watchlist size).

**Decision gate:** If any cron job hasn't run in 2+ hours (except weekly tune), flag DEGRADED and investigate before continuing. Check GitHub Actions workflow runs if needed.

### Phase 2: Performance Assessment

Run the performance queries (overall P&L, per-strategy breakdown, portfolio trend, recent learnings).

Assess each strategy:
- **KEEP** — Win rate > 55%, positive P&L, generating trades
- **TUNE** — Win rate 40-55%, or positive trades but suboptimal parameters
- **DISABLE** — Win rate < 40% over 20+ trades, or bleeding money
- **INVESTIGATE** — No trades in 7+ days despite being enabled (params too restrictive? no matching markets?)

Compare current metrics against go-live thresholds in `references/queries.md`.

### Phase 3: Market Opportunity Scan

Run the market scan queries (expiring markets, price movers, wide spreads, open positions, category performance).

Look for:
- Open positions that have moved against us — prepare for potential losses?
- Categories consistently producing winners — focus strategies there?
- Market patterns the automated strategies are missing — new strategy ideas?
- Spreads or movers that suggest parameter tuning

### Phase 4: Strategic Decisions

Produce this structured output:

```
### System Status: OK / DEGRADED / DOWN
One sentence.

### Performance Scorecard
| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Resolved trades | ? | 200+ | |
| Win rate | ? | >55% | |
| Total P&L | ? | Positive | |
| Max losing strategy | ? | <$500 loss | |

### Per-Strategy Verdict
For each: KEEP / TUNE / DISABLE / INVESTIGATE + reasoning.

### Top 3 Actions (ranked by impact)
Specific, actionable. Examples:
- "Widen extreme-value low_threshold from 8 to 10"
- "Disable mean-reversion until 500+ snapshots accumulated"
- "Add volume_24h filter to wide-spread: require > 50"

### Strategy Ideas
0-2 new concepts based on patterns in the data.

### Next Check-In
Recommended interval based on trade velocity.
```

### Phase 5: Persist and Act

1. **Record learnings** — Insert key insights into `strategy_learnings` via SQL (types: `strategy_idea`, `category_insight`, `regime_change`, `failure_analysis`, `market_pattern`)
2. **Save review** — Write timestamped review to `docs/reviews/YYYY-MM-DD.md`
3. **Update plan** — If actions require code changes, update `docs/plan.md` backlog
4. **Parameter changes** — Provide exact SQL UPDATE statements and **ask before executing**
5. **Code changes** — If the session identifies bugs, missing features, or new strategies, proceed to implement after confirming with the user

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/strategies/engine.ts` | Strategy scanner, auto-trader, auto-watchlist |
| `src/lib/strategies/*.ts` | Individual strategy implementations |
| `src/lib/strategies/kalshi-math.ts` | Fee calculator, position sizing, EV |
| `src/lib/strategies/tuner.ts` | Auto-parameter tuning |
| `docs/plan.md` | Implementation plan and backlog |
| `docs/kalshi-mechanics.md` | Kalshi fee structure and market mechanics |
| `.github/workflows/crons.yml` | GitHub Actions cron schedules |
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
| `markets` | 56K+ synced markets with volume_24h, liquidity |
| `reviews` | Past review reports |
