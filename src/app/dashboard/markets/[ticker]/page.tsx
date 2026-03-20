import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";
import { PriceChart } from "@/components/charts/price-chart";
import { PredictionCard } from "@/components/predictions/prediction-card";
import { notFound } from "next/navigation";
import type { Market, Event, Prediction, PaperTrade, PriceSnapshot } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const supabase = createServerClient();

  const [marketRes, predictionsRes, snapshotsRes, tradesRes] =
    await Promise.all([
      supabase.from("markets").select("*").eq("ticker", ticker).single(),
      supabase
        .from("predictions")
        .select("*")
        .eq("ticker", ticker)
        .order("created_at", { ascending: false }),
      supabase
        .from("price_snapshots")
        .select("*")
        .eq("ticker", ticker)
        .order("snapshot_at", { ascending: true }),
      supabase
        .from("paper_trades")
        .select("*")
        .eq("ticker", ticker)
        .order("created_at", { ascending: false }),
    ]);

  const market: Market | null = marketRes.data;
  if (!market) {
    notFound();
  }

  // Fetch event info
  const { data: event } = await supabase
    .from("events")
    .select("*")
    .eq("event_ticker", market.event_ticker)
    .single();

  const predictions: Prediction[] = predictionsRes.data ?? [];
  const snapshots: PriceSnapshot[] = snapshotsRes.data ?? [];
  const trades: PaperTrade[] = tradesRes.data ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="font-mono text-sm text-muted-foreground">{ticker}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {market.title}
        </h1>
        {event && (
          <p className="mt-1 text-sm text-muted-foreground">
            Event: {event.title}
            {event.category && (
              <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-xs">
                {event.category}
              </span>
            )}
          </p>
        )}
      </div>

      {/* Market Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Last Price</p>
          <p className="mt-1 font-mono text-xl font-semibold">
            {market.last_price != null
              ? `${market.last_price}\u00a2`
              : "\u2014"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Bid / Ask</p>
          <p className="mt-1 font-mono text-xl font-semibold">
            {market.yes_bid != null && market.yes_ask != null
              ? `${market.yes_bid}\u00a2 / ${market.yes_ask}\u00a2`
              : "\u2014"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Volume</p>
          <p className="mt-1 font-mono text-xl font-semibold">
            {market.volume?.toLocaleString() ?? "\u2014"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Close Time</p>
          <p className="mt-1 text-sm font-medium">
            {market.close_time ? formatDate(market.close_time) : "\u2014"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Status</p>
          <p className="mt-1">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                market.status === "open"
                  ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {market.status}
            </span>
          </p>
        </div>
      </div>

      {/* Price Chart */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Price History</h2>
        <PriceChart snapshots={snapshots} />
      </div>

      {/* Predictions */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Predictions</h2>
        {predictions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No predictions for this market yet.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {predictions.map((pred) => (
              <PredictionCard key={pred.id} prediction={pred} />
            ))}
          </div>
        )}
      </div>

      {/* Trade History */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Trade History</h2>
        {trades.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No trades for this market yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">Side</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Qty</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Price</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Cost</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">P&L</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr
                    key={trade.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={
                          trade.side === "yes"
                            ? "rounded bg-[color:var(--success)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--success)]"
                            : "rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
                        }
                      >
                        {trade.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {trade.quantity}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {(trade.price * 100).toFixed(0)}&cent;
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatCurrency(trade.cost)}
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
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          trade.status === "open"
                            ? "bg-[color:var(--success)]/15 text-[color:var(--success)]"
                            : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {trade.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(trade.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
