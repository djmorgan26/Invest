Given a market ticker (passed as $ARGUMENTS, or ask if not provided), investigate thoroughly:

1. **Market data:** Query Supabase for the market record:
   ```sql
   SELECT m.*, e.title as event_title, e.category FROM markets m JOIN events e ON m.event_ticker = e.event_ticker WHERE m.ticker = '<TICKER>';
   ```

2. **Price history:** Query price_snapshots for recent history:
   ```sql
   SELECT * FROM price_snapshots WHERE ticker = '<TICKER>' ORDER BY snapshot_at DESC LIMIT 50;
   ```

3. **Sibling markets:** Find related markets in the same event:
   ```sql
   SELECT ticker, title, last_price, yes_bid, yes_ask, volume, result FROM markets WHERE event_ticker = (SELECT event_ticker FROM markets WHERE ticker = '<TICKER>') ORDER BY volume DESC;
   ```

4. **Our positions:** Check for open trades and predictions:
   ```sql
   SELECT * FROM paper_trades WHERE ticker = '<TICKER>' AND status = 'open';
   SELECT * FROM predictions WHERE ticker = '<TICKER>' ORDER BY created_at DESC LIMIT 5;
   ```

5. **Orderbook depth:** Check recent orderbook snapshots:
   ```sql
   SELECT * FROM orderbook_snapshots WHERE ticker = '<TICKER>' ORDER BY snapshot_at DESC LIMIT 5;
   ```

6. **External signals:** Check what external data sources say about this market:
   ```sql
   -- Direct market mappings
   SELECT es.source, es.title, es.implied_probability, es.signal_type, es.data, es.fetched_at
   FROM external_signals es
   JOIN external_market_mappings emm ON es.source = emm.source
   WHERE emm.kalshi_ticker = '<TICKER>'
     AND es.fetched_at > NOW() - INTERVAL '24 hours'
   ORDER BY es.fetched_at DESC;

   -- Category-level signals (fallback if no direct mapping)
   SELECT es.source, es.title, es.implied_probability, es.signal_type, es.category, es.fetched_at
   FROM external_signals es
   WHERE es.category = (SELECT e.category FROM markets m JOIN events e ON m.event_ticker = e.event_ticker WHERE m.ticker = '<TICKER>')
     AND es.fetched_at > NOW() - INTERVAL '24 hours'
   ORDER BY es.fetched_at DESC
   LIMIT 20;
   ```

7. **Cross-market price comparison:** If mapped to external markets, compare pricing:
   ```sql
   SELECT emm.source, emm.external_id, emm.external_title, emm.match_confidence,
          m.last_price as kalshi_price
   FROM external_market_mappings emm
   JOIN markets m ON emm.kalshi_ticker = m.ticker
   WHERE emm.kalshi_ticker = '<TICKER>';
   ```

8. **External context:** Search the web for recent news relevant to this market's title and category.

9. **Assessment:** Based on all data (internal + external):
   - Is this market correctly priced?
   - Do external sources agree or disagree with Kalshi pricing?
   - Is there an identifiable edge? How large?
   - What's the risk/reward?
   - If edge exists: recommend trade parameters (side, confidence, fair_value, quantity)
   - If no edge: explain why and what would need to change
