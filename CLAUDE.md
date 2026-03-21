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

**Architecture:** Next.js dashboard + Supabase (DB/Auth) + Kalshi API + Claude Code (AI brain) + Autonomous Strategy Engine + Intelligence Layer

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
| **Fetch trade history** | `npx tsx src/scripts/fetch-historical-trades.ts --max=200` |
| **Backtest strategies** | `npx tsx src/scripts/backtest-historical.ts --strategy all --period 3m` |
| **Parameter sweep** | `npx tsx src/scripts/backtest-historical.ts --strategy wide-spread --sweep` |

## Claude Code Slash Commands

Use these for structured analysis sessions:

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/project:review` | Performance review with recommendations | When you only need the P&L report |
| `/project:investigate-market` | Deep-dive into a specific market/event | When a market looks interesting or suspicious |
| `/project:new-strategy` | Design and implement a new strategy | When patterns suggest a new approach |
| `/project:market-scan` | Manual intelligent scan for opportunities | When looking beyond what automation finds |
| `/project:health-check` | System operational verification | When something seems off, or weekly check |
| `/project:optimize` | **Autonomous strategy optimizer** | When you want AI to backtest, sweep, calibrate, and improve everything |

**Skill: `kalshi-advisor`** — The primary check-in tool. Auto-triggers when working with strategy files, plan docs, or review files. Runs a full strategic advisor session: health check, performance review, market scan, strategic decisions, and persists learnings. Use this every 2-3 days during data collection phase.

**Skill: `strategy-optimizer`** — The autonomous optimization engine. This is the AI brain that decides what to do: fetch historical data, backtest strategies against real settled markets, run parameter sweeps, measure prediction calibration, and push the system toward go-live readiness. Invoke with `/project:optimize` or it auto-triggers on backtest/optimization discussions.

## Autonomous Operation

The system runs autonomously via GitHub Actions cron jobs (`.github/workflows/crons.yml`):

| Job | Frequency | What it does |
|-----|-----------|--------------|
| Market sync | Every 6h | Sync all active markets from Kalshi API |
| Price snapshots | Every 5 min | Track prices for watchlisted + top 200 volume markets |
| **Strategy scan** | Every 5 min | Run all enabled strategies, auto-trade opportunities |
| Trade resolution | Every 30 min | Check settlements, close trades, calculate P&L |
| **Portfolio snapshot** | Every 1h | Compute and store portfolio value |
| **Strategy tuning** | Weekly (Sun) | Auto-adjust strategy parameters based on results |
| **Orderbook snapshot** | Every 5 min | Capture order book depth for watchlisted tickers |
| **Trade history fetch** | Daily (2am) | Fetch trade history for settled markets for backtesting |

## Strategies

Ten autonomous strategies scan for opportunities:

| Strategy | Logic | Key Params |
|----------|-------|------------|
| **Wide Spread** | Buy in markets with bid-ask spread > threshold | `min_spread`, `min_volume`, `max_days_to_close` |
| **Stale Price** | Detect markets that haven't repriced after sibling settlement | `max_hours_since_settlement` |
| **Extreme Value** | Buy near-certain outcomes priced < 8¢ or > 92¢ near expiry | `low_threshold`, `high_threshold`, `max_days_to_close` |
| **Mean Reversion** | Bet against sharp price moves > 12¢ in 24h | `min_move`, `lookback_hours`, `reversion_factor` |
| **Volume Spike** | Momentum continuation on 3x volume spikes with price moves | `volume_multiplier`, `min_price_move`, `momentum_factor` |
| **Event Cluster Arb** | Exploit mutually exclusive markets where YES prices ≠ 100¢ | `min_mispricing`, `max_markets_per_event` |
| **Favorite-Longshot** | Sell overpriced longshots (5-15¢), buy underpriced favorites (85-95¢) | `longshot_overpricing`, `favorite_underpricing` |
| **Expiry Convergence** | Snipe markets <48h from close still priced 25-75¢ with momentum | `max_hours_to_close`, `min_momentum` |
| **New Listing Edge** | Trade newly listed markets (<24h) with naive pricing | `max_hours_since_listing`, `min_spread` |
| **Liquidity Provision** | Capture spread in stable wide-spread markets using orderbook depth | `min_spread`, `max_price_volatility`, `min_depth_ratio` |

### Strategy Engine Rules
- **Minimum edge:** $0.05 (fair value vs. market price)
- **Max position size:** 10% of portfolio per market
- **Max open per strategy:** 5 trades
- **Performance decay:** Auto-disables strategy if win rate drops below 40% over last 20 trades
- **Auto-tuning:** Weekly parameter adjustment based on trade outcomes (needs 30+ resolved trades)

### Learning Loop
The system improves over time through three mechanisms:

1. **Auto-tuner** (`/api/strategies/tune`): Analyzes resolved trades per strategy, adjusts config parameters (spread thresholds, volume filters, etc.), and logs changes to `strategy_learnings` table.

2. **Claude Code review sessions**: Run `/project:review` to get a comprehensive report. Claude reads the data and suggests:
   - New strategy ideas based on patterns
   - Parameter adjustments beyond auto-tuner capability
   - Markets/categories to focus on or avoid

3. **Persistent learnings**: Insights are recorded to `strategy_learnings` with typed categories, creating a compounding knowledge base across sessions.

## Intelligence Layer

### Market Context (`src/lib/intelligence/context.ts`)
Aggregates everything known about a market into one object:
- Market data + event info + category
- 24h price history from snapshots
- Sibling markets in same event
- Open trades and recent predictions
- Derived: days to close, spread size

### Category Performance (`src/lib/intelligence/categories.ts`)
Tracks which Kalshi categories (politics, crypto, weather, etc.) produce the best trades. Feeds into strategy scanning to focus on high-performing areas.

### Learning Types (`src/lib/intelligence/learnings.ts`)
Records structured insights to `strategy_learnings`:
- `param_change` — Threshold adjustments from tuner
- `category_insight` — "Wide-spread works best in sports markets"
- `regime_change` — "Volume dropped 40% this week"
- `strategy_idea` — Ideas for future strategies from review sessions
- `market_pattern` — Recurring market behaviors
- `failure_analysis` — Post-mortem on bad trades

### Reviews (`src/app/api/review/report/route.ts`)
API endpoint returning comprehensive JSON report. Also stored in `reviews` table with recommendations and metrics snapshot.

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

## Historical Backtesting

The system can backtest strategies against real historical data from settled markets.

### How It Works
1. **Fetch trade history**: `fetch-historical-trades.ts` pulls individual trades from the Kalshi API for settled markets and stores them in `market_trades` + builds OHLCV candles in `market_candles`
2. **Reconstruct market state**: `snapshot-reconstructor.ts` rebuilds what a market looked like at any historical point in time using trade data — producing `Market` objects our strategies can consume
3. **Run strategies**: The backtester calls `strategy.scan()` with reconstructed market snapshots at multiple time points before settlement, then checks if the predicted side matched the actual result
4. **Measure performance**: Computes win rate, PnL, Sharpe ratio, max drawdown, profit factor — all with realistic fee modeling

### Backtest Commands
```bash
# Fetch historical trade data (run first, builds up over time)
npx tsx src/scripts/fetch-historical-trades.ts --max=200 --min-volume=100

