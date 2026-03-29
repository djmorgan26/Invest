Design and implement a new strategy. If $ARGUMENTS contains a strategy concept, use that as the starting point. Otherwise, review performance first.

## Step 1: Research
- Run: `npx tsx src/scripts/review-performance.ts` to understand current performance
- Read existing strategies in `src/lib/strategies/` to understand the interface pattern
- Read `src/lib/strategies/types.ts` for the Strategy and Opportunity interfaces
- Read `src/lib/strategies/engine.ts` to understand how strategies are loaded and executed
- Check `strategy_learnings` for any recorded strategy ideas:
  ```sql
  SELECT * FROM strategy_learnings WHERE learning_type = 'strategy_idea' ORDER BY created_at DESC;
  ```
- Check external data for untapped signals:
  ```sql
  SELECT source, signal_type, category, COUNT(*) as signals
  FROM external_signals
  WHERE fetched_at > NOW() - INTERVAL '24 hours'
  GROUP BY source, signal_type, category
  ORDER BY signals DESC;
  ```

## Step 2: Design
Propose a strategy that:
1. Addresses a gap the current 10 strategies don't cover:
   - wide-spread, stale-price, extreme-value, mean-reversion
   - volume-spike, event-cluster, favorite-longshot, expiry-convergence
   - new-listing, liquidity-provision
2. Has clear, testable entry criteria
3. Has defined exit criteria and risk parameters
4. Can work with available data: markets, price_snapshots, events, orderbook_snapshots, **external_signals**
5. Consider leveraging **external data sources** for edge:
   - Polymarket/PredictIt price divergences
   - ESPN live scores + sportsbook odds consensus
   - FRED economic indicators (CPI, GDP, unemployment)
   - CoinGecko crypto prices + Fear & Greed Index
   - Open-Meteo/NWS weather forecasts
6. Consider leveraging **live streaming data** from the stale detector (Binance WS, ESPN poller, Kalshi WS)

Present the design for approval before implementing.

## Step 3: Implement
- Create `src/lib/strategies/<name>.ts` following the Strategy interface
- The scan() function receives markets array and ScanContext (with supabase client)
- Return Opportunity[] with: ticker, event_ticker, market_title, strategy_id, side, confidence, fair_value, edge, reasoning, quantity
- To use external signals, query `external_signals` table via supabase in the scan function
- To use market context with external data, use `getMarketContext()` from `src/lib/intelligence/context.ts`
- Add the strategy to `src/lib/strategies/engine.ts` import and strategy loader
- Create a Supabase migration to seed the strategy row in the `strategies` table

## Step 4: Test
- Run locally: `npx tsx src/scripts/run-strategies.ts`
- Verify the strategy finds opportunities (or explain why none exist currently)
- If historical data exists, backtest: `npx tsx src/scripts/backtest-historical.ts --strategy <name> --period 3m`
- Record a `strategy_idea` learning with the design rationale
