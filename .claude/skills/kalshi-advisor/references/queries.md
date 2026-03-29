# Kalshi Advisor — SQL Query Reference

All queries run against the Supabase MCP `execute_sql` tool (project ID: `mewhujreglvsqllupbjl`).

## Health Queries

### Cron Job Status
```sql
SELECT type, MAX(started_at) as last_run,
       COUNT(*) FILTER (WHERE status = 'error' AND started_at > NOW() - INTERVAL '24 hours') as errors_24h
FROM sync_log
GROUP BY type
ORDER BY last_run DESC;
```
Expected types: `market_sync`, `price_snapshot`, `strategy_scan`, `trade_resolve`, `portfolio_snapshot`, `orderbook_snapshot`, `external_data_fetch`, `alert_check`, `trade_history_fetch`.
Flag DEGRADED if any hasn't run in 2+ hours (except weekly `strategy_tune` and daily `trade_history_fetch`).

### Data Coverage
```sql
SELECT COUNT(DISTINCT ticker) as tickers_with_snapshots,
       COUNT(*) as total_snapshots_24h,
       MAX(snapshot_at) as newest
FROM price_snapshots
WHERE snapshot_at > NOW() - INTERVAL '24 hours';
```

### Orderbook Coverage
```sql
SELECT COUNT(DISTINCT ticker) as tickers_with_orderbooks,
       COUNT(*) as total_orderbook_snapshots,
       MAX(snapshot_at) as newest
FROM orderbook_snapshots
WHERE snapshot_at > NOW() - INTERVAL '24 hours';
```

### Watchlist Size
```sql
SELECT COUNT(*) as watchlist_size FROM watchlist;
```

### External Data Freshness
```sql
SELECT source, COUNT(*) as signals,
       MAX(fetched_at) as latest_fetch,
       COUNT(*) FILTER (WHERE fetched_at > NOW() - INTERVAL '1 hour') as signals_last_hour
FROM external_signals
GROUP BY source
ORDER BY latest_fetch DESC;
```
Expected sources: `polymarket`, `predictit`, `espn`, `odds_api`, `fred`, `coingecko`, `open_meteo`, `nws`.

### External Market Mapping Coverage
```sql
SELECT source, COUNT(*) as mappings, ROUND(AVG(match_confidence)::numeric, 2) as avg_confidence
FROM external_market_mappings
GROUP BY source;
```

### Alert System Status
```sql
SELECT type, status, records_processed, error_message, started_at
FROM sync_log
WHERE type = 'alert_check'
ORDER BY started_at DESC
LIMIT 5;
```

---

## Performance Queries

### Overall P&L
```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'closed') as resolved_trades,
  COUNT(*) FILTER (WHERE status = 'open') as open_trades,
  SUM(pnl) FILTER (WHERE status = 'closed') as total_pnl,
  SUM(cost) FILTER (WHERE status = 'open') as capital_deployed,
  COUNT(*) FILTER (WHERE status = 'closed' AND pnl > 0) as wins,
  COUNT(*) FILTER (WHERE status = 'closed' AND pnl <= 0) as losses,
  ROUND(AVG(fee) FILTER (WHERE status = 'closed'), 2) as avg_fee
FROM paper_trades;
```

### Per-Strategy Breakdown
```sql
SELECT
  s.id, s.name, s.enabled,
  COUNT(pt.id) FILTER (WHERE pt.status = 'closed') as trades,
  COUNT(pt.id) FILTER (WHERE pt.status = 'open') as open,
  SUM(pt.pnl) FILTER (WHERE pt.status = 'closed') as pnl,
  ROUND(100.0 * COUNT(*) FILTER (WHERE pt.pnl > 0) / NULLIF(COUNT(*) FILTER (WHERE pt.status = 'closed'), 0), 1) as win_rate_pct,
  ROUND(AVG(pt.pnl) FILTER (WHERE pt.status = 'closed'), 2) as avg_pnl,
  SUM(pt.fee) FILTER (WHERE pt.status = 'closed') as total_fees,
  MAX(pt.created_at) as last_trade
FROM strategies s
LEFT JOIN paper_trades pt ON s.id = pt.strategy_id
GROUP BY s.id, s.name, s.enabled
ORDER BY pnl DESC NULLS LAST;
```

### Portfolio Trend
```sql
SELECT total_value, cash, unrealized_pnl, realized_pnl, snapshot_at
FROM portfolio_snapshots
ORDER BY snapshot_at DESC
LIMIT 7;
```

### Recent Learnings
```sql
SELECT strategy_id, learning_type, description, created_at
FROM strategy_learnings
ORDER BY created_at DESC
LIMIT 10;
```

---

## External Data Queries

### Signal Coverage by Source and Category
```sql
SELECT source, category, signal_type, COUNT(*) as signals, MAX(fetched_at) as latest
FROM external_signals
WHERE fetched_at > NOW() - INTERVAL '24 hours'
GROUP BY source, category, signal_type
ORDER BY signals DESC;
```

