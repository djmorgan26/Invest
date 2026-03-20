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

5. **External context:** Search the web for recent news relevant to this market's title and category.

6. **Assessment:** Based on all data:
   - Is this market correctly priced?
   - Is there an identifiable edge?
   - What's the risk/reward?
   - If edge exists: recommend trade parameters (side, confidence, fair_value, quantity)
   - If no edge: explain why and what would need to change
