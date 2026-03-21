-- Historical backtesting infrastructure: trade history, candles, backtest results, calibration

-- Store individual trades from Kalshi API for historical analysis
CREATE TABLE IF NOT EXISTS market_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  trade_id text NOT NULL UNIQUE,
  count integer NOT NULL,
  yes_price integer NOT NULL,
  no_price integer NOT NULL,
  taker_side text NOT NULL,
  created_time timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_trades_ticker_time ON market_trades (ticker, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_market_trades_created_time ON market_trades (created_time);

-- Reconstructed OHLCV candles for backtesting
CREATE TABLE IF NOT EXISTS market_candles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  interval text NOT NULL,
  open_price integer NOT NULL,
  high_price integer NOT NULL,
  low_price integer NOT NULL,
  close_price integer NOT NULL,
  volume integer NOT NULL,
  vwap integer,
  trade_count integer,
  bucket_start timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(ticker, interval, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_candles_ticker_interval ON market_candles (ticker, interval, bucket_start DESC);

-- Backtest results
CREATE TABLE IF NOT EXISTS backtest_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id text NOT NULL,
  config jsonb NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  total_trades integer NOT NULL,
  wins integer NOT NULL,
  losses integer NOT NULL,
  win_rate numeric NOT NULL,
  total_pnl numeric NOT NULL,
  sharpe_ratio numeric,
  max_drawdown numeric,
  max_drawdown_pct numeric,
  avg_edge numeric,
  avg_pnl_per_trade numeric,
  by_category jsonb,
  trade_log jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backtest_strategy ON backtest_results (strategy_id, created_at DESC);

-- Prediction calibration tracking
CREATE TABLE IF NOT EXISTS prediction_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id text NOT NULL,
  confidence_bucket numeric NOT NULL,
  total_predictions integer NOT NULL,
  correct_predictions integer NOT NULL,
  actual_rate numeric NOT NULL,
  brier_score numeric,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calibration_strategy ON prediction_calibration (strategy_id, created_at DESC);
