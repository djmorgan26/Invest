// Types for the live streaming / speed edge system

export interface LiveEvent {
  source: string;
  event_id: string;
  timestamp: number; // Unix ms
  type: "score_update" | "price_update" | "trade" | "odds_update";
  data: Record<string, unknown>;
}

export interface LiveScore {
  source: "espn";
  league: string;
  event_id: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  game_state: "pre" | "in" | "post";
  clock: string | null;
  period: number | null;
  status_desc: string;
  timestamp: number;
}

export interface LiveCryptoPrice {
  source: "binance";
  symbol: string;
  price: number;
  quantity: number;
  timestamp: number;
  buyer_maker: boolean;
}

export interface KalshiOrderbookUpdate {
  ticker: string;
  yes_bid: number;
  yes_ask: number;
  spread: number;
  timestamp: number;
}

export interface StaleOpportunity {
  id: string;
  ticker: string;
  market_title: string;
  category: string;
  // What triggered the opportunity
  trigger_source: string;
  trigger_event: string;
  trigger_detail: string;
  trigger_time: number;
  // Current Kalshi state (possibly stale)
  kalshi_price: number;
  kalshi_last_update: number;
  // What the price should be based on live data
  estimated_fair_value: number;
  edge_cents: number;
  side: "yes" | "no";
  confidence: number; // 0-1
  // Timing
  staleness_ms: number; // How long since Kalshi last moved
  detected_at: number;
  expires_at: number; // Opportunity window
}

export interface StreamListener {
  onScore?: (score: LiveScore) => void;
  onCryptoPrice?: (price: LiveCryptoPrice) => void;
  onOpportunity?: (opp: StaleOpportunity) => void;
}
