import { createServerClient } from "@/lib/supabase/server";

// --- Circuit Breaker Configuration ---
const STARTING_BALANCE = 10000;
const DAILY_LOSS_LIMIT = -500; // Halt all trading if daily P&L drops below this
const DRAWDOWN_THRESHOLD = 0.10; // 10% from peak portfolio value → halt
const MAX_PER_CATEGORY = 8; // Max open trades in any single category (raised from 3 to accelerate data collection)
const MAX_CONSECUTIVE_LOSSES = 5; // Per-strategy consecutive loss limit

export interface CircuitBreakerResult {
  allowed: boolean;
  reason?: string;
  breaker?: "kill_switch" | "daily_loss" | "drawdown" | "category_limit" | "consecutive_losses";
}

export interface CircuitBreakerStatus {
  kill_switch_active: boolean;
  daily_pnl: number;
  daily_loss_limit: number;
  daily_loss_breached: boolean;
  drawdown_pct: number;
  drawdown_threshold: number;
  drawdown_breached: boolean;
  peak_portfolio_value: number;
  current_portfolio_value: number;
  category_counts: Record<string, number>;
  category_limit: number;
  consecutive_losses: Record<string, number>;
  consecutive_loss_limit: number;
  all_clear: boolean;
}

/**
 * Master check: should we allow a new trade?
 * Called before every trade in autoTrade().
 */
export async function checkCircuitBreakers(
  ticker: string,
  strategyId: string,
): Promise<CircuitBreakerResult> {
  const supabase = await createServerClient();

  // 1. Kill switch — immediate halt
  const killSwitchActive = await isKillSwitchActive(supabase);
  if (killSwitchActive) {
    return { allowed: false, reason: "Kill switch is active — all trading halted", breaker: "kill_switch" };
  }

  // 2. Daily loss limit
  const dailyPnl = await getDailyPnl(supabase);
  if (dailyPnl <= DAILY_LOSS_LIMIT) {
    await logBreakerTrip(supabase, "daily_loss", `Daily P&L $${dailyPnl.toFixed(2)} breached limit $${DAILY_LOSS_LIMIT}`);
    return { allowed: false, reason: `Daily loss limit breached: $${dailyPnl.toFixed(2)} <= $${DAILY_LOSS_LIMIT}`, breaker: "daily_loss" };
  }

  // 3. Drawdown from peak
  const { drawdownPct } = await getDrawdown(supabase);
  if (drawdownPct >= DRAWDOWN_THRESHOLD) {
    await logBreakerTrip(supabase, "drawdown", `Drawdown ${(drawdownPct * 100).toFixed(1)}% breached ${(DRAWDOWN_THRESHOLD * 100)}% threshold`);
    return { allowed: false, reason: `Drawdown ${(drawdownPct * 100).toFixed(1)}% >= ${(DRAWDOWN_THRESHOLD * 100)}% limit`, breaker: "drawdown" };
  }

  // 4. Category concentration limit
  const { data: market } = await supabase
    .from("markets")
    .select("event_ticker")
    .eq("ticker", ticker)
    .single();

  if (market?.event_ticker) {
    const { data: event } = await supabase
      .from("events")
      .select("category")
      .eq("event_ticker", market.event_ticker)
      .single();

    if (event?.category) {
      const categoryCount = await getOpenTradesInCategory(supabase, event.category);
      if (categoryCount >= MAX_PER_CATEGORY) {
        return { allowed: false, reason: `Category "${event.category}" at max ${MAX_PER_CATEGORY} open trades`, breaker: "category_limit" };
      }
    }
  }

  // 5. Consecutive losses per strategy
  const consLosses = await getConsecutiveLosses(supabase, strategyId);
  if (consLosses >= MAX_CONSECUTIVE_LOSSES) {
    await logBreakerTrip(supabase, "consecutive_losses", `Strategy ${strategyId} hit ${consLosses} consecutive losses`);
    return { allowed: false, reason: `Strategy ${strategyId} has ${consLosses} consecutive losses (limit: ${MAX_CONSECUTIVE_LOSSES})`, breaker: "consecutive_losses" };
  }

  return { allowed: true };
}

/**
 * Get full circuit breaker status for dashboard/CLI display.
 */
