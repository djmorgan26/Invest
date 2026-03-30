import type { Market } from "@/lib/supabase/types";

export interface Opportunity {
  ticker: string;
  event_ticker: string;
  market_title: string;
  strategy_id: string;
  side: "yes" | "no";
  confidence: number;
  fair_value: number;
  edge: number;
  reasoning: string;
  quantity: number;
  /** "maker" = strategy assumes limit-order entry near midpoint (skip taker slippage override).
   *  "taker" or undefined = default taker entry using live yes_ask/yes_bid. */
  entry_type?: "maker" | "taker";
}

export interface Strategy {
  id: string;
  name: string;
  scan(markets: Market[], context: ScanContext): Promise<Opportunity[]>;
}

export interface ScanContext {
  supabase: ReturnType<typeof import("@/lib/supabase/server").createServerClient>;
}

export interface StrategyConfig {
  [key: string]: number | string | boolean;
}

export interface StrategyPerformance {
  strategy_id: string;
  strategy_name: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_edge: number;
  avg_pnl_per_trade: number;
  last_trade_at: string | null;
}

export interface StrategyLearning {
  id: string;
  strategy_id: string;
  learning_type: string;
  description: string;
  data: Record<string, unknown>;
  created_at: string;
}
