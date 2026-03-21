export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string;
  status: string;
  yes_bid_dollars: string;
  yes_ask_dollars: string;
  no_bid_dollars: string;
  no_ask_dollars: string;
  last_price_dollars: string;
  previous_price_dollars: string;
  volume_fp: string;
  volume_24h_fp: string;
  open_interest_fp: string;
  liquidity_dollars: string;
  close_time: string;
  expiration_time: string;
  result: string;
  market_type: string;
  notional_value_dollars: string;
}

export interface KalshiEvent {
  event_ticker: string;
  title: string;
  category: string;
  sub_title: string;
  mutually_exclusive: boolean;
  status: string;
  markets: KalshiMarket[];
}

export interface KalshiTrade {
  ticker: string;
  trade_id: string;
  // New API uses _fp and _dollars fields
  count?: number;
  count_fp?: string;
  yes_price?: number;
  yes_price_dollars?: string;
  no_price?: number;
  no_price_dollars?: string;
  created_time: string;
  taker_side: string;
}

// Normalize trade fields (handles both old cent-based and new dollar-based formats)
export function normalizeTrade(t: KalshiTrade): { count: number; yes_price: number; no_price: number } {
  const count = t.count ?? (t.count_fp ? Math.round(parseFloat(t.count_fp)) : 0);
  const yes_price = t.yes_price ?? (t.yes_price_dollars ? Math.round(parseFloat(t.yes_price_dollars) * 100) : 0);
  const no_price = t.no_price ?? (t.no_price_dollars ? Math.round(parseFloat(t.no_price_dollars) * 100) : 0);
  return { count, yes_price, no_price };
}

export interface KalshiMarketsResponse {
  markets: KalshiMarket[];
  cursor: string;
}

export interface KalshiEventResponse {
  event: KalshiEvent;
}

export interface KalshiTradesResponse {
  trades: KalshiTrade[];
  cursor: string;
}

// Kalshi returns orderbook as [price_dollars_string, quantity_string] tuples
export type KalshiOrderBookEntry = [string, string];

export interface KalshiOrderBookResponse {
  orderbook_fp: {
    yes_dollars: KalshiOrderBookEntry[];
    no_dollars: KalshiOrderBookEntry[];
  };
}

// Helper to convert Kalshi dollar strings to cents (0-100 scale for DB)
export function dollarsToCents(dollars: string | null | undefined): number | null {
  if (!dollars) return null;
  const val = parseFloat(dollars);
  if (isNaN(val)) return null;
  return Math.round(val * 100);
}

export function fpToInt(fp: string | null | undefined): number | null {
  if (!fp) return null;
  const val = parseFloat(fp);
  if (isNaN(val)) return null;
  return Math.round(val);
}
