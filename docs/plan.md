# Kalshi Investment Assistant — Plan

## Current Status
Phase 3 (Self-Optimizing Intelligence Layer) complete. Phase 2.5 (Kalshi-aware trading) implemented — all strategies now account for Kalshi's fee structure (quadratic taker fees), enforce entry price guardrails (8¢–85¢ safe zone), use liquidity-aware position sizing (max 2% of 24h volume), and validate positive expected value after fees before trading.

## Implementation Steps

### Phase 1: Foundation [COMPLETE]
- [x] Kalshi API client with RSA signing (`src/lib/kalshi/client.ts`)
- [x] Kalshi type definitions (`src/lib/kalshi/types.ts`)
- [x] Supabase server client (`src/lib/supabase/server.ts`)
- [x] Supabase database types (`src/lib/supabase/types.ts`)
- [x] Database schema migration (`supabase/migrations/001_initial_schema.sql`)
- [x] API route: market sync (`src/app/api/markets/sync/route.ts`)
- [x] API route: price snapshots (`src/app/api/prices/snapshot/route.ts`)
- [x] API route: trade resolution (`src/app/api/trades/resolve/route.ts`)
- [x] Vercel cron configuration (`vercel.json`)
- [x] Project CLAUDE.md
- [x] README with setup instructions

### Phase 2: Autonomous Strategy Engine [COMPLETE]
- [x] Strategy type definitions (`src/lib/strategies/types.ts`)
- [x] Strategy engine — scanner, auto-trader, decay detection (`src/lib/strategies/engine.ts`)
- [x] Wide-spread strategy (`src/lib/strategies/wide-spread.ts`)
- [x] Stale-price strategy (`src/lib/strategies/stale-price.ts`)
- [x] Extreme-value strategy (`src/lib/strategies/extreme-value.ts`)
- [x] Mean-reversion strategy (`src/lib/strategies/mean-reversion.ts`)
- [x] Auto-tuner (`src/lib/strategies/tuner.ts`)
- [x] Strategy database tables (`supabase/migrations/002_strategies.sql`)
- [x] Cron route: strategy scan (`src/app/api/strategies/scan/route.ts`)
- [x] Cron route: strategy tune (`src/app/api/strategies/tune/route.ts`)
- [x] Cron route: portfolio snapshot (`src/app/api/portfolio/snapshot/route.ts`)
- [x] CLI: run-strategies, review-performance scripts
- [x] Dashboard: strategies page
- [x] Dashboard: main dashboard, markets, predictions, trades pages

### Phase 3: Self-Optimizing Intelligence Layer [COMPLETE]
- [x] Claude Code custom commands (`.claude/commands/`)
  - [x] `/project:review` — Weekly performance review
  - [x] `/project:investigate-market` — Deep-dive market analysis
  - [x] `/project:new-strategy` — Strategy design + implementation
  - [x] `/project:market-scan` — Manual intelligent opportunity scan
  - [x] `/project:health-check` — System operational verification
- [x] Market context service (`src/lib/intelligence/context.ts`)
- [x] Category performance tracking (`src/lib/intelligence/categories.ts`)
- [x] Learning writer utility (`src/lib/intelligence/learnings.ts`)
- [x] Database migration: market_context + reviews tables (`supabase/migrations/003_intelligence.sql`)
- [x] Enhanced review-performance.ts (category breakdown, writes to reviews table)
- [x] Review report API route (`src/app/api/review/report/route.ts`)
- [x] Dashboard: Reviews & Learnings page (`src/app/dashboard/reviews/page.tsx`)
- [x] Sidebar: Reviews nav link
- [x] docs/plan.md and CLAUDE.md updates

### Phase 2.5: Kalshi-Aware Trading [COMPLETE]
- [x] Kalshi fee calculator (`src/lib/strategies/kalshi-math.ts`) — taker/maker fees, EV, position sizing
- [x] Entry price guardrails — reject 85¢+ entries (bad risk/reward), reject <8¢ (longshot bias)
- [x] Fee-aware edge threshold — minimum edge must clear Kalshi taker fees + 2¢ buffer
- [x] Liquidity-aware sizing — max 2% of 24h volume, scaled by edge magnitude
- [x] Expected value gate — every trade validated EV > 0 after fees before execution
- [x] Risk/reward ratio filter — minimum 0.20 ratio (risk $1 to make $0.20)
- [x] Realistic cost tracking — paper trades include taker fees in cost basis
- [x] Widened Extreme Value params (8¢/92¢, 7 days) — was 5¢/95¢, 3 days
- [x] Lowered Mean Reversion min_move (12¢ from 15¢) for more opportunities
- [x] Kalshi mechanics reference doc (`docs/kalshi-mechanics.md`)

### Phase 4: Data Collection & Strategy Validation [NEXT]
- [ ] Auto-watchlist all evaluated markets (unblocks Mean Reversion)
- [ ] Expand price snapshots to top 200 markets by volume
- [ ] Store order book depth (`orderbook_snapshots` table)
- [ ] Store `volume_24h` and `liquidity` in markets table
- [ ] Increase scan frequency to every 5 min
- [ ] Event cluster arbitrage strategy
- [ ] Volume spike detector strategy
- [ ] Per-trade fee tracking in paper trades
- [ ] Slippage estimation from order book depth
- [ ] Automated daily P&L dashboard

### Phase 5: Statistical Validation & Strategy Tuning [BACKLOG]
- [ ] Confidence intervals on win rate per strategy
- [ ] Per-strategy Sharpe ratio and profit factor
- [ ] Backtesting framework (historical replay through strategies)
- [ ] Walk-forward validation
- [ ] Maker order paper trading simulation
- [ ] Maker vs taker comparison analysis

### Phase 6: Pre-Live Hardening [BACKLOG]
- [ ] Kalshi production API order placement module
- [ ] Daily loss limit circuit breaker
- [ ] Correlation limit (max 3 per category)
- [ ] Drawdown circuit breaker (10% from peak → halt)
- [ ] Manual kill switch (dashboard + CLI)
- [ ] Position reconciliation (DB vs Kalshi)
- [ ] Alerting (trade, error, threshold)
- [ ] Tax tracking for realized trades
- [ ] Runbook document

### Phase 7: Graduated Live Trading [BACKLOG]
- [ ] Micro scale: $100, 1-3 contracts, 1 strategy, daily review
- [ ] Conservative scale: $250, 3-5 contracts, 2 strategies, maker orders
- [ ] Full scale: $500-1000, all strategies, automated reviews

> See [docs/roadmap.md](roadmap.md) for detailed phase descriptions, exit criteria, and the go-live decision checklist.

## Backlog
- Multi-model prediction ensemble
- Options-style Greeks for position management
- Mobile-friendly dashboard improvements
- Cross-event arbitrage strategy
- Kalshi Liquidity Incentive Program integration
- ECP status for higher position limits