export async function getCircuitBreakerStatus(): Promise<CircuitBreakerStatus> {
  const supabase = await createServerClient();

  const killSwitchActive = await isKillSwitchActive(supabase);
  const dailyPnl = await getDailyPnl(supabase);
  const { drawdownPct, peakValue, currentValue } = await getDrawdown(supabase);
  const categoryCounts = await getAllCategoryCounts(supabase);
  const consecutiveLosses = await getAllConsecutiveLosses(supabase);

  const dailyLossBreached = dailyPnl <= DAILY_LOSS_LIMIT;
  const drawdownBreached = drawdownPct >= DRAWDOWN_THRESHOLD;

  return {
    kill_switch_active: killSwitchActive,
    daily_pnl: Math.round(dailyPnl * 100) / 100,
    daily_loss_limit: DAILY_LOSS_LIMIT,
    daily_loss_breached: dailyLossBreached,
    drawdown_pct: Math.round(drawdownPct * 10000) / 10000,
    drawdown_threshold: DRAWDOWN_THRESHOLD,
    drawdown_breached: drawdownBreached,
    peak_portfolio_value: Math.round(peakValue * 100) / 100,
    current_portfolio_value: Math.round(currentValue * 100) / 100,
    category_counts: categoryCounts,
    category_limit: MAX_PER_CATEGORY,
    consecutive_losses: consecutiveLosses,
    consecutive_loss_limit: MAX_CONSECUTIVE_LOSSES,
    all_clear: !killSwitchActive && !dailyLossBreached && !drawdownBreached,
  };
}

// --- Kill Switch ---

async function isKillSwitchActive(supabase: Awaited<ReturnType<typeof createServerClient>>): Promise<boolean> {
  const { data } = await supabase
    .from("strategy_learnings")
    .select("id")
    .eq("learning_type", "kill_switch")
    .eq("description", "ACTIVE")
    .limit(1);

  return (data ?? []).length > 0;
}

/**
 * Activate the kill switch — halts ALL trading immediately.
 * Persists to DB so it survives restarts.
 */
export async function activateKillSwitch(reason: string): Promise<void> {
  const supabase = await createServerClient();

  // Remove any existing kill switch entries first
  await supabase
    .from("strategy_learnings")
    .delete()
    .eq("learning_type", "kill_switch");

  await supabase.from("strategy_learnings").insert({
    strategy_id: "system",
    learning_type: "kill_switch",
    description: "ACTIVE",
    data: { reason, activated_at: new Date().toISOString() },
  });
}

/**
 * Deactivate the kill switch — resume trading.
 */
export async function deactivateKillSwitch(): Promise<void> {
  const supabase = await createServerClient();
  await supabase
    .from("strategy_learnings")
    .delete()
    .eq("learning_type", "kill_switch");
}

// --- Daily P&L ---

async function getDailyPnl(supabase: Awaited<ReturnType<typeof createServerClient>>): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  // Realized P&L from trades closed today
  const { data: closedToday } = await supabase
    .from("paper_trades")
    .select("pnl")
    .eq("status", "closed")
    .gte("closed_at", todayStart.toISOString());

  const realizedToday = (closedToday ?? []).reduce((sum, t) => sum + (t.pnl ?? 0), 0);

  // Unrealized P&L from trades opened today
  const { data: openedToday } = await supabase
    .from("paper_trades")
    .select("ticker, side, quantity, price, cost")
    .eq("status", "open")
    .gte("created_at", todayStart.toISOString());

  let unrealizedToday = 0;
  for (const trade of openedToday ?? []) {
    const { data: market } = await supabase
      .from("markets")
      .select("yes_bid, yes_ask")
      .eq("ticker", trade.ticker)
      .single();

    if (market) {
      const currentPrice = trade.side === "yes"
        ? (market.yes_bid ?? trade.price * 100) / 100
        : (100 - (market.yes_ask ?? (1 - trade.price) * 100)) / 100;
      unrealizedToday += (currentPrice - trade.price) * trade.quantity;
    }
  }

  return realizedToday + unrealizedToday;
}

// --- Drawdown ---

