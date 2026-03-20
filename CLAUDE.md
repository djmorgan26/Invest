# Kalshi Investment Assistant

## North Star

Build an autonomous prediction market edge engine. Claude Code continuously scans 40,000+ Kalshi markets, detects mispricings before the crowd corrects them, and executes paper trades to prove the strategies work — so that when real capital goes in, the track record already exists.

**Three pillars:**

1. **Automated opportunity detection** — Don't browse markets manually. Run systematic screens for undervalued contracts: stale prices after news breaks, overreaction to headlines, implied probabilities that diverge from base rates, and thin markets where informed positioning pays.

2. **Market-making & structural edge** — Study how sophisticated participants profit: providing liquidity in wide-spread markets, arbitraging correlated contracts within the same event, and exploiting the mechanics of how Kalshi markets are created and priced. Replicate what works.

3. **Prove it on paper, then go live** — Every strategy runs in paper trading first. Track win rate, expected value, drawdown, and Sharpe ratio. Only graduate to real capital when the numbers are undeniable over hundreds of trades.

The goal is not to have opinions about markets. The goal is to have a system that reliably finds money.

---

## Project Overview
AI-powered prediction market analysis tool. Syncs Kalshi markets, tracks prices, generates predictions via Claude Code, and paper trades to validate strategy before risking real capital.

**Architecture:** Next.js dashboard + Supabase (DB/Auth) + Kalshi API + Claude Code (AI brain) + Autonomous Strategy Engine

## Quick Commands

| Task | Command |
|------|---------|
| Sync markets | `npx tsx src/scripts/sync-markets.ts` |
| Snapshot prices | `npx tsx src/scripts/snapshot-prices.ts` |
| Analyze markets | `npx tsx src/scripts/analyze-markets.ts` |
| Write prediction | `npx tsx src/scripts/write-prediction.ts --ticker X --side yes --confidence 0.7 --fair-value 0.6 --reasoning "..."` |
| Execute paper trade | `npx tsx src/scripts/execute-paper-trade.ts --ticker X --side yes --quantity 10` |
| Resolve trades | `npx tsx src/scripts/resolve-trades.ts` |
| **Run strategies** | `npx tsx src/scripts/run-strategies.ts` |
| **Review performance** | `npx tsx src/scripts/review-performance.ts` |

## Autonomous Operation

The system runs autonomously via Vercel Cron jobs:

| Job | Frequency | What it does |
|-----|-----------|--------------|
| Market sync | Every 6h | Sync all active markets from Kalshi API |
| Price snapshots | Every 5 min | Track prices for watchlisted markets |
| **Strategy scan** | Every 15 min | Run all enabled strategies, auto-trade opportunities |
| Trade resolution | Every 30 min | Check settlements, close trades, calculate P&L |
| **Portfolio snapshot** | Every 1h | Compute and store portfolio value |
| **Strategy tuning** | Weekly (Sun) | Auto-adjust strategy parameters based on results |

## Strategies

Four autonomous strategies scan for opportunities:

| Strategy | Logic | Key Params |
|----------|-------|------------|
| **Wide Spread** | Buy in markets with bid-ask spread > threshold | `min_spread`, `min_volume`, `max_days_to_close` |
| **Stale Price** | Detect markets that haven't repriced after sibling settlement | `max_hours_since_settlement` |
| **Extreme Value** | Buy near-certain outcomes priced < 5¢ or > 95¢ near expiry | `low_threshold`, `high_threshold`, `max_days_to_close` |
| **Mean Reversion** | Bet against sharp price moves > 15¢ in 24h | `min_move`, `lookback_hours`, `reversion_factor` |

### Strategy Engine Rules
- **Minimum edge:** $0.05 (fair value vs. market price)
- **Max position size:** 10% of portfolio per market
- **Max open per strategy:** 5 trades
- **Performance decay:** Auto-disables strategy if win rate drops below 40% over last 20 trades
- **Auto-tuning:** Weekly parameter adjustment based on trade outcomes (needs 30+ resolved trades)

### Learning Loop
The system improves over time through two mechanisms:

1. **Auto-tuner** (`/api/strategies/tune`): Analyzes resolved trades per strategy, adjusts config parameters (spread thresholds, volume filters, etc.), and logs changes to `strategy_learnings` table.

2. **Claude Code review sessions**: Run `npx tsx src/scripts/review-performance.ts` to get a comprehensive report. Claude reads the data and suggests:
   - New strategy ideas based on patterns
   - Parameter adjustments beyond auto-tuner capability
   - Markets/categories to focus on or avoid

## Trading Rules
- **Minimum edge:** $0.05 (fair value vs. market price)
- **Max position size:** 10% of portfolio per market
- **Prefer short-dated:** Markets closing within 7-14 days
- **Always paper trade first** — no live trading until strategy is validated
- **Log everything:** Every prediction and trade is stored for review

## Go-Live Thresholds

| Metric | Threshold |
|--------|-----------|
| Total resolved trades | 200+ |
| Overall win rate | > 55% |
| Total P&L | Positive |
| No single strategy losing | > $500 |
| Sharpe ratio | > 1.0 (annualized) |
| Max drawdown | < 15% of portfolio |
| Consistent over | 2+ weeks |

## Architecture
```
src/
  app/api/                    # Vercel Cron route handlers
    markets/sync/             # Sync all active markets + events
    prices/snapshot/          # Snapshot watchlist prices
    trades/resolve/           # Settle open paper trades
    strategies/scan/          # Run strategies + auto-trade (every 15 min)
    strategies/tune/          # Auto-tune parameters (weekly)
    portfolio/snapshot/       # Portfolio value tracking (hourly)
  lib/
    kalshi/client.ts          # Authenticated Kalshi API client
    kalshi/types.ts           # Kalshi response types
    strategies/               # Strategy engine
      types.ts                # Strategy, Opportunity interfaces
      engine.ts               # Scanner, auto-trader, decay detection
      tuner.ts                # Parameter optimization
      wide-spread.ts          # Wide spread strategy
      stale-price.ts          # Stale price strategy
      extreme-value.ts        # Extreme value strategy
      mean-reversion.ts       # Mean reversion strategy
    supabase/server.ts        # Supabase service-role client
    supabase/types.ts         # DB row types
  scripts/                    # CLI entry points
    run-strategies.ts         # Local strategy runner
    review-performance.ts     # Comprehensive report for Claude review
  app/dashboard/
    strategies/page.tsx       # Strategy performance + learnings view
supabase/migrations/
  001_initial_schema.sql      # Base tables
  002_strategies.sql          # Strategies + learnings tables
vercel.json                   # Cron schedule config
```

## Key Environment Variables
- `KALSHI_API_KEY_ID` / `KALSHI_API_KEY_ID_DEMO`
- `KALSHI_API_PRIVATE_KEY_PATH` / `KALSHI_API_PRIVATE_KEY_PATH_DEMO`
- `KALSHI_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

## DB Tables (10 total)
- `events` — Event catalog
- `markets` — Market data (43K+ synced)
- `price_snapshots` — Price history time series
- `predictions` — AI/strategy predictions (has `strategy_id`)
- `paper_trades` — Simulated trades (has `strategy_id`)
- `portfolio_snapshots` — Portfolio value over time
- `watchlist` — Tracked tickers
- `sync_log` — Operation history
- `strategies` — Strategy configs and enabled/disabled state
- `strategy_learnings` — Tuning audit trail
