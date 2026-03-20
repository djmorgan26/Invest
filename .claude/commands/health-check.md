Verify the full system is operating correctly.

## 1. Cron job status
Check recent sync_log entries to verify scheduled jobs are running:
```sql
SELECT type, status, records_processed, error_message, started_at, completed_at
FROM sync_log
ORDER BY started_at DESC
LIMIT 20;
```
Verify we see recent entries for: market_sync, price_snapshot, strategy_scan, trade_resolve, portfolio_snapshot

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

## 4. Portfolio tracking
```sql
SELECT * FROM portfolio_snapshots ORDER BY snapshot_at DESC LIMIT 5;
```

## 5. Paper trade status
```sql
SELECT status, COUNT(*) as count, SUM(cost) as total_cost, SUM(pnl) as total_pnl
FROM paper_trades
GROUP BY status;
```

## 6. Strategy health
```sql
SELECT s.id, s.name, s.enabled, s.config,
       COUNT(pt.id) FILTER (WHERE pt.status = 'open') as open_trades,
       COUNT(pt.id) FILTER (WHERE pt.status = 'closed') as closed_trades
FROM strategies s
LEFT JOIN paper_trades pt ON s.id = pt.strategy_id
GROUP BY s.id, s.name, s.enabled, s.config;
```

## 7. Recent errors
```sql
SELECT * FROM sync_log WHERE status = 'error' ORDER BY started_at DESC LIMIT 10;
```

## Assessment
Report system status as one of:
- **OK** — All systems operational, data flowing, trades executing
- **DEGRADED** — Some components failing but core functionality intact
- **DOWN** — Critical failures preventing operation

For any issues found, provide specific fix recommendations.
