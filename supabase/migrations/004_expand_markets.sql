-- Phase 4: Expand market data and add orderbook infrastructure

-- 1. Add volume_24h and liquidity columns to markets
ALTER TABLE markets ADD COLUMN IF NOT EXISTS volume_24h integer;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS liquidity numeric;

-- 2. Add fee column to paper_trades
ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS fee numeric DEFAULT 0;

-- 3. Create orderbook_snapshots table
CREATE TABLE IF NOT EXISTS orderbook_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text REFERENCES markets(ticker) NOT NULL,
  best_yes_bid integer,
  best_yes_ask integer,
  spread integer,
  depth_yes_bid jsonb,  -- top 5 levels: [{price, quantity}]
  depth_yes_ask jsonb,  -- top 5 levels: [{price, quantity}]
  snapshot_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orderbook_ticker_time ON orderbook_snapshots(ticker, snapshot_at DESC);
