# Kalshi Investment Assistant

AI-powered prediction market analysis and paper trading platform built on Next.js, Supabase, and the Kalshi API.

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
```

### 3. Run the database migration

Apply the schema to your Supabase project:

```bash
supabase db push
```

Or run `supabase/migrations/001_initial_schema.sql` directly in the Supabase SQL editor.

### 4. Start the development server

```bash
npm run dev
```

## Architecture

```
Next.js App Router (dashboard + API routes)
    |
    +-- GitHub Actions Cron --> /api/markets/sync       (sync markets every 6h)
    +-- GitHub Actions Cron --> /api/prices/snapshot    (snapshot prices every 5 min)
    +-- GitHub Actions Cron --> /api/trades/resolve     (settle trades every 30 min)
    +-- GitHub Actions Cron --> /api/strategies/scan    (strategy scan every 5 min)
    +-- GitHub Actions Cron --> /api/orderbook/snapshot (order book depth every 5 min)
    |
    +-- Supabase (PostgreSQL)
    |     events, markets, price_snapshots,
    |     predictions, paper_trades, watchlist
    |
    +-- Kalshi API (market data)
    |
    +-- Claude Code (AI analysis brain)
```

## Usage

### Sync markets
```bash
npx tsx scripts/sync-markets.ts
```

### Analyze a market
```bash
npx tsx scripts/analyze.ts TICKER-SYMBOL
```

### Paper trade
```bash
npx tsx scripts/paper-trade.ts TICKER-SYMBOL yes 10
```

### Check portfolio
```bash
npx tsx scripts/portfolio.ts
```

## Trading Rules

| Rule | Value |
|------|-------|
| Minimum edge | $0.05 |
| Max position | 10% of portfolio |
| Preferred expiry | < 7 days |
| Mode | Paper trading only (until validated) |

## License

Private — not for redistribution.
