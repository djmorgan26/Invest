# Kalshi Investment Assistant — Plan

## Current Status
Building core infrastructure: API routes, database schema, and project documentation.

## Implementation Steps

### Phase 1: Foundation
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

### Phase 2: CLI Scripts
- [ ] `scripts/sync-markets.ts` — CLI wrapper for market sync
- [ ] `scripts/snapshot-prices.ts` — CLI wrapper for price snapshots
- [ ] `scripts/analyze.ts` — Market analysis with Claude
- [ ] `scripts/paper-trade.ts` — Place paper trades
- [ ] `scripts/resolve-trades.ts` — CLI wrapper for trade resolution
- [ ] `scripts/portfolio.ts` — Portfolio summary

### Phase 3: Analysis Engine
- [ ] Market screening logic (volume, expiry, catalyst filters)
- [ ] Claude-powered fair value estimation
- [ ] Edge calculation and trade recommendation
- [ ] Prediction tracking and accuracy metrics

### Phase 4: Dashboard
- [ ] Markets overview page
- [ ] Watchlist management UI
- [ ] Price chart components (price_snapshots visualization)
- [ ] Portfolio and P&L dashboard
- [ ] Prediction leaderboard / accuracy tracker

### Phase 5: Automation & Optimization
- [ ] Automated screening cron job
- [ ] Alert system for high-edge opportunities
- [ ] Strategy backtesting using historical snapshots
- [ ] Performance analytics and reporting

## Backlog
- Live trading integration (after paper trading validation)
- Multi-model prediction ensemble
- News/social sentiment integration
- Options-style Greeks for position management
- Mobile-friendly dashboard