# Backtest all strategies over last 3 months
npx tsx src/scripts/backtest-historical.ts --strategy all --period 3m

# Backtest specific strategy with verbose trade log
npx tsx src/scripts/backtest-historical.ts --strategy wide-spread --period 6m --verbose

# Parameter sweep to find optimal config
npx tsx src/scripts/backtest-historical.ts --strategy mean-reversion --sweep

# Backtest specific category only
npx tsx src/scripts/backtest-historical.ts --strategy all --period 3m --category politics
```

### Key Files
- `src/lib/backtesting/engine.ts` — Core backtest engine
- `src/lib/backtesting/snapshot-reconstructor.ts` — Market state reconstruction
- `src/lib/backtesting/param-sweep.ts` — Parameter optimization
- `src/lib/backtesting/calibration.ts` — Prediction accuracy measurement
- `src/scripts/fetch-historical-trades.ts` — Historical data collection
- `src/scripts/backtest-historical.ts` — CLI runner

### DB Tables (4 new)
- `market_trades` — Individual trade history from Kalshi API
- `market_candles` — OHLCV candles built from trade history
- `backtest_results` — Stored backtest results with configs
- `prediction_calibration` — Calibration metrics per strategy

## Architecture
```
src/
  app/api/                    # Cron route handlers (called by GitHub Actions)
    markets/sync/             # Sync all active markets + events
    prices/snapshot/          # Snapshot watchlist + top 200 volume markets
    trades/resolve/           # Settle open paper trades
    trades/fetch-history/     # Fetch historical trade data (daily)
    strategies/scan/          # Run strategies + auto-trade (every 5 min)
    strategies/tune/          # Auto-tune parameters (weekly)
    portfolio/snapshot/       # Portfolio value tracking (hourly)
    orderbook/snapshot/       # Order book depth snapshots
    review/report/            # Review report JSON API
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
    backtesting/              # Historical backtesting engine
      engine.ts               # Core backtest runner
      snapshot-reconstructor.ts # Rebuild market state from trades
      param-sweep.ts          # Parameter grid optimization
      calibration.ts          # Prediction accuracy analysis
      index.ts                # Module exports
    intelligence/             # Self-optimizing intelligence layer
      context.ts              # Market data aggregation
      categories.ts           # Category performance tracking
      learnings.ts            # Persistent learning writer
    supabase/server.ts        # Supabase service-role client
    supabase/types.ts         # DB row types
  scripts/                    # CLI entry points
    run-strategies.ts         # Local strategy runner
    review-performance.ts     # Comprehensive report (writes to reviews table)
    fetch-historical-trades.ts # Fetch + store trade history from Kalshi
    backtest-historical.ts    # Run backtests / parameter sweeps
  app/dashboard/
    strategies/page.tsx       # Strategy performance + learnings view
    reviews/page.tsx          # Reviews & learnings history
  components/layout/
    sidebar.tsx               # Navigation (includes Reviews link)
