# Kalshi Investment Assistant

## Mission

Build an autonomous edge engine for prediction markets. The system continuously scans 40,000+ Kalshi markets, detects mispricings before the crowd corrects them, and executes paper trades to prove the strategies work — so that when real capital goes in, the track record already exists.

The goal is not to have opinions about markets. The goal is to have a system that reliably finds money.

## How It Works

**Ten autonomous strategies** run every 5 minutes, scanning for structural edges: wide bid-ask spreads, stale prices after news breaks, extreme-value contracts near expiry, mean-reversion after overreactions, volume spikes signaling informed flow, mispriced event clusters, favorite-longshot bias, expiry convergence plays, new listing inefficiencies, and liquidity provision opportunities.

**Eight external data connectors** enrich every decision with signals from outside Kalshi — cross-referencing prices against other prediction markets, pulling live sports scores and sportsbook odds, tracking economic indicators, monitoring crypto prices, and checking weather forecasts. When Kalshi's price diverges from what the rest of the world thinks, that's an opportunity.

**A live speed-edge monitor** streams real-time data via WebSocket from Binance (crypto prices), ESPN (live scores), and Kalshi (orderbook updates). When a real-world event happens and Kalshi hasn't repriced yet, the system detects the staleness window and alerts within seconds.

**Everything runs autonomously** via 10 GitHub Actions cron jobs — syncing markets, snapshotting prices and orderbooks, scanning strategies, resolving trades, tuning parameters, fetching external data, and checking for stale-price alerts. Claude Code acts as the AI brain, reviewing performance, backtesting against historical data, running parameter sweeps, and pushing the system toward go-live readiness.

## Data Sources

| Source | Type | What It Provides |
|--------|------|-----------------|
| **Kalshi API** | Primary | 40K+ markets, prices, orderbooks, trade history, settlements |
| **Polymarket** | Prediction market | Cross-market prices for politics, crypto, current events |
| **PredictIt** | Prediction market | Political contract prices for divergence detection |
| **ESPN** | Sports | Live scores, game status for NFL, NBA, MLB, NHL, MLS |
| **The Odds API** | Sports betting | Consensus odds from 40+ sportsbooks |
| **FRED** | Economics | 15 key series — CPI, GDP, unemployment, interest rates, housing |
| **CoinGecko** | Crypto | Top 10 crypto prices, 24h changes, Fear & Greed Index |
| **Open-Meteo** | Weather | 7-day forecasts for 10 major US cities |
| **NWS** | Weather | Official US weather forecasts (Kalshi settlement source) |
| **Binance WebSocket** | Live streaming | Real-time BTC, ETH, SOL, DOGE prices for speed edge |

## Strategies

| Strategy | Edge |
|----------|------|
| **Wide Spread** | Capture value in markets with large bid-ask gaps |
| **Stale Price** | Trade markets that haven't repriced after related events settle |
| **Extreme Value** | Buy near-certain outcomes still mispriced near expiry |
| **Mean Reversion** | Fade sharp price moves that overshoot fair value |
| **Volume Spike** | Ride momentum when informed flow hits thin markets |
| **Event Cluster Arb** | Exploit mutually exclusive markets whose YES prices don't sum to 100 |
| **Favorite-Longshot** | Sell overpriced longshots, buy underpriced favorites |
| **Expiry Convergence** | Snipe markets near close still priced far from settlement |
| **New Listing** | Trade newly listed markets with naive initial pricing |
| **Liquidity Provision** | Earn spread in stable, wide-spread markets using orderbook depth |

## Go-Live Thresholds

The system stays in paper trading until these benchmarks are met:

| Metric | Target |
|--------|--------|
| Resolved trades | 200+ |
| Win rate | > 55% |
| Total P&L | Positive |
| Max strategy loss | < $500 |
| Sharpe ratio | > 1.0 |
| Max drawdown | < 15% |
| Consistency | 2+ weeks |

---

## Prerequisites

