import { createServerClient } from "@/lib/supabase/server";

export type LearningType =
  | "param_change"       // Threshold adjustments from tuner
  | "category_insight"   // Category-specific performance patterns
  | "regime_change"      // Market regime shifts (volume, volatility)
  | "strategy_idea"      // Ideas for future strategies
  | "market_pattern"     // Recurring market behaviors
  | "failure_analysis";  // Post-mortem on bad trades

export async function recordLearning(params: {
  strategy_id: string | null;
  type: LearningType;
  description: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const supabase = await createServerClient();

  const { error } = await supabase
    .from("strategy_learnings")
    .insert({
      strategy_id: params.strategy_id ?? "system",
      learning_type: params.type,
      description: params.description,
      data: params.data ?? {},
    });

  if (error) {
    console.error("Failed to record learning:", error.message);
    throw error;
  }
}

export async function getRecentLearnings(options?: {
  strategy_id?: string;
  type?: LearningType;
  limit?: number;
}): Promise<{
  id: string;
  strategy_id: string;
  learning_type: string;
  description: string;
  data: Record<string, unknown>;
  created_at: string;
}[]> {
  const supabase = await createServerClient();
  const limit = options?.limit ?? 50;

  let query = supabase
    .from("strategy_learnings")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.strategy_id) {
    query = query.eq("strategy_id", options.strategy_id);
  }
  if (options?.type) {
    query = query.eq("learning_type", options.type);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to fetch learnings:", error.message);
    return [];
  }

  return data ?? [];
}