supabase/migrations/
  001_initial_schema.sql      # Base tables
  002_strategies.sql          # Strategies + learnings tables
  003_intelligence.sql        # Market context + reviews tables
  004_expand_markets.sql      # volume_24h, liquidity, fee, orderbook_snapshots
.claude/commands/             # Claude Code slash commands
  review.md                   # /project:review
  investigate-market.md       # /project:investigate-market
  new-strategy.md             # /project:new-strategy
  market-scan.md              # /project:market-scan
  health-check.md             # /project:health-check
docs/
  plan.md                     # Implementation plan + backlog
  reviews/                    # Timestamped review files
.github/workflows/crons.yml  # GitHub Actions cron schedules
```

## Key Environment Variables
- `KALSHI_API_KEY_ID` / `KALSHI_API_KEY_ID_DEMO`
- `KALSHI_API_PRIVATE_KEY_PATH` / `KALSHI_API_PRIVATE_KEY_PATH_DEMO`
- `KALSHI_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

## DB Tables (17 total)
- `events` — Event catalog
- `markets` — Market data (43K+ synced)
- `price_snapshots` — Price history time series
- `predictions` — AI/strategy predictions (has `strategy_id`)
- `paper_trades` — Simulated trades (has `strategy_id`)
- `portfolio_snapshots` — Portfolio value over time
- `watchlist` — Tracked tickers
- `sync_log` — Operation history
- `strategies` — Strategy configs and enabled/disabled state
- `strategy_learnings` — Tuning audit trail + persistent insights
- `market_context` — News, sentiment, catalysts cache
- `reviews` — Structured review reports with recommendations
- `orderbook_snapshots` — Order book depth history (bid/ask levels)
- `market_trades` — Individual trade history from Kalshi API
- `market_candles` — OHLCV candles built from trade data
- `backtest_results` — Stored backtest results with strategy configs
- `prediction_calibration` — Prediction accuracy metrics per strategy