### Cross-Market Divergences (Kalshi vs External)
```sql
SELECT emm.kalshi_ticker, m.title as kalshi_title, m.last_price as kalshi_price,
       es.source, es.title as external_title,
       ROUND((es.implied_probability * 100)::numeric, 1) as external_price,
       ROUND((es.implied_probability * 100 - m.last_price)::numeric, 1) as divergence_cents,
       m.close_time, m.volume
FROM external_market_mappings emm
JOIN markets m ON emm.kalshi_ticker = m.ticker
JOIN external_signals es ON es.source = emm.source
WHERE m.status IN ('open', 'active')
  AND es.fetched_at > NOW() - INTERVAL '6 hours'
  AND ABS(es.implied_probability * 100 - m.last_price) > 5
ORDER BY ABS(es.implied_probability * 100 - m.last_price) DESC
LIMIT 20;
```

### External Signals for a Specific Market
```sql
-- Replace <TICKER> with actual ticker
SELECT es.source, es.title, es.implied_probability, es.signal_type, es.data, es.fetched_at
FROM external_signals es
JOIN external_market_mappings emm ON es.source = emm.source
WHERE emm.kalshi_ticker = '<TICKER>'
  AND es.fetched_at > NOW() - INTERVAL '24 hours'
ORDER BY es.fetched_at DESC;
```

### Unmapped Markets with External Opportunities
```sql
SELECT m.ticker, m.title, m.volume, m.last_price, e.category
FROM markets m
JOIN events e ON m.event_ticker = e.event_ticker
WHERE m.status IN ('open', 'active')
  AND m.volume > 200
  AND NOT EXISTS (SELECT 1 FROM external_market_mappings emm WHERE emm.kalshi_ticker = m.ticker)
ORDER BY m.volume DESC
LIMIT 20;
```

---

## Market Scan Queries

### Expiring Soon with Volume (48h)
```sql
SELECT m.ticker, m.title, m.last_price, m.yes_bid, m.yes_ask, m.volume, m.volume_24h,
       m.close_time, e.category, (m.yes_ask - m.yes_bid) as spread
FROM markets m
JOIN events e ON m.event_ticker = e.event_ticker
WHERE m.status IN ('open', 'active')
  AND m.close_time < NOW() + INTERVAL '48 hours'
  AND m.close_time > NOW()
  AND m.volume > 100 AND m.last_price IS NOT NULL
ORDER BY m.volume_24h DESC NULLS LAST
LIMIT 20;
```

### Biggest 24h Price Movers
```sql
SELECT ps.ticker, m.title,
       MIN(ps.last_price) as low_24h, MAX(ps.last_price) as high_24h,
       MAX(ps.last_price) - MIN(ps.last_price) as range_24h, m.close_time
FROM price_snapshots ps
JOIN markets m ON ps.ticker = m.ticker
WHERE ps.snapshot_at > NOW() - INTERVAL '24 hours'
  AND m.status IN ('open', 'active')
GROUP BY ps.ticker, m.title, m.close_time
HAVING MAX(ps.last_price) - MIN(ps.last_price) > 8
ORDER BY range_24h DESC
LIMIT 15;
```

### Widest Spreads with Volume
```sql
SELECT m.ticker, m.title, m.yes_bid, m.yes_ask, (m.yes_ask - m.yes_bid) as spread,
       m.volume, m.volume_24h, m.close_time
FROM markets m
WHERE m.status IN ('open', 'active')
  AND m.yes_bid IS NOT NULL AND m.yes_ask IS NOT NULL
  AND (m.yes_ask - m.yes_bid) > 10 AND m.volume > 50
ORDER BY spread DESC
LIMIT 15;
```

### Open Positions Health
```sql
SELECT pt.ticker, pt.side, pt.price, pt.cost, pt.fee, pt.strategy_id, pt.created_at,
       m.last_price, m.yes_bid, m.yes_ask, m.close_time, m.result
FROM paper_trades pt
JOIN markets m ON pt.ticker = m.ticker
WHERE pt.status = 'open'
ORDER BY pt.created_at DESC;
```

### Category Performance
```sql
SELECT e.category,
       COUNT(pt.id) as trades,
       SUM(pt.pnl) FILTER (WHERE pt.status = 'closed') as pnl,
       ROUND(100.0 * COUNT(*) FILTER (WHERE pt.pnl > 0) / NULLIF(COUNT(*) FILTER (WHERE pt.status = 'closed'), 0), 1) as win_pct
FROM paper_trades pt
JOIN markets m ON pt.ticker = m.ticker
JOIN events e ON m.event_ticker = e.event_ticker
GROUP BY e.category
ORDER BY trades DESC;
```

---

## Go-Live Benchmarks

| Metric | Threshold | Query Field |
|--------|-----------|-------------|
| Resolved trades | 200+ | `resolved_trades` |
| Win rate | > 55% | `wins / resolved_trades` |
| Total P&L | Positive | `total_pnl` |
| No strategy losing > $500 | Check per-strategy | `pnl` per strategy |
| Sharpe ratio | > 1.0 | Computed from portfolio snapshots |
| Max drawdown | < 15% | Computed from portfolio snapshots |
| Consistency | 2+ weeks | Check trade dates span |

## Strategy Health Thresholds

| Win Rate | Assessment |
|----------|------------|
| > 55% | Healthy — KEEP |
| 40-55% | Watch closely — may need TUNE |
| < 40% | DISABLE or major parameter overhaul |
| No trades 7+ days | INVESTIGATE — too restrictive? |
