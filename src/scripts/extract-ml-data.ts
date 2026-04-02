/**
 * Extract data from Supabase into CSV files for ML training pipeline.
 * Outputs: ml/data/settled_markets.csv, ml/data/market_trades.csv, ml/data/market_candles.csv
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DATA_DIR = path.join(__dirname, '../../ml/data');

function toCsv(rows: Record<string, any>[], columns: string[]): string {
  const header = columns.join(',');
  const lines = rows.map(row =>
    columns.map(col => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(',')
  );
  return [header, ...lines].join('\n');
}

async function fetchAllPaginated(
  table: string,
  select: string,
  filters?: (q: any) => any,
  orderCol: string = 'ticker',
  pageSize: number = 1000
): Promise<any[]> {
  let allRows: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(select).range(offset, offset + pageSize - 1);
    if (filters) query = filters(query);
    query = query.order(orderCol, { ascending: true });

    const { data, error } = await query;
    if (error) throw new Error(`Error fetching ${table}: ${error.message}`);
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allRows = allRows.concat(data);
      offset += pageSize;
      if (data.length < pageSize) hasMore = false;
    }
  }
  return allRows;
}

async function main() {
  console.log('Extracting ML training data from Supabase...\n');

  // 1. Get distinct tickers that have trade history
  console.log('Step 1: Finding tickers with trade history...');
  const { data: tickerRows } = await supabase.rpc('get_ml_tickers' as any);

  // Fallback: query market_trades for distinct tickers
  let tradeTickers: string[] = [];
  const tickerBatch: string[] = [];
  let offset = 0;
  const batchSize = 1000;
  let hasMore = true;

  // Get distinct tickers from market_trades via a simpler approach
  console.log('  Fetching distinct trade tickers...');
  const { data: distinctTickers, error: dtError } = await supabase
    .from('market_trades')
    .select('ticker')
    .limit(1);

  // We'll use a different approach: fetch settled markets first, then check trades
  console.log('  Fetching settled markets...');
  const settledMarkets: any[] = [];
  offset = 0;
  hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('markets')
      .select('ticker, event_ticker, title, result, yes_bid, yes_ask, last_price, volume, open_interest, close_time, created_at')
      .not('result', 'is', null)
      .not('close_time', 'is', null)
      .order('volume', { ascending: false })
      .range(offset, offset + batchSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    settledMarkets.push(...data);
    offset += batchSize;
    if (data.length < batchSize) hasMore = false;
  }
  console.log(`  Found ${settledMarkets.length} settled markets`);

  // 2. Get event categories
  console.log('\nStep 2: Fetching event categories...');
  const eventTickers = [...new Set(settledMarkets.map(m => m.event_ticker))];
  const categoryMap: Record<string, string> = {};

  for (let i = 0; i < eventTickers.length; i += 100) {
    const batch = eventTickers.slice(i, i + 100);
    const { data, error } = await supabase
      .from('events')
      .select('event_ticker, category')
      .in('event_ticker', batch);
    if (error) {
      console.error(`  Category batch error: ${error.message}`);
    }
    if (data) {
      for (const e of data) categoryMap[e.event_ticker] = e.category;
    }
  }
  console.log(`  Mapped ${Object.keys(categoryMap).length} event categories`);

  // Add categories to markets
  for (const m of settledMarkets) {
    m.category = categoryMap[m.event_ticker] || 'unknown';
  }

  // 3. Fetch trades for settled markets (paginate per ticker to get ALL trades)
  console.log('\nStep 3: Fetching market trades (paginated)...');
  const allTrades: any[] = [];
  const marketsWithTrades: string[] = [];
  let processed = 0;
  const PAGE_SIZE = 1000;

  const tickerList = settledMarkets.map(m => m.ticker);
  for (const ticker of tickerList) {
    // Paginate all trades for this ticker
    let tickerTrades: any[] = [];
    let tradeOffset = 0;
    let hasMoreTrades = true;

    while (hasMoreTrades) {
      const { data, error } = await supabase
        .from('market_trades')
        .select('ticker, trade_id, count, yes_price, no_price, taker_side, created_time')
        .eq('ticker', ticker)
        .order('created_time', { ascending: true })
        .range(tradeOffset, tradeOffset + PAGE_SIZE - 1);

      if (error) {
        console.error(`  Error fetching ${ticker}: ${error.message}`);
        break;
      }
      if (!data || data.length === 0) {
        hasMoreTrades = false;
      } else {
        tickerTrades.push(...data);
        tradeOffset += PAGE_SIZE;
        if (data.length < PAGE_SIZE) hasMoreTrades = false;
      }
    }

    if (tickerTrades.length > 0) {
      allTrades.push(...tickerTrades);
      marketsWithTrades.push(ticker);
    }

    processed++;
    if (processed % 50 === 0 || processed === tickerList.length) {
      console.log(`  Processed ${processed}/${tickerList.length} markets, ${allTrades.length} trades, ${marketsWithTrades.length} with data`);
    }
  }

  console.log(`  Total: ${allTrades.length} trades across ${marketsWithTrades.length} markets`);

  // 4. Fetch candles for those markets (paginated)
  console.log('\nStep 4: Fetching market candles...');
  const allCandles: any[] = [];
  let candleIdx = 0;
  for (const ticker of marketsWithTrades) {
    let candleOffset = 0;
    let hasMoreCandles = true;
    while (hasMoreCandles) {
      const { data, error } = await supabase
        .from('market_candles')
        .select('ticker, interval, open_price, high_price, low_price, close_price, volume, vwap, trade_count, bucket_start')
        .eq('ticker', ticker)
        .order('bucket_start', { ascending: true })
        .range(candleOffset, candleOffset + PAGE_SIZE - 1);

      if (error) break;
      if (!data || data.length === 0) { hasMoreCandles = false; break; }
      allCandles.push(...data);
      candleOffset += PAGE_SIZE;
      if (data.length < PAGE_SIZE) hasMoreCandles = false;
    }
    candleIdx++;
    if (candleIdx % 50 === 0 || candleIdx === marketsWithTrades.length) {
      console.log(`  Processed ${candleIdx}/${marketsWithTrades.length} markets, ${allCandles.length} candles`);
    }
  }

  // 5. Filter markets to only those with trade data
  const filteredMarkets = settledMarkets.filter(m => marketsWithTrades.includes(m.ticker));
  console.log(`\nFiltered to ${filteredMarkets.length} markets with trade data`);

  // 6. Write CSVs
  console.log('\nStep 5: Writing CSVs...');

  const marketCols = ['ticker', 'event_ticker', 'title', 'result', 'yes_bid', 'yes_ask',
    'last_price', 'volume', 'open_interest', 'close_time', 'created_at', 'category'];
  fs.writeFileSync(path.join(DATA_DIR, 'settled_markets.csv'), toCsv(filteredMarkets, marketCols));
  console.log(`  settled_markets.csv: ${filteredMarkets.length} rows`);

  const tradeCols = ['ticker', 'trade_id', 'count', 'yes_price', 'no_price', 'taker_side', 'created_time'];
  fs.writeFileSync(path.join(DATA_DIR, 'market_trades.csv'), toCsv(allTrades, tradeCols));
  console.log(`  market_trades.csv: ${allTrades.length} rows`);

  const candleCols = ['ticker', 'interval', 'open_price', 'high_price', 'low_price',
    'close_price', 'volume', 'vwap', 'trade_count', 'bucket_start'];
  fs.writeFileSync(path.join(DATA_DIR, 'market_candles.csv'), toCsv(allCandles, candleCols));
  console.log(`  market_candles.csv: ${allCandles.length} rows`);

  console.log('\nDone! CSV files ready for ML pipeline.');
}

main().catch(console.error);