- Node.js 18+
- Supabase project (free tier works)
- Kalshi API key pair (demo or production)
- GitHub repository (for Actions cron scheduling)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in:

```env
# Kalshi API (demo)
KALSHI_API_KEY_ID_DEMO=your_demo_key_id
KALSHI_API_PRIVATE_KEY_PATH_DEMO=./kalshi/private_key_demo.pem
KALSHI_API_BASE_URL=https://demo-api.kalshi.co/trade-api/v2

# Kalshi API (production — optional)
KALSHI_API_KEY_ID=your_prod_key_id
KALSHI_API_PRIVATE_KEY_PATH=./kalshi/private_key.pem

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Cron (used by GitHub Actions to authenticate API calls)
CRON_SECRET=your_random_secret

# Optional — external data enrichment
ODDS_API_KEY=your_odds_api_key        # 500 req/month free
FRED_API_KEY=your_fred_api_key        # Free, 120 req/min

# Optional — email alerts
RESEND_API_KEY=your_resend_key        # 100 emails/day free
RESEND_FROM_EMAIL=alerts@yourdomain.com
ALERT_EMAIL=you@email.com
```

### 3. Run the database migration

```bash
supabase db push
```

### 4. Start the development server

```bash
npm run dev
```

## Architecture

```
Next.js App Router (dashboard + API routes)
    |
    +-- 10 GitHub Actions Cron Jobs
    |     /api/markets/sync              (every 6h)
    |     /api/prices/snapshot           (every 5 min)
    |     /api/strategies/scan           (every 5 min)
    |     /api/orderbook/snapshot        (every 5 min)
    |     /api/external-data/fetch       (every 15 min)
    |     /api/alerts/check              (every 5 min)
    |     /api/trades/resolve            (every 30 min)
    |     /api/portfolio/snapshot        (every 1h)
    |     /api/trades/fetch-history      (daily 2am)
    |     /api/strategies/tune           (weekly Sun)
    |
    +-- Supabase (PostgreSQL — 19 tables)
    |     markets, events, price_snapshots, orderbook_snapshots,
    |     paper_trades, predictions, strategies, strategy_learnings,
    |     portfolio_snapshots, watchlist, sync_log, reviews,
    |     market_trades, market_candles, backtest_results,
    |     prediction_calibration, external_signals,
    |     external_market_mappings, market_context
    |
    +-- Kalshi API (market data + trade execution)
    |
    +-- 8 External Data Connectors
    |     Polymarket, PredictIt, ESPN, Odds API,
    |     FRED, CoinGecko, Open-Meteo, NWS
    |
    +-- Live WebSocket Streaming
    |     Binance (crypto), ESPN (scores), Kalshi (orderbook)
    |     --> Stale price detection + email alerts
    |
    +-- Claude Code (AI optimization brain)
          Backtesting, parameter sweeps, calibration,
          strategy verdicts, autonomous improvement loop
```

## Quick Commands

```bash
# Core operations
npx tsx src/scripts/run-strategies.ts              # Dry-run all strategies
npx tsx src/scripts/review-performance.ts          # Full performance report

# Backtesting
npx tsx src/scripts/fetch-historical-trades.ts --max=200
npx tsx src/scripts/backtest-historical.ts --strategy all --period 3m
npx tsx src/scripts/backtest-historical.ts --strategy wide-spread --sweep

# External data
npx tsx src/scripts/fetch-external-data.ts         # Fetch all signals
npx tsx src/scripts/fetch-external-data.ts --divergences  # Cross-market gaps

# Live monitoring
npx tsx src/scripts/live-monitor.ts                # All markets
npx tsx src/scripts/live-monitor.ts --sports-only  # Sports only
npx tsx src/scripts/live-monitor.ts --crypto-only  # Crypto only

# Safety
npx tsx src/scripts/kill-switch.ts status          # Check circuit breakers
npx tsx src/scripts/kill-switch.ts on "reason"     # Emergency stop
```

## License

Personal project — source shared publicly for portfolio and review. Not licensed for redistribution or commercial use.
