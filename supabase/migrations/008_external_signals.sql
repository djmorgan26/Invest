-- External data signals from third-party APIs (prediction markets, sports odds, weather, economics, crypto)

CREATE TABLE IF NOT EXISTS external_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,           -- 'polymarket', 'predictit', 'odds_api', 'fred', 'espn', 'coingecko', 'open_meteo', 'nws'
  signal_type text NOT NULL,      -- 'price', 'odds', 'forecast', 'economic_indicator', 'score', 'sentiment'
  external_id text,               -- ID in the external system (e.g., Polymarket condition_id)
  ticker text,                    -- Kalshi ticker this maps to (nullable for unmatched signals)
  category text,                  -- Category for grouping: 'politics', 'crypto', 'sports', 'weather', 'economics'
  title text NOT NULL,            -- Human-readable description
  data jsonb NOT NULL DEFAULT '{}', -- Flexible payload (prices, odds, forecasts, etc.)
  implied_probability numeric,    -- Derived implied probability (0-1) if applicable
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,         -- When this signal becomes stale
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_signals_source ON external_signals (source, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_signals_ticker ON external_signals (ticker, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_signals_category ON external_signals (category, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_signals_type ON external_signals (signal_type, source);

-- Mapping table to link Kalshi tickers to external market IDs
CREATE TABLE IF NOT EXISTS external_market_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kalshi_ticker text NOT NULL,
  source text NOT NULL,           -- 'polymarket', 'predictit', 'odds_api', etc.
  external_id text NOT NULL,      -- ID in the external system
  external_title text,
  match_confidence numeric DEFAULT 1.0, -- How confident we are in the mapping (0-1)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(kalshi_ticker, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ext_mappings_kalshi ON external_market_mappings (kalshi_ticker);
CREATE INDEX IF NOT EXISTS idx_ext_mappings_source ON external_market_mappings (source, external_id);

-- Enable RLS
ALTER TABLE external_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_market_mappings ENABLE ROW LEVEL SECURITY;

-- Policies: anon can read, service role can do everything
CREATE POLICY "anon_read_signals" ON external_signals FOR SELECT TO anon USING (true);
CREATE POLICY "service_role_all_signals" ON external_signals FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_mappings" ON external_market_mappings FOR SELECT TO anon USING (true);
CREATE POLICY "service_role_all_mappings" ON external_market_mappings FOR ALL TO service_role USING (true) WITH CHECK (true);
