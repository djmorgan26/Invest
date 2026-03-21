# Strategy Optimizer — SQL Query Reference

All queries run against Supabase MCP `execute_sql` (project ID: `mewhujreglvsqllupbjl`).

## Historical Data Coverage

### Trade History Coverage
```sql
SELECT COUNT(DISTINCT ticker) as markets_with_trades,
       COUNT(*) as total_trades,
       MIN(created_time) as earliest_trade,
       MAX(created_time) as latest_trade
FROM market_trades;
```

### Candle Coverage
```sql
SELECT interval, COUNT(DISTINCT ticker) as tickers, COUNT(*) as candles,
       MIN(bucket_start) as earliest, MAX(bucket_start) as latest
FROM market_candles
GROUP BY interval
ORDER BY interval;
```

### Settled Markets Without Trade History (candidates for fetching)
```sql
SELECT COUNT(*) as unfetched_markets
FROM markets m
WHERE m.result IS NOT NULL
  AND m.volume >= 100
  AND NOT EXISTS (SELECT 1 FROM market_trades mt WHERE mt.ticker = m.ticker);
```

### Top Settled Markets to Fetch
```sql
SELECT m.ticker, m.title, m.volume, m.result, m.close_time, e.category
FROM markets m
LEFT JOIN events e ON m.event_ticker = e.event_ticker
WHERE m.result IS NOT NULL
  AND m.volume >= 100
  AND NOT EXISTS (SELECT 1 FROM market_trades mt WHERE mt.ticker = m.ticker)
ORDER BY m.volume DESC
LIMIT 30;
```

---

## Backtest Results

### Latest Backtest Results Per Strategy
```sql
SELECT DISTINCT ON (strategy_id)
  strategy_id, config, total_trades, wins, losses,
  ROUND(win_rate::numeric, 3) as win_rate,
  ROUND(total_pnl::numeric, 2) as total_pnl,
  ROUND(sharpe_ratio::numeric, 2) as sharpe,
  ROUND(max_drawdown_pct::numeric, 1) as max_dd_pct,
  ROUND(avg_edge::numeric, 4) as avg_edge,
  created_at
FROM backtest_results
ORDER BY strategy_id, created_at DESC;
```

### Backtest History (trend)
```sql
SELECT strategy_id, total_trades, win_rate, total_pnl, sharpe_ratio, created_at
FROM backtest_results
ORDER BY created_at DESC
LIMIT 30;
```

### Best Backtest Config Per Strategy
```sql
SELECT DISTINCT ON (strategy_id)
  strategy_id, config, win_rate, total_pnl, sharpe_ratio
FROM backtest_results
WHERE total_trades >= 20
ORDER BY strategy_id, sharpe_ratio DESC NULLS LAST;
```

---

## Prediction Calibration

### Calibration by Strategy and Bucket
```sql
SELECT strategy_id, confidence_bucket,
       total_predictions, correct_predictions,
       ROUND(actual_rate::numeric, 3) as actual_rate,
       ROUND(brier_score::numeric, 4) as brier,
       ROUND(confidence_bucket - actual_rate, 3) as bias
FROM prediction_calibration
ORDER BY strategy_id, confidence_bucket;
```

### Overall Calibration Per Strategy
```sql
SELECT strategy_id,
       SUM(total_predictions) as total,
       ROUND(SUM(correct_predictions)::numeric / NULLIF(SUM(total_predictions), 0), 3) as overall_accuracy,
       ROUND(AVG(brier_score)::numeric, 4) as avg_brier,
       ROUND(AVG(confidence_bucket - actual_rate)::numeric, 3) as avg_bias
FROM prediction_calibration
GROUP BY strategy_id
ORDER BY avg_brier;
```

---

## Live Performance

### Overall P&L
```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'closed') as resolved,
  COUNT(*) FILTER (WHERE status = 'open') as open,
  SUM(pnl) FILTER (WHERE status = 'closed') as total_pnl,
  SUM(cost) FILTER (WHERE status = 'open') as capital_deployed,
  COUNT(*) FILTER (WHERE status = 'closed' AND pnl > 0) as wins,
  COUNT(*) FILTER (WHERE status = 'closed' AND pnl <= 0) as losses
FROM paper_trades;
```

### Per-Strategy Live Performance
```sql
SELECT s.id, s.name, s.enabled, s.config,
       COUNT(pt.id) FILTER (WHERE pt.status = 'closed') as resolved,
       COUNT(pt.id) FILTER (WHERE pt.status = 'open') as open,
       SUM(pt.pnl) FILTER (WHERE pt.status = 'closed') as pnl,
       ROUND(100.0 * COUNT(*) FILTER (WHERE pt.pnl > 0) / NULLIF(COUNT(*) FILTER (WHERE pt.status = 'closed'), 0), 1) as win_pct,
       MAX(pt.created_at) as last_trade
FROM strategies s
LEFT JOIN paper_trades pt ON s.id = pt.strategy_id
GROUP BY s.id, s.name, s.enabled, s.config
ORDER BY pnl DESC NULLS LAST;
```

