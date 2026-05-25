import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import { PnlValue } from "@/components/ui/pnl-value";
import { TradeTabs } from "@/components/trades/trade-tabs";
import type { EnrichedTrade } from "@/components/trades/trade-tabs";
import type {
  PaperTrade,
  Market,
  Event,
  Prediction,
  StrategyRow,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// ── Page ─────────────────────────────────────────────────────────────

export default async function TradesPage() {
  const supabase = await createServerClient();

  // 1. Fetch all trades
  const { data: allTrades } = await supabase
    .from("paper_trades")
    .select("*")
    .order("created_at", { ascending: false });

  const trades: PaperTrade[] = allTrades ?? [];

  // 2. Collect unique foreign keys
  const uniqueTickers = [...new Set(trades.map((t) => t.ticker))];
  const predictionIds = [
    ...new Set(trades.map((t) => t.prediction_id).filter(Boolean)),
  ] as string[];
  const strategyIds = [
    ...new Set(trades.map((t) => t.strategy_id).filter(Boolean)),
  ] as string[];

  // 3. Parallel fetches for enrichment data
  const [marketsRes, predictionsRes, strategiesRes] = await Promise.all([
    uniqueTickers.length > 0
      ? supabase
          .from("markets")
          .select("ticker, title, last_price, close_time, event_ticker")
          .in("ticker", uniqueTickers)
      : Promise.resolve({ data: [] as Market[] }),
    predictionIds.length > 0
      ? supabase
          .from("predictions")
          .select("id, confidence, fair_value, edge, reasoning")
          .in("id", predictionIds)
      : Promise.resolve({ data: [] as Prediction[] }),
    strategyIds.length > 0
      ? supabase
          .from("strategies")
          .select("id, name")
          .in("id", strategyIds)
      : Promise.resolve({ data: [] as StrategyRow[] }),
  ]);

  const markets = (marketsRes.data ?? []) as Pick<
    Market,
    "ticker" | "title" | "last_price" | "close_time" | "event_ticker"
  >[];
  const predictions = (predictionsRes.data ?? []) as Pick<
    Prediction,
    "id" | "confidence" | "fair_value" | "edge" | "reasoning"
  >[];
  const strategies = (strategiesRes.data ?? []) as Pick<
    StrategyRow,
    "id" | "name"
  >[];

  // 4. Fetch events for categories
  const uniqueEventTickers = [
    ...new Set(markets.map((m) => m.event_ticker).filter(Boolean)),
  ];
  const eventsRes =
    uniqueEventTickers.length > 0
      ? await supabase
          .from("events")
          .select("event_ticker, title, category")
          .in("event_ticker", uniqueEventTickers)
      : { data: [] as Event[] };

  const events = (eventsRes.data ?? []) as Pick<
    Event,
    "event_ticker" | "title" | "category"
  >[];

  // 5. Build lookup maps
  const marketMap = new Map(markets.map((m) => [m.ticker, m]));
  const eventMap = new Map(events.map((e) => [e.event_ticker, e]));
  const predictionMap = new Map(predictions.map((p) => [p.id, p]));
  const strategyMap = new Map(strategies.map((s) => [s.id, s]));

  // 6. Enrich trades
  const enrichedTrades: EnrichedTrade[] = trades.map((trade) => {
    const market = marketMap.get(trade.ticker);
    const event = market ? eventMap.get(market.event_ticker) : null;
    const prediction = trade.prediction_id
      ? predictionMap.get(trade.prediction_id)
      : null;
    const strategy = trade.strategy_id
      ? strategyMap.get(trade.strategy_id)
      : null;

    return {
      ...trade,
      market_title: market?.title ?? null,
      event_category: event?.category ?? null,
      current_price: market?.last_price != null ? market.last_price / 100 : null,
      close_time: market?.close_time ?? null,
      strategy_name: strategy?.name ?? null,
      prediction_reasoning: prediction?.reasoning ?? null,
      prediction_confidence: prediction?.confidence ?? null,
      prediction_fair_value: prediction?.fair_value ?? null,
    };
  });

  const openTrades = enrichedTrades.filter((t) => t.status === "open");
  const closedTrades = enrichedTrades.filter(
    (t) => t.status === "closed" || t.status === "expired"
  );

  // 7. Compute stats
  const totalExposure = openTrades.reduce((sum, t) => sum + t.cost, 0);

  const unrealizedPnl = openTrades.reduce((sum, t) => {
    if (t.current_price == null) return sum;
    const delta =
      t.side === "yes"
        ? (t.current_price - t.price) * t.quantity
        : (t.price - t.current_price) * t.quantity;
    return sum + delta;
  }, 0);

  const realizedPnl = closedTrades.reduce(
    (sum, t) => sum + (t.pnl ?? 0),
    0
  );

  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const losses = closedTrades.filter(
    (t) => t.pnl != null && t.pnl <= 0
  ).length;
  const resolvedCount = wins + losses;
  const winRate = resolvedCount > 0 ? wins / resolvedCount : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trades</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paper trading positions and history
        </p>
      </div>

      {/* Summary Stats — Compact Inline Pills */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-lg bg-secondary/50 px-4 py-2">
          <p className="text-xs text-muted-foreground">Total Exposure</p>
          <p className="font-mono text-sm font-medium">
            {formatCurrency(totalExposure)}
          </p>
          {openTrades.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {openTrades.length} open position{openTrades.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <div className="rounded-lg bg-secondary/50 px-4 py-2">
          <p className="text-xs text-muted-foreground">Unrealized P&L</p>
          <PnlValue value={unrealizedPnl} size="sm" />
        </div>
        <div className="rounded-lg bg-secondary/50 px-4 py-2">
          <p className="text-xs text-muted-foreground">Realized P&L</p>
          <PnlValue value={realizedPnl} size="sm" />
          {resolvedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {wins}W / {losses}L
            </p>
          )}
        </div>
        <div className="rounded-lg bg-secondary/50 px-4 py-2">
          <p className="text-xs text-muted-foreground">Win Rate</p>
          <p className="font-mono text-sm font-medium">
            {resolvedCount > 0 ? `${(winRate * 100).toFixed(1)}%` : "N/A"}
          </p>
          {resolvedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {resolvedCount} resolved
            </p>
          )}
        </div>
      </div>

      {/* Tabbed Trade Views */}
      <TradeTabs
        enrichedTrades={enrichedTrades}
        openTrades={openTrades}
        closedTrades={closedTrades}
        realizedPnl={realizedPnl}
      />
    </div>
  );
}
