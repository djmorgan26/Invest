import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";
import { parseTicker } from "@/lib/ticker-utils";
import { PnlValue } from "@/components/ui/pnl-value";
import { SideBadge } from "@/components/ui/side-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroChart } from "@/components/dashboard/hero-chart";
import { PositionCard } from "@/components/dashboard/position-card";
import { StrategyMiniCard } from "@/components/dashboard/strategy-mini-card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { Prediction } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createServerClient();

  const [
    portfolioRes,
    portfolioHistoryRes,
    openTradesRes,
    openTradeDataRes,
    predictionsRes,
    recentPredictionsRes,
    strategiesRes,
    strategyTradesRes,
    marketsRes,
  ] = await Promise.all([
    supabase
      .from("portfolio_snapshots")
      .select("*")
      .order("snapshot_at", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("portfolio_snapshots")
      .select("snapshot_at, total_value")
      .order("snapshot_at", { ascending: true })
      .limit(200),
    supabase
      .from("paper_trades")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    supabase
      .from("paper_trades")
      .select("id, ticker, side, quantity, price, cost, strategy_id")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("predictions")
      .select("status")
      .in("status", ["correct", "incorrect"]),
    supabase
      .from("predictions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("strategies").select("id, name, enabled"),
    supabase
      .from("paper_trades")
      .select("strategy_id, status, pnl")
      .eq("status", "closed"),
    supabase
      .from("markets")
      .select("ticker, title, last_price, close_time, event_ticker")
      .limit(5000),
  ]);

  const portfolio = portfolioRes.data;
  const portfolioHistory = portfolioHistoryRes.data ?? [];
  const openTradesCount = openTradesRes.count ?? 0;
  const openTradeData = openTradeDataRes.data ?? [];
  const resolvedPredictions = predictionsRes.data ?? [];
  const correctCount = resolvedPredictions.filter(
    (p) => p.status === "correct"
  ).length;
  const totalResolved = resolvedPredictions.length;
  const winRate = totalResolved > 0 ? correctCount / totalResolved : 0;
  const recentPredictions: Prediction[] = recentPredictionsRes.data ?? [];

  const strategies = strategiesRes.data ?? [];
  const strategyTrades = strategyTradesRes.data ?? [];
  const allMarkets = marketsRes.data ?? [];
  const marketMap = new Map(allMarkets.map((m) => [m.ticker, m]));
  const strategyMap = new Map(strategies.map((s) => [s.id, s]));

  // Fetch events for categories
  const eventTickers = [
    ...new Set(allMarkets.map((m) => m.event_ticker).filter(Boolean)),
  ];
  const eventsRes =
    eventTickers.length > 0
      ? await supabase
          .from("events")
          .select("event_ticker, title, category")
          .in("event_ticker", eventTickers)
      : { data: [] };
  const eventMap = new Map(
    (eventsRes.data ?? []).map((e) => [e.event_ticker, e])
  );

  const strategyStats = strategies.map((s) => {
    const closed = strategyTrades.filter((t) => t.strategy_id === s.id);
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    return {
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      trades: closed.length,
      wins,
      win_rate: closed.length > 0 ? wins / closed.length : null,
      pnl: totalPnl,
    };
  });

  const totalPnl = portfolio ? portfolio.total_value - 10000 : 0;

  // Enrich open positions with market, event, and strategy data
  const enrichedOpen = openTradeData.map((t) => {
    const market = marketMap.get(t.ticker);
    const event = market?.event_ticker
      ? eventMap.get(market.event_ticker)
      : null;
    const strategy = t.strategy_id
      ? strategyMap.get(t.strategy_id)
      : null;
    const currentPrice =
      market?.last_price != null ? market.last_price / 100 : null;
    const unrealized =
      currentPrice != null
        ? t.side === "yes"
          ? (currentPrice - t.price) * t.quantity
          : (t.price - currentPrice) * t.quantity
        : null;
    return {
      ...t,
      title: market?.title ?? null,
      currentPrice,
      unrealized,
      category: event?.category ?? null,
      closeTime: market?.close_time ?? null,
      strategyName: strategy?.name ?? null,
    };
  });

  // Enrich recent predictions with market titles
  const enrichedPredictions = recentPredictions.map((pred) => {
    const market = marketMap.get(pred.ticker);
    const event = market?.event_ticker
      ? eventMap.get(market.event_ticker)
      : null;
    return {
      ...pred,
      marketTitle: market?.title ?? null,
      category: event?.category ?? null,
    };
  });

  const hasData = portfolio !== null;

  return (
    <div className="space-y-6">
      {/* Hero: Portfolio value + change */}
      <div>
        <p className="text-sm text-muted-foreground">Portfolio Value</p>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-5xl font-bold font-mono tracking-tight">
            {hasData
              ? formatCurrency(portfolio.total_value)
              : "$10,000.00"}
          </span>
          {hasData && totalPnl !== 0 && (
            <PnlValue value={totalPnl} size="lg" format={formatCurrency} />
          )}
        </div>
      </div>

      {/* Hero chart */}
      <HeroChart snapshots={portfolioHistory} />

      {/* Quick stats row */}
      <div className="flex flex-wrap gap-4">
        <QuickStat
          label="Win Rate"
          value={totalResolved > 0 ? formatPercent(winRate) : "N/A"}
        />
        <QuickStat label="Open Trades" value={openTradesCount.toString()} />
        <QuickStat
          label="Unrealized"
          value={
            hasData
              ? formatCurrency(portfolio.unrealized_pnl)
              : "$0.00"
          }
          pnl={hasData ? portfolio.unrealized_pnl : 0}
        />
        <QuickStat
          label="Cash"
          value={hasData ? formatCurrency(portfolio.cash) : "$10,000.00"}
        />
      </div>

      {/* Active positions strip */}
      {enrichedOpen.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Open Positions
          </h2>
          <ScrollArea className="w-full">
            <div className="flex gap-3 pb-2">
              {enrichedOpen.map((trade) => (
                <PositionCard
                  key={trade.id}
                  ticker={trade.ticker}
                  title={trade.title}
                  side={trade.side}
                  entryPrice={trade.price}
                  currentPrice={trade.currentPrice}
                  quantity={trade.quantity}
                  unrealizedPnl={trade.unrealized}
                  category={trade.category}
                  closeTime={trade.closeTime}
                  cost={trade.cost}
                  strategyName={trade.strategyName}
                />
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </section>
      )}

      {/* Strategy performance mini cards */}
      {strategies.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Strategies
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {strategyStats.map((s) => (
              <StrategyMiniCard
                key={s.id}
                name={s.name}
                enabled={s.enabled}
                trades={s.trades}
                winRate={s.win_rate}
                pnl={s.pnl}
              />
            ))}
          </div>
        </section>
      )}

      {/* Recent predictions — enriched with market titles */}
      {enrichedPredictions.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Recent Predictions
          </h2>
          <div className="space-y-2">
            {enrichedPredictions.map((pred) => {
              const parsed = parseTicker(pred.ticker);
              const displayTitle =
                pred.marketTitle &&
                pred.marketTitle !== pred.ticker &&
                !pred.marketTitle.startsWith("KX")
                  ? pred.marketTitle
                  : parsed.summary;

              return (
                <div
                  key={pred.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-card-hover"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {displayTitle}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {pred.category && (
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {pred.category}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatDate(pred.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <SideBadge side={pred.side} />
                    <span className="font-mono text-sm">
                      {formatPercent(pred.confidence)}
                    </span>
                    <StatusBadge status={pred.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!hasData && strategies.length === 0 && (
        <EmptyState message="No portfolio data yet. Run sync-markets to get started." />
      )}
    </div>
  );
}

function QuickStat({
  label,
  value,
  pnl,
}: {
  label: string;
  value: string;
  pnl?: number;
}) {
  return (
    <div className="rounded-lg bg-secondary/50 px-4 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`font-mono text-sm font-semibold ${
          pnl != null && pnl > 0
            ? "text-success"
            : pnl != null && pnl < 0
              ? "text-destructive"
              : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-warning/15 text-warning",
    correct: "bg-success/15 text-success",
    incorrect: "bg-destructive/15 text-destructive",
    expired: "bg-secondary text-muted-foreground",
  };

  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.expired}`}
    >
      {status}
    </span>
  );
}
