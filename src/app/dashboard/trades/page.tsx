import { createServerClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { PaperTrade } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function TradesPage() {
  const supabase = createServerClient();

  const { data: allTrades } = await supabase
    .from("paper_trades")
    .select("*")
    .order("created_at", { ascending: false });

  const trades: PaperTrade[] = allTrades ?? [];
  const openTrades = trades.filter((t) => t.status === "open");
  const closedTrades = trades.filter(
    (t) => t.status === "closed" || t.status === "expired"
  );

  const totalRealizedPnl = closedTrades.reduce(
    (sum, t) => sum + (t.pnl ?? 0),
    0
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trades</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paper trading positions and history
        </p>
      </div>

      {/* Open Positions */}
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
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Ticker
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Side
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Qty
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Entry Price
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Cost
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Opened
                  </th>
                </tr>
              </thead>
              <tbody>
                {openTrades.map((trade) => (
                  <tr
                    key={trade.id}
                    className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono font-medium">
                      {trade.ticker}
                    </td>
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
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(trade.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Trade History */}
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
                  totalRealizedPnl >= 0
                    ? "text-[color:var(--success)]"
                    : "text-destructive"
                }`}
              >
                {totalRealizedPnl >= 0 ? "+" : ""}
                {formatCurrency(totalRealizedPnl)}
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
                    Ticker
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Side
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Qty
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Entry
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Exit
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    P&L
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Status
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
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3 font-mono font-medium">
                      {trade.ticker}
                    </td>
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
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {trade.status}
                      </span>
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
