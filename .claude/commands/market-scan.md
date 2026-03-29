Run an intelligent manual scan for opportunities the automated strategies might miss.

## Step 1: Short-dated high-volume markets
```sql
SELECT m.ticker, m.title, m.last_price, m.yes_bid, m.yes_ask, m.volume, m.close_time,
       e.title as event_title, e.category
FROM markets m
JOIN events e ON m.event_ticker = e.event_ticker
WHERE m.status = 'open'
  AND m.close_time < NOW() + INTERVAL '48 hours'
  AND m.volume > 200
  AND m.last_price IS NOT NULL
ORDER BY m.volume DESC
LIMIT 30;
```

## Step 2: Cross-market divergences (external data)
Find Kalshi markets priced differently than Polymarket, PredictIt, or sportsbooks:
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

## Step 3: External signal highlights
Check what's moving in external data sources:
```sql
-- Crypto signals with large moves
SELECT source, title, data, fetched_at
FROM external_signals
WHERE category = 'crypto' AND signal_type = 'price'
  AND fetched_at > NOW() - INTERVAL '6 hours'
ORDER BY fetched_at DESC LIMIT 10;

-- Sports odds with high confidence
SELECT source, title, implied_probability, data, fetched_at
FROM external_signals
WHERE category = 'sports' AND signal_type = 'odds'
  AND fetched_at > NOW() - INTERVAL '6 hours'
ORDER BY fetched_at DESC LIMIT 10;

-- Economic indicators
SELECT source, title, signal_type, data, fetched_at
FROM external_signals
WHERE category = 'economics'
  AND fetched_at > NOW() - INTERVAL '24 hours'
ORDER BY fetched_at DESC LIMIT 10;
```

## Step 4: Event cluster analysis
Look for events with multiple markets where pricing seems inconsistent:
```sql
SELECT e.event_ticker, e.title, e.category,
       COUNT(*) as market_count,
       AVG(m.last_price) as avg_price,
       MIN(m.last_price) as min_price,
       MAX(m.last_price) as max_price
FROM events e
JOIN markets m ON e.event_ticker = m.event_ticker
WHERE m.status = 'open' AND m.last_price IS NOT NULL
GROUP BY e.event_ticker, e.title, e.category
HAVING COUNT(*) > 3
ORDER BY MAX(m.last_price) - MIN(m.last_price) DESC
LIMIT 20;
```

## Step 5: Recent price movers
```sql
SELECT ps.ticker, m.title,
       MIN(ps.last_price) as low_24h,
       MAX(ps.last_price) as high_24h,
       MAX(ps.last_price) - MIN(ps.last_price) as range_24h
FROM price_snapshots ps
JOIN markets m ON ps.ticker = m.ticker
WHERE ps.snapshot_at > NOW() - INTERVAL '24 hours'
  AND m.status = 'open'
GROUP BY ps.ticker, m.title
HAVING MAX(ps.last_price) - MIN(ps.last_price) > 10
ORDER BY range_24h DESC
LIMIT 20;
```

## Step 6: Open position check
Verify our existing positions are still valid:
```sql
SELECT pt.ticker, pt.side, pt.price, pt.cost, pt.created_at,
       m.last_price, m.yes_bid, m.yes_ask, m.close_time, m.result,
       pt.strategy_id
FROM paper_trades pt
JOIN markets m ON pt.ticker = m.ticker
WHERE pt.status = 'open'
ORDER BY pt.created_at DESC;
```

## Step 7: News context
Search the web for breaking news relevant to the top opportunity categories found above (politics, crypto, economics, weather, sports, etc.).

## Step 8: Rank and recommend
Output a ranked list of the **top 5 opportunities** with:
- Ticker and market title
- Current price and suggested fair value
- Side (yes/no) and reasoning
- **External data support** (do Polymarket/sportsbooks/economic data agree?)
- Confidence level and edge size
- Risk factors

For the best opportunity, suggest exact trade parameters.
