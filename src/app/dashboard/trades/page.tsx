import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";
import { StatCard } from "@/components/ui/stat-card";
import type {
  PaperTrade,
  Market,
  Event,
  Prediction,
  StrategyRow,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// ── Helper Components ────────────────────────────────────────────────

function SideBadge({ side }: { side: "yes" | "no" }) {
  return (
    <span
      className={
        side === "yes"
          ? "rounded bg-[color:var(--success)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--success)]"
          : "rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
      }
    >
      {side.toUpperCase()}
    </span>
  );
}

function CategoryPill({ category }: { category: string | null }) {
  if (!category) return null;
  return (
    <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      {category}
    </span>
  );
}

function StrategyPill({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
      {name}
    </span>
  );
}

function PriceBar({ entry, current }: { entry: number; current: number | null }) {
  const entryPct = Math.min(Math.max(entry * 100, 0), 100);
  const currentPct = current != null ? Math.min(Math.max(current * 100, 0), 100) : null;

  return (
    <div className="relative h-2 w-full rounded-full bg-secondary">
      {currentPct != null && (
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary/60"
          style={{ width: `${currentPct}%` }}
        />
      )}
      <div
        className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
        style={{ left: `${entryPct}%` }}
        title={`Entry: ${entryPct.toFixed(0)}¢`}
      />
    </div>
  );
}

function ResultBadge({ pnl, status }: { pnl: number | null; status: string }) {
  if (status === "expired") {
    return (
      <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Expired
      </span>
    );
  }
  if (pnl == null) {
    return (
      <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
        —
      </span>
    );
  }
  if (pnl === 0) {
    return (
      <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Break Even
      </span>
    );
  }
  return pnl > 0 ? (
    <span className="rounded bg-[color:var(--success)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--success)]">
      Won
    </span>
  ) : (
    <span className="rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
      Lost
    </span>
  );
}

// ── Types ────────────────────────────────────────────────────────────

interface EnrichedTrade extends PaperTrade {
  market_title: string | null;
  event_category: string | null;
  current_price: number | null;
  close_time: string | null;
  strategy_name: string | null;
  prediction_reasoning: string | null;
  prediction_confidence: number | null;
  prediction_fair_value: number | null;
}

// ── Page ─────────────────────────────────────────────────────────────

export default async function TradesPage() {
  const supabase = createServerClient();

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

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Exposure"
          value={formatCurrency(totalExposure)}
          change={
            openTrades.length > 0
              ? {
                  value: `${openTrades.length} open position${openTrades.length !== 1 ? "s" : ""}`,
                  positive: true,
                }
              : undefined
          }
        />
        <StatCard
          title="Unrealized P&L"
          value={formatCurrency(unrealizedPnl)}
          change={
            unrealizedPnl !== 0
              ? {
                  value: formatCurrency(Math.abs(unrealizedPnl)),
                  positive: unrealizedPnl > 0,
                }
              : undefined
          }
        />
        <StatCard
          title="Realized P&L"
          value={formatCurrency(realizedPnl)}
          change={
            resolvedCount > 0
              ? {
                  value: `${wins}W / ${losses}L`,
                  positive: realizedPnl >= 0,
                }
              : undefined
          }
        />
        <StatCard
          title="Win Rate"
          value={resolvedCount > 0 ? `${(winRate * 100).toFixed(1)}%` : "N/A"}
          change={
            resolvedCount > 0
              ? {
                  value: `${resolvedCount} resolved`,
                  positive: winRate >= 0.5,
                }
              : undefined
          }
        />
      </div>

      {/* Open Positions — Card Grid */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">
          Open Positions
          {openTrades.length > 0 && (
            <span className="ml-2 rounded-full bg-secondary px-2.5 py-0.5 text-sm font-normal text-muted-foreground">
              {openTrades.length}
            </span>
          )}
        </h2>
        {openTrades.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No open positions. Trades are created automatically when
              predictions have sufficient edge.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {openTrades.map((trade) => {
              const unrealized =
                trade.current_price != null
                  ? trade.side === "yes"
                    ? (trade.current_price - trade.price) * trade.quantity
                    : (trade.price - trade.current_price) * trade.quantity
                  : null;

              return (
                <Link
                  key={trade.id}
                  href={`/dashboard/markets/${trade.ticker}`}
                  className="group rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40"
                >
                  {/* Top row: category + strategy pills */}
                  <div className="flex items-center justify-between gap-2">
                    <CategoryPill category={trade.event_category} />
                    <StrategyPill name={trade.strategy_name} />
                  </div>

                  {/* Market title + side */}
                  <div className="mt-3 flex items-start justify-between gap-3">
                    <h3 className="text-sm font-medium leading-snug">
                      {trade.market_title ?? trade.ticker}
                    </h3>
                    <SideBadge side={trade.side} />
                  </div>

                  {/* Metrics grid */}
                  <div className="mt-4 grid grid-cols-4 gap-3 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Entry</p>
                      <p className="mt-0.5 font-mono text-sm font-medium">
                        {(trade.price * 100).toFixed(0)}&cent;
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Current</p>
                      <p className="mt-0.5 font-mono text-sm font-medium">
                        {trade.current_price != null
                          ? `${(trade.current_price * 100).toFixed(0)}\u00a2`
                          : "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Qty</p>
                      <p className="mt-0.5 font-mono text-sm font-medium">
                        {trade.quantity}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Unrealized
                      </p>
                      <p
                        className={`mt-0.5 font-mono text-sm font-medium ${
                          unrealized == null
                            ? ""
                            : unrealized >= 0
                              ? "text-[color:var(--success)]"
                              : "text-destructive"
                        }`}
                      >
                        {unrealized != null
                          ? `${unrealized >= 0 ? "+" : ""}${formatCurrency(unrealized)}`
                          : "N/A"}
                      </p>
                    </div>
                  </div>

                  {/* Price bar */}
                  <div className="mt-4">
                    <PriceBar
                      entry={trade.price}
                      current={trade.current_price}
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                      <span>0¢</span>
                      <span>
                        {trade.current_price != null
                          ? `${(trade.current_price * 100).toFixed(0)}/100`
                          : "—"}
                      </span>
                      <span>100¢</span>
                    </div>
                  </div>

                  {/* Footer: dates + reasoning */}
                  <div className="mt-3 space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {trade.close_time && (
                        <>
                          Closes{" "}
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                          }).format(new Date(trade.close_time))}
                          {" \u00b7 "}
                        </>
                      )}
                      Opened{" "}
                      {new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                      }).format(new Date(trade.created_at))}
                    </p>
                    {trade.prediction_reasoning && (
                      <p className="line-clamp-2 text-xs italic text-muted-foreground">
                        &ldquo;{trade.prediction_reasoning}&rdquo;
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Trade History — Enhanced Table */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Trade History
            {closedTrades.length > 0 && (
              <span className="ml-2 rounded-full bg-secondary px-2.5 py-0.5 text-sm font-normal text-muted-foreground">
                {closedTrades.length}
              </span>
            )}
          </h2>
          {closedTrades.length > 0 && (
            <p className="text-sm">
              Total P&L:{" "}
              <span
                className={`font-mono font-medium ${
                  realizedPnl >= 0
                    ? "text-[color:var(--success)]"
                    : "text-destructive"
                }`}
              >
                {realizedPnl >= 0 ? "+" : ""}
                {formatCurrency(realizedPnl)}
              </span>
            </p>
          )}
        </div>
        {closedTrades.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No completed trades yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Market
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Category
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Side
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Strategy
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Entry / Exit
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    P&L
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Result
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Closed
                  </th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.map((trade) => (
                  <tr
                    key={trade.id}
                    className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="max-w-[200px]">
                        <p className="truncate text-sm font-medium">
                          {trade.market_title ?? trade.ticker}
                        </p>
                        {trade.market_title && (
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {trade.ticker}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <CategoryPill category={trade.event_category} />
                    </td>
                    <td className="px-4 py-3">
                      <SideBadge side={trade.side} />
                    </td>
                    <td className="px-4 py-3">
                      <StrategyPill name={trade.strategy_name} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {(trade.price * 100).toFixed(0)}&cent;
                      {" / "}
                      {trade.exit_price != null
                        ? `${(trade.exit_price * 100).toFixed(0)}\u00a2`
                        : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {trade.pnl != null ? (
                        <span
                          className={
                            trade.pnl >= 0
                              ? "text-[color:var(--success)]"
                              : "text-destructive"
                          }
                        >
                          {trade.pnl >= 0 ? "+" : ""}
                          {formatCurrency(trade.pnl)}
                        </span>
                      ) : (
                        "\u2014"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ResultBadge pnl={trade.pnl} status={trade.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {trade.closed_at
                        ? formatDate(trade.closed_at)
                        : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
