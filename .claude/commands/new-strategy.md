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

## Step 2: Design
Propose a strategy that:
1. Addresses a gap the current 4 strategies (wide-spread, stale-price, extreme-value, mean-reversion) don't cover
2. Has clear, testable entry criteria
3. Has defined exit criteria and risk parameters
4. Can work with the data we already collect (markets, price_snapshots, events)

Present the design for approval before implementing.

## Step 3: Implement
- Create `src/lib/strategies/<name>.ts` following the Strategy interface
- The scan() function receives markets array and ScanContext (with supabase client)
- Return Opportunity[] with: ticker, event_ticker, market_title, strategy_id, side, confidence, fair_value, edge, reasoning, quantity
- Add the strategy to `src/lib/strategies/engine.ts` import and strategy loader
- Create a Supabase migration to seed the strategy row in the `strategies` table

## Step 4: Test
- Run locally: `npx tsx src/scripts/run-strategies.ts`
- Verify the strategy finds opportunities (or explain why none exist currently)
- Record a `strategy_idea` learning with the design rationale
