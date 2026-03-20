"use client";

import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SideBadge } from "@/components/ui/side-badge";
import { CategoryPill } from "@/components/ui/category-pill";
import { StrategyPill } from "@/components/ui/strategy-pill";
import { PnlValue } from "@/components/ui/pnl-value";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PaperTrade } from "@/lib/supabase/types";

// ── Types ────────────────────────────────────────────────────────────

export interface EnrichedTrade extends PaperTrade {
  market_title: string | null;
  event_category: string | null;
  current_price: number | null;
  close_time: string | null;
  strategy_name: string | null;
  prediction_reasoning: string | null;
  prediction_confidence: number | null;
  prediction_fair_value: number | null;
}

// ── Inline Components ────────────────────────────────────────────────

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
        title={`Entry: ${entryPct.toFixed(0)}\u00a2`}
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
        &mdash;
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
    <span className="rounded bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
      Won
    </span>
  ) : (
    <span className="rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
      Lost
    </span>
  );
}

// ── Open Positions Card Grid ─────────────────────────────────────────

function OpenPositions({ trades }: { trades: EnrichedTrade[] }) {
  if (trades.length === 0) {
    return (
      <EmptyState message="No open positions. Trades are created automatically when predictions have sufficient edge." />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {trades.map((trade) => {
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
                <p className="text-xs text-muted-foreground">Unrealized</p>
                {unrealized != null ? (
                  <PnlValue value={unrealized} size="sm" className="mt-0.5" />
                ) : (
                  <p className="mt-0.5 font-mono text-sm font-medium">N/A</p>
                )}
              </div>
            </div>

            {/* Price bar */}
            <div className="mt-4">
              <PriceBar entry={trade.price} current={trade.current_price} />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>0&cent;</span>
                <span>
                  {trade.current_price != null
                    ? `${(trade.current_price * 100).toFixed(0)}/100`
                    : "\u2014"}
                </span>
                <span>100&cent;</span>
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
  );
}

// ── Closed Trades Table ──────────────────────────────────────────────

function ClosedTradesTable({
  trades,
  realizedPnl,
}: {
  trades: EnrichedTrade[];
  realizedPnl: number;
}) {
  if (trades.length === 0) {
    return <EmptyState message="No completed trades yet." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <p className="text-sm">
          Total P&L:{" "}
          <PnlValue value={realizedPnl} size="sm" />
        </p>
      </div>
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-card">
              <TableHead>Market</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead className="text-right">Entry / Exit</TableHead>
              <TableHead className="text-right">P&L</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Closed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((trade) => (
              <TableRow key={trade.id}>
                <TableCell>
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
                </TableCell>
                <TableCell>
                  <CategoryPill category={trade.event_category} />
                </TableCell>
                <TableCell>
                  <SideBadge side={trade.side} />
                </TableCell>
                <TableCell>
                  <StrategyPill name={trade.strategy_name} />
                </TableCell>
                <TableCell className="text-right font-mono">
                  {(trade.price * 100).toFixed(0)}&cent;
                  {" / "}
                  {trade.exit_price != null
                    ? `${(trade.exit_price * 100).toFixed(0)}\u00a2`
                    : "\u2014"}
                </TableCell>
                <TableCell className="text-right">
                  {trade.pnl != null ? (
                    <PnlValue value={trade.pnl} size="sm" />
                  ) : (
                    <span className="font-mono">&mdash;</span>
                  )}
                </TableCell>
                <TableCell>
                  <ResultBadge pnl={trade.pnl} status={trade.status} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {trade.closed_at ? formatDate(trade.closed_at) : "\u2014"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── All Trades Table ─────────────────────────────────────────────────

function AllTradesTable({ trades }: { trades: EnrichedTrade[] }) {
  if (trades.length === 0) {
    return <EmptyState message="No trades yet." />;
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-card">
            <TableHead>Market</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Side</TableHead>
            <TableHead>Strategy</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Entry</TableHead>
            <TableHead className="text-right">P&L</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => (
            <TableRow key={trade.id}>
              <TableCell>
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
              </TableCell>
              <TableCell>
                <CategoryPill category={trade.event_category} />
              </TableCell>
              <TableCell>
                <SideBadge side={trade.side} />
              </TableCell>
              <TableCell>
                <StrategyPill name={trade.strategy_name} />
              </TableCell>
              <TableCell>
                <span
                  className={
                    trade.status === "open"
                      ? "rounded bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
                      : "rounded bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  }
                >
                  {trade.status.charAt(0).toUpperCase() + trade.status.slice(1)}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono">
                {(trade.price * 100).toFixed(0)}&cent;
              </TableCell>
              <TableCell className="text-right">
                {trade.pnl != null ? (
                  <PnlValue value={trade.pnl} size="sm" />
                ) : trade.status === "open" && trade.current_price != null ? (
                  <PnlValue
                    value={
                      trade.side === "yes"
                        ? (trade.current_price - trade.price) * trade.quantity
                        : (trade.price - trade.current_price) * trade.quantity
                    }
                    size="sm"
                  />
                ) : (
                  <span className="font-mono text-muted-foreground">&mdash;</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(trade.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Main Tabs Component ──────────────────────────────────────────────

interface TradeTabsProps {
  enrichedTrades: EnrichedTrade[];
  openTrades: EnrichedTrade[];
  closedTrades: EnrichedTrade[];
  realizedPnl: number;
}

export function TradeTabs({
  enrichedTrades,
  openTrades,
  closedTrades,
  realizedPnl,
}: TradeTabsProps) {
  return (
    <Tabs defaultValue="open">
      <TabsList>
        <TabsTrigger value="open">
          Open
          {openTrades.length > 0 && (
            <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {openTrades.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="closed">
          Closed
          {closedTrades.length > 0 && (
            <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {closedTrades.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="all">
          All
          {enrichedTrades.length > 0 && (
            <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {enrichedTrades.length}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="open">
        <OpenPositions trades={openTrades} />
      </TabsContent>

      <TabsContent value="closed">
        <ClosedTradesTable trades={closedTrades} realizedPnl={realizedPnl} />
      </TabsContent>

      <TabsContent value="all">
        <AllTradesTable trades={enrichedTrades} />
      </TabsContent>
    </Tabs>
  );
}
