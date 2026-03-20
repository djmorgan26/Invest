import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";
import { StatCard } from "@/components/ui/stat-card";
import { ChartsSection } from "@/components/predictions/charts-section";
import { Backtester } from "@/components/predictions/backtester";
import type {
  Prediction,
  Market,
  Event,
  StrategyRow,
  PaperTrade,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// ── Types ────────────────────────────────────────────────────────────

interface EnrichedPrediction {
  id: string;
  ticker: string;
  side: "yes" | "no";
  confidence: number;
  fair_value: number;
  edge: number;
  reasoning: string;
  status: string;
  strategy_id: string | null;
  created_at: string;
  resolved_at: string | null;
  market_title: string | null;
  event_category: string | null;
  current_price: number | null;
  close_time: string | null;
  strategy_name: string | null;
  trade_pnl: number | null;
  trade_status: string | null;
}

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

function StatusBadge({ status }: { status: string }) {
  if (status === "correct") {
    return (
      <span className="rounded bg-[color:var(--success)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--success)]">
        Correct
      </span>
    );
  }
  if (status === "incorrect") {
    return (
      <span className="rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
        Incorrect
      </span>
    );
  }
  return (
    <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Expired
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default async function PredictionsPage() {
  const supabase = createServerClient();

  // 1. Fetch all predictions
  const { data: allPredictions } = await supabase
    .from("predictions")
    .select("*")
    .order("created_at", { ascending: false });

  const predictions: Prediction[] = allPredictions ?? [];

  // 2. Collect unique foreign keys
  const uniqueTickers = [...new Set(predictions.map((p) => p.ticker))];
  const predictionIds = predictions.map((p) => p.id);
  const strategyIds = [
    ...new Set(predictions.map((p) => p.strategy_id).filter(Boolean)),
  ] as string[];

  // 3. Parallel fetches for enrichment data
  const [marketsRes, strategiesRes, tradesRes] = await Promise.all([
    uniqueTickers.length > 0
      ? supabase
          .from("markets")
          .select("ticker, title, last_price, close_time, event_ticker")
          .in("ticker", uniqueTickers)
      : Promise.resolve({ data: [] as Market[] }),
    strategyIds.length > 0
      ? supabase
          .from("strategies")
          .select("id, name")
          .in("id", strategyIds)
      : Promise.resolve({ data: [] as StrategyRow[] }),
    predictionIds.length > 0
      ? supabase
          .from("paper_trades")
          .select("id, prediction_id, pnl, status, strategy_id, created_at, closed_at")
          .in("prediction_id", predictionIds)
      : Promise.resolve({ data: [] as PaperTrade[] }),
  ]);

  const markets = (marketsRes.data ?? []) as Pick<
    Market,
    "ticker" | "title" | "last_price" | "close_time" | "event_ticker"
  >[];
  const strategies = (strategiesRes.data ?? []) as Pick<
    StrategyRow,
    "id" | "name"
  >[];
  const trades = (tradesRes.data ?? []) as Pick<
    PaperTrade,
    "id" | "prediction_id" | "pnl" | "status" | "strategy_id" | "created_at" | "closed_at"
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
  const strategyMap = new Map(strategies.map((s) => [s.id, s]));
  const tradeMap = new Map(
    trades.map((t) => [t.prediction_id, t])
  );

  // 6. Enrich predictions
  const enrichedPredictions: EnrichedPrediction[] = predictions.map(
    (prediction) => {
      const market = marketMap.get(prediction.ticker);
      const event = market ? eventMap.get(market.event_ticker) : null;
      const strategy = prediction.strategy_id
        ? strategyMap.get(prediction.strategy_id)
        : null;
      const trade = tradeMap.get(prediction.id);

      return {
        ...prediction,
        market_title: market?.title ?? null,
        event_category: event?.category ?? null,
        current_price:
          market?.last_price != null ? market.last_price / 100 : null,
        close_time: market?.close_time ?? null,
        strategy_name: strategy?.name ?? null,
        trade_pnl: trade?.pnl ?? null,
        trade_status: trade?.status ?? null,
      };
    }
  );

  const pendingPredictions = enrichedPredictions.filter(
    (p) => p.status === "pending"
  );
  const resolvedPredictions = enrichedPredictions.filter(
    (p) => p.status !== "pending"
  );

  // 7. Compute stats
  const totalCount = predictions.length;
  const pendingCount = pendingPredictions.length;
  const correctCount = resolvedPredictions.filter(
    (p) => p.status === "correct"
  ).length;
  const incorrectCount = resolvedPredictions.filter(
    (p) => p.status === "incorrect"
  ).length;
  const resolvedCount = correctCount + incorrectCount;
  const accuracy = resolvedCount > 0 ? correctCount / resolvedCount : 0;

  const avgEdge =
    totalCount > 0
      ? predictions.reduce((sum, p) => sum + p.edge, 0) / totalCount
      : 0;
  const avgConfidence =
    totalCount > 0
      ? predictions.reduce((sum, p) => sum + p.confidence, 0) / totalCount
      : 0;

  const tradedCount = enrichedPredictions.filter(
    (p) => p.trade_status != null
  ).length;
  const tradedRate = totalCount > 0 ? tradedCount / totalCount : 0;

  // Prediction-linked trades for charts (narrow prediction_id to non-null)
  const predictionTrades = trades
    .filter((t): t is typeof t & { prediction_id: string } => t.prediction_id != null);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Predictions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          AI-generated market predictions and analysis
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Predictions"
          value={totalCount.toString()}
          change={
            pendingCount > 0
              ? {
                  value: `${pendingCount} pending`,
                  positive: true,
                }
              : undefined
          }
        />
        <StatCard
          title="Accuracy"
          value={resolvedCount > 0 ? `${(accuracy * 100).toFixed(1)}%` : "N/A"}
          change={
            resolvedCount > 0
              ? {
                  value: `${resolvedCount} resolved`,
                  positive: accuracy >= 0.5,
                }
              : undefined
          }
        />
        <StatCard
          title="Avg Edge"
          value={
            totalCount > 0
              ? `${(avgEdge * 100).toFixed(1)}\u00a2`
              : "N/A"
          }
          change={
            totalCount > 0
              ? {
                  value: `${(avgConfidence * 100).toFixed(1)}% avg confidence`,
                  positive: avgConfidence >= 0.5,
                }
              : undefined
          }
        />
        <StatCard
          title="Traded Rate"
          value={
            totalCount > 0 ? `${(tradedRate * 100).toFixed(1)}%` : "N/A"
          }
          change={
            tradedCount > 0
              ? {
                  value: `${tradedCount} traded`,
                  positive: true,
                }
              : undefined
          }
        />
      </div>

      {/* Pending Predictions — Card Grid */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">
          Pending Predictions
          {pendingPredictions.length > 0 && (
            <span className="ml-2 rounded-full bg-secondary px-2.5 py-0.5 text-sm font-normal text-muted-foreground">
              {pendingPredictions.length}
            </span>
          )}
        </h2>
        {pendingPredictions.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No pending predictions. Run the prediction pipeline to generate
              market analysis.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {pendingPredictions.map((prediction) => (
              <Link
                key={prediction.id}
                href={`/dashboard/markets/${prediction.ticker}`}
                className="group rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40"
              >
                {/* Top row: category + strategy pills */}
                <div className="flex items-center justify-between gap-2">
                  <CategoryPill category={prediction.event_category} />
                  <StrategyPill name={prediction.strategy_name} />
                </div>

                {/* Market title + side */}
                <div className="mt-3 flex items-start justify-between gap-3">
                  <h3 className="text-sm font-medium leading-snug">
                    {prediction.market_title ?? prediction.ticker}
                  </h3>
                  <SideBadge side={prediction.side} />
                </div>

                {/* Metrics grid */}
                <div className="mt-4 grid grid-cols-4 gap-3 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Confidence</p>
                    <p className="mt-0.5 font-mono text-sm font-medium">
                      {(prediction.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Fair Value</p>
                    <p className="mt-0.5 font-mono text-sm font-medium">
                      {(prediction.fair_value * 100).toFixed(0)}&cent;
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Current</p>
                    <p className="mt-0.5 font-mono text-sm font-medium">
                      {prediction.current_price != null
                        ? `${(prediction.current_price * 100).toFixed(0)}\u00a2`
                        : "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Edge</p>
                    <p
                      className={`mt-0.5 font-mono text-sm font-medium ${
                        prediction.edge >= 0
                          ? "text-[color:var(--success)]"
                          : "text-destructive"
                      }`}
                    >
                      {(prediction.edge * 100).toFixed(1)}&cent;
                    </p>
                  </div>
                </div>

                {/* Footer: dates + traded badge */}
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {prediction.close_time && (
                      <>
                        Closes{" "}
                        {new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                        }).format(new Date(prediction.close_time))}
                        {" \u00b7 "}
                      </>
                    )}
                    Created{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                    }).format(new Date(prediction.created_at))}
                  </p>
                  {prediction.trade_status && (
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Traded
                    </span>
                  )}
                </div>

                {/* Reasoning */}
                {prediction.reasoning && (
                  <p className="mt-2 line-clamp-2 text-xs italic text-muted-foreground">
                    &ldquo;{prediction.reasoning}&rdquo;
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Resolved History — Table */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Resolved History
            {resolvedPredictions.length > 0 && (
              <span className="ml-2 rounded-full bg-secondary px-2.5 py-0.5 text-sm font-normal text-muted-foreground">
                {resolvedPredictions.length}
              </span>
            )}
          </h2>
          {resolvedCount > 0 && (
            <p className="text-sm">
              Accuracy:{" "}
              <span
                className={`font-mono font-medium ${
                  accuracy >= 0.5
                    ? "text-[color:var(--success)]"
                    : "text-destructive"
                }`}
              >
                {(accuracy * 100).toFixed(1)}%
              </span>
            </p>
          )}
        </div>
        {resolvedPredictions.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No resolved predictions yet.
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
                    Fair Value / Price
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Edge
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Result
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Trade P&L
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Resolved
                  </th>
                </tr>
              </thead>
              <tbody>
                {resolvedPredictions.map((prediction) => (
                  <tr
                    key={prediction.id}
                    className="border-b border-border last:border-0 transition-colors hover:bg-accent/50"
                  >
                    <td className="px-4 py-3">
                      <div className="max-w-[200px]">
                        <p className="truncate text-sm font-medium">
                          {prediction.market_title ?? prediction.ticker}
                        </p>
                        {prediction.market_title && (
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {prediction.ticker}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <CategoryPill category={prediction.event_category} />
                    </td>
                    <td className="px-4 py-3">
                      <SideBadge side={prediction.side} />
                    </td>
                    <td className="px-4 py-3">
                      <StrategyPill name={prediction.strategy_name} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {(prediction.fair_value * 100).toFixed(0)}&cent;
                      {" / "}
                      {prediction.current_price != null
                        ? `${(prediction.current_price * 100).toFixed(0)}\u00a2`
                        : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      <span
                        className={
                          prediction.edge >= 0
                            ? "text-[color:var(--success)]"
                            : "text-destructive"
                        }
                      >
                        {(prediction.edge * 100).toFixed(1)}&cent;
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={prediction.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {prediction.trade_pnl != null ? (
                        <span
                          className={
                            prediction.trade_pnl >= 0
                              ? "text-[color:var(--success)]"
                              : "text-destructive"
                          }
                        >
                          {prediction.trade_pnl >= 0 ? "+" : ""}
                          {formatCurrency(prediction.trade_pnl)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {prediction.resolved_at
                        ? formatDate(prediction.resolved_at)
                        : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Charts */}
      <ChartsSection
        predictions={enrichedPredictions}
        trades={predictionTrades}
      />

      {/* Backtester */}
      <Backtester strategies={strategies} />
    </div>
  );
}