async function getDrawdown(supabase: Awaited<ReturnType<typeof createServerClient>>): Promise<{
  drawdownPct: number;
  peakValue: number;
  currentValue: number;
}> {
  // Get all portfolio snapshots to find peak
  const { data: snapshots } = await supabase
    .from("portfolio_snapshots")
    .select("total_value")
    .order("snapshot_at", { ascending: false })
    .limit(500);

  if (!snapshots || snapshots.length === 0) {
    return { drawdownPct: 0, peakValue: STARTING_BALANCE, currentValue: STARTING_BALANCE };
  }

  const currentValue = snapshots[0].total_value;
  const peakValue = Math.max(STARTING_BALANCE, ...snapshots.map((s) => s.total_value));
  const drawdownPct = peakValue > 0 ? (peakValue - currentValue) / peakValue : 0;

  return { drawdownPct: Math.max(0, drawdownPct), peakValue, currentValue };
}

// --- Category Concentration ---

async function getOpenTradesInCategory(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  category: string,
): Promise<number> {
  // Get all open trade tickers
  const { data: openTrades } = await supabase
    .from("paper_trades")
    .select("ticker")
    .eq("status", "open");

  if (!openTrades || openTrades.length === 0) return 0;

  // Look up which events/categories those tickers belong to
  const tickers = openTrades.map((t) => t.ticker);
  const { data: markets } = await supabase
    .from("markets")
    .select("ticker, event_ticker")
    .in("ticker", tickers);

  if (!markets || markets.length === 0) return 0;

  const eventTickers = [...new Set(markets.map((m) => m.event_ticker))];
  const { data: events } = await supabase
    .from("events")
    .select("event_ticker, category")
    .in("event_ticker", eventTickers)
    .eq("category", category);

  if (!events || events.length === 0) return 0;

  // Count trades in this category
  const categoryEventTickers = new Set(events.map((e) => e.event_ticker));
  const marketTickersInCategory = new Set(
    markets.filter((m) => categoryEventTickers.has(m.event_ticker)).map((m) => m.ticker)
  );

  return openTrades.filter((t) => marketTickersInCategory.has(t.ticker)).length;
}

async function getAllCategoryCounts(supabase: Awaited<ReturnType<typeof createServerClient>>): Promise<Record<string, number>> {
  const { data: openTrades } = await supabase
    .from("paper_trades")
    .select("ticker")
    .eq("status", "open");

  if (!openTrades || openTrades.length === 0) return {};

  const tickers = openTrades.map((t) => t.ticker);
  const { data: markets } = await supabase
    .from("markets")
    .select("ticker, event_ticker")
    .in("ticker", tickers);

  if (!markets || markets.length === 0) return {};

  const eventTickers = [...new Set(markets.map((m) => m.event_ticker))];
  const { data: events } = await supabase
    .from("events")
    .select("event_ticker, category")
    .in("event_ticker", eventTickers);

  if (!events) return {};

  const counts: Record<string, number> = {};
  for (const event of events) {
    const cat = event.category ?? "unknown";
    const eventMarkets = markets.filter((m) => m.event_ticker === event.event_ticker);
    const tradeCount = openTrades.filter((t) => eventMarkets.some((m) => m.ticker === t.ticker)).length;
    counts[cat] = (counts[cat] ?? 0) + tradeCount;
  }

  return counts;
}

// --- Consecutive Losses ---

async function getConsecutiveLosses(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  strategyId: string,
): Promise<number> {
  const { data: recentTrades } = await supabase
    .from("paper_trades")
    .select("pnl")
    .eq("strategy_id", strategyId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(MAX_CONSECUTIVE_LOSSES + 1);

  if (!recentTrades || recentTrades.length === 0) return 0;

  let consecutive = 0;
  for (const trade of recentTrades) {
    if ((trade.pnl ?? 0) < 0) {
      consecutive++;
    } else {
      break;
    }
  }

  return consecutive;
}

async function getAllConsecutiveLosses(supabase: Awaited<ReturnType<typeof createServerClient>>): Promise<Record<string, number>> {
  const { data: strategies } = await supabase
    .from("strategies")
    .select("id")
    .eq("enabled", true);

  if (!strategies) return {};

  const result: Record<string, number> = {};
  for (const s of strategies) {
    result[s.id] = await getConsecutiveLosses(supabase, s.id);
  }
  return result;
}

// --- Logging ---

async function logBreakerTrip(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  breakerType: string,
  description: string,
): Promise<void> {
  await supabase.from("strategy_learnings").insert({
    strategy_id: "system",
    learning_type: "circuit_breaker",
    description,
    data: { breaker: breakerType, tripped_at: new Date().toISOString() },
  });
}