### Category Performance (Live Trades)
```sql
SELECT e.category,
       COUNT(pt.id) as trades,
       SUM(pt.pnl) FILTER (WHERE pt.status = 'closed') as pnl,
       ROUND(100.0 * COUNT(*) FILTER (WHERE pt.pnl > 0) / NULLIF(COUNT(*) FILTER (WHERE pt.status = 'closed'), 0), 1) as win_pct
FROM paper_trades pt
JOIN markets m ON pt.ticker = m.ticker
JOIN events e ON m.event_ticker = e.event_ticker
GROUP BY e.category
HAVING COUNT(pt.id) >= 3
ORDER BY pnl DESC NULLS LAST;
```

### Open Positions
```sql
SELECT pt.ticker, pt.side, pt.price, pt.cost, pt.fee, pt.strategy_id, pt.created_at,
       m.last_price, m.close_time, m.result
FROM paper_trades pt
JOIN markets m ON pt.ticker = m.ticker
WHERE pt.status = 'open'
ORDER BY pt.created_at DESC;
```

---

## Strategy Config & Learnings

### Current Strategy Configs
```sql
SELECT id, name, enabled, config FROM strategies ORDER BY id;
```

### Recent Learnings
```sql
SELECT strategy_id, learning_type, description, data, created_at
FROM strategy_learnings
ORDER BY created_at DESC
LIMIT 20;
```

### Strategy Ideas Recorded
```sql
SELECT description, data, created_at
FROM strategy_learnings
WHERE learning_type = 'strategy_idea'
ORDER BY created_at DESC;
```

---

## Market Data

### Settled Market Stats
```sql
SELECT
  COUNT(*) as total_settled,
  COUNT(*) FILTER (WHERE result = 'yes') as resolved_yes,
  COUNT(*) FILTER (WHERE result = 'no') as resolved_no,
  ROUND(AVG(volume)) as avg_volume,
  MAX(close_time) as most_recent_settlement
FROM markets
WHERE result IS NOT NULL;
```

### Category Distribution of Settled Markets
```sql
SELECT e.category, COUNT(m.ticker) as markets, ROUND(AVG(m.volume)) as avg_vol
FROM markets m
JOIN events e ON m.event_ticker = e.event_ticker
WHERE m.result IS NOT NULL AND m.volume >= 50
GROUP BY e.category
ORDER BY markets DESC;
```

---

## Go-Live Readiness Dashboard
```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'closed') as resolved_trades,
  CASE WHEN COUNT(*) FILTER (WHERE status = 'closed') >= 200 THEN 'PASS' ELSE 'FAIL' END as trades_check,
  ROUND(100.0 * COUNT(*) FILTER (WHERE pnl > 0) / NULLIF(COUNT(*) FILTER (WHERE status = 'closed'), 0), 1) as win_rate_pct,
  CASE WHEN 100.0 * COUNT(*) FILTER (WHERE pnl > 0) / NULLIF(COUNT(*) FILTER (WHERE status = 'closed'), 0) > 55 THEN 'PASS' ELSE 'FAIL' END as winrate_check,
  ROUND(SUM(pnl) FILTER (WHERE status = 'closed')::numeric, 2) as total_pnl,
  CASE WHEN COALESCE(SUM(pnl) FILTER (WHERE status = 'closed'), 0) > 0 THEN 'PASS' ELSE 'FAIL' END as pnl_check
FROM paper_trades;
```

---

## Writing Learnings

### Record a Parameter Change
```sql
INSERT INTO strategy_learnings (strategy_id, learning_type, description, data) VALUES
('strategy-id', 'param_change', 'Description of what changed and why',
 '{"before": {}, "after": {}, "evidence": "backtest showed X"}'::jsonb);
```

### Record a Category Insight
```sql
INSERT INTO strategy_learnings (strategy_id, learning_type, description, data) VALUES
('strategy-id', 'category_insight', 'Description',
 '{"category": "politics", "win_rate": 0.62, "trades": 45}'::jsonb);
```

### Record a Strategy Idea
```sql
INSERT INTO strategy_learnings (strategy_id, learning_type, description, data) VALUES
('general', 'strategy_idea', 'Idea description',
 '{"concept": "...", "expected_edge": "...", "data_needed": "..."}'::jsonb);
```

### Update Strategy Config
```sql
-- ALWAYS show before/after and ask permission first
UPDATE strategies SET config = '{"param": value}'::jsonb WHERE id = 'strategy-id';
```
