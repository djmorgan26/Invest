export interface Event {
  event_ticker: string;
  title: string;
  category: string | null;
  sub_title: string | null;
  mutually_exclusive: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Market {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string | null;
  status: string;
  yes_bid: number | null;
  yes_ask: number | null;
  last_price: number | null;
  volume: number | null;
  open_interest: number | null;
  close_time: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceSnapshot {
  id: string;
  ticker: string;
  yes_bid: number;
  yes_ask: number;
  last_price: number;
  volume: number;
  snapshot_at: string;
}

export interface Prediction {
  id: string;
  ticker: string;
  side: "yes" | "no";
  confidence: number;
  fair_value: number;
  edge: number;
  reasoning: string;
  status: "pending" | "correct" | "incorrect" | "expired";
  strategy_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface PaperTrade {
  id: string;
  ticker: string;
  side: "yes" | "no";
  quantity: number;
  price: number;
  cost: number;
  status: "open" | "closed" | "expired";
  exit_price: number | null;
  pnl: number | null;
  prediction_id: string | null;
  strategy_id: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface StrategyRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
}

export interface StrategyLearningRow {
  id: string;
  strategy_id: string;
  learning_type: string;
  description: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface PortfolioSnapshot {
  id: string;
  cash: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_value: number;
  snapshot_at: string;
}

export interface WatchlistItem {
  ticker: string;
  added_at: string;
  notes: string | null;
}

export interface SyncLogEntry {
  id: string;
  type: string;
  status: "success" | "error";
  records_processed: number;
  error_message: string | null;
  started_at: string;
  completed_at: string;
}

export interface MarketContextRow {
  id: string;
  ticker: string;
  context_type: string;
  content: string;
  source: string | null;
  relevance_score: number | null;
  created_at: string;
  expires_at: string | null;
}

export interface ReviewRow {
  id: string;
  review_type: string;
  summary: string;
  recommendations: { action: string; priority: string; reasoning: string }[] | null;
  metrics: Record<string, unknown> | null;
  created_at: string;
}

// Remove the Database generic — use untyped supabase client
// This avoids complex type gymnastics while keeping row types for components
