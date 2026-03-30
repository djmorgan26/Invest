-- Alert deduplication history
-- Tracks which alerts have been sent to prevent spam
CREATE TABLE IF NOT EXISTS alert_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker text NOT NULL,
  category text NOT NULL DEFAULT '',
  edge_cents integer NOT NULL DEFAULT 0,
  side text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_history_ticker_sent
  ON alert_history (ticker, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_history_sent
  ON alert_history (sent_at DESC);
