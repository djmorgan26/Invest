# Kalshi Investment Assistant — Plan

## Current Status
Phase 3 (Self-Optimizing Intelligence Layer) implementation in progress. Phase 1 & 2 complete — autonomous strategy engine is live with 4 strategies scanning every 15 min.

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

### Phase 3: Self-Optimizing Intelligence Layer [IN PROGRESS]
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

### Phase 4: Advanced Intelligence [BACKLOG]
- [ ] News-enriched scanning (`src/lib/intelligence/news.ts`)
- [ ] Market context auto-population via web search
- [ ] Strategy correlation analysis (do strategies agree or conflict?)
- [ ] Market regime detection (high-volume vs. low-activity periods)
- [ ] Automated weekly review via cron (generates + stores review)

### Phase 5: Go-Live Preparation [BACKLOG]
- [ ] Reach 200+ resolved trades
- [ ] Validate all go-live thresholds met
- [ ] Live trading integration with Kalshi production API
- [ ] Risk management circuit breakers
- [ ] Real-time alerting on anomalies

## Backlog
- Multi-model prediction ensemble
- Options-style Greeks for position management
- Mobile-friendly dashboard improvements
- Strategy backtesting framework using historical snapshots
- Cross-event arbitrage strategy
