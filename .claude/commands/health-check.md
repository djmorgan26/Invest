Verify the full system is operating correctly.

## 1. Cron job status
Check recent sync_log entries to verify all 10 scheduled jobs are running:
```sql
SELECT type, status, records_processed, error_message, started_at, completed_at
FROM sync_log
ORDER BY started_at DESC
LIMIT 25;
```
Verify we see recent entries for: `market_sync`, `price_snapshot`, `strategy_scan`, `trade_resolve`, `portfolio_snapshot`, `orderbook_snapshot`, `external_data_fetch`, `alert_check`, `trade_history_fetch`

## 2. Market data freshness
```sql
SELECT COUNT(*) as total_markets,
       COUNT(*) FILTER (WHERE status = 'open') as open_markets,
       MAX(updated_at) as last_market_update
FROM markets;
```

## 3. Price snapshot recency
```sql
SELECT COUNT(*) as total_snapshots,
       MAX(snapshot_at) as latest_snapshot,
       COUNT(DISTINCT ticker) as tickers_tracked
FROM price_snapshots
WHERE snapshot_at > NOW() - INTERVAL '1 hour';
```

## 4. Orderbook snapshot recency
```sql
SELECT COUNT(*) as total_snapshots,
       MAX(snapshot_at) as latest_snapshot,
       COUNT(DISTINCT ticker) as tickers_tracked
FROM orderbook_snapshots
WHERE snapshot_at > NOW() - INTERVAL '1 hour';
```

## 5. External data freshness
```sql
SELECT source, COUNT(*) as signals,
       MAX(fetched_at) as latest_fetch,
       COUNT(*) FILTER (WHERE fetched_at > NOW() - INTERVAL '1 hour') as signals_last_hour
FROM external_signals
GROUP BY source
ORDER BY latest_fetch DESC;
```
Expected sources: `polymarket`, `predictit`, `espn`, `odds_api`, `fred`, `coingecko`, `open_meteo`, `nws`

## 6. External market mappings
```sql
SELECT source, COUNT(*) as mappings, ROUND(AVG(match_confidence)::numeric, 2) as avg_confidence
FROM external_market_mappings
GROUP BY source;
```

## 7. Alert system status
```sql
SELECT type, status, records_processed, error_message, started_at
FROM sync_log
WHERE type = 'alert_check'
ORDER BY started_at DESC
LIMIT 5;
```

## 8. Portfolio tracking
```sql
SELECT * FROM portfolio_snapshots ORDER BY snapshot_at DESC LIMIT 5;
```

## 9. Paper trade status
```sql
SELECT status, COUNT(*) as count, SUM(cost) as total_cost, SUM(pnl) as total_pnl
FROM paper_trades
GROUP BY status;
```

## 10. Strategy health (all 10 strategies)
```sql
SELECT s.id, s.name, s.enabled, s.config,
       COUNT(pt.id) FILTER (WHERE pt.status = 'open') as open_trades,
       COUNT(pt.id) FILTER (WHERE pt.status = 'closed') as closed_trades
FROM strategies s
LEFT JOIN paper_trades pt ON s.id = pt.strategy_id
GROUP BY s.id, s.name, s.enabled, s.config;
```

## 11. Circuit breaker status
```sql
SELECT * FROM strategy_learnings
WHERE learning_type = 'circuit_breaker'
ORDER BY created_at DESC
LIMIT 5;
```

## 12. Recent errors
```sql
SELECT * FROM sync_log WHERE status = 'error' ORDER BY started_at DESC LIMIT 10;
```

## 13. GitHub Actions check
If errors are found, check `.github/workflows/crons.yml` for the 10 scheduled jobs:
- Market sync (6h), Price snapshots (5m), Strategy scan (5m), Trade resolution (30m)
- Portfolio snapshot (1h), Strategy tuning (weekly), Orderbook snapshot (5m)
- External data fetch (15m), Alert check (5m), Trade history fetch (daily)

## Assessment
Report system status as one of:
- **OK** — All systems operational, data flowing, trades executing, external data fresh
- **DEGRADED** — Some components failing but core functionality intact
- **DOWN** — Critical failures preventing operation

For any issues found, provide specific fix recommendations. Pay special attention to:
- External data connectors returning errors (API keys expired? rate limits?)
- Alert system not firing (is it running? are there mappings?)
- Orderbook data gaps (affects liquidity-provision strategy)
