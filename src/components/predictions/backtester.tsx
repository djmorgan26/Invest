"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { BacktestResult } from "@/lib/strategies/backtester";
import { isDemoModeClient } from "@/lib/demo/client";
import { buildDemoBacktest } from "@/lib/demo/fixtures";

interface BacktesterProps {
  strategies: { id: string; name: string }[];
}

const PERIODS = [
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "all", label: "ALL" },
];

export function Backtester({ strategies }: BacktesterProps) {
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>(
    strategies.map((s) => s.id)
  );
  const [period, setPeriod] = useState("all");
  const [budget, setBudget] = useState(10000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [showTradeLog, setShowTradeLog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleStrategyToggle(id: string) {
    setSelectedStrategies((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleSimulate() {
    if (selectedStrategies.length === 0) return;

    setLoading(true);
    setError(null);
    setResult(null);

    // Demo mode: serve a simulated backtest result client-side (no API call).
    if (isDemoModeClient()) {
      setResult(buildDemoBacktest(budget));
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategies: selectedStrategies, period, budget }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Request failed with status ${res.status}`);
      }

      const data: BacktestResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  }

  const isPositive = result ? result.stats.totalReturn >= 0 : true;
  const curveColor = isPositive ? "#22c55e" : "#ef4444";
  const gradientId = "backtestGradient";

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Strategy Backtester</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Simulate historical performance with different strategies and budgets
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        {/* Strategy checkboxes */}
        <div className="flex-1 min-w-[200px]">
          <label className="mb-2 block text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Strategies
          </label>
          <div className="flex flex-wrap gap-3">
            {strategies.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedStrategies.includes(s.id)}
                  onChange={() => handleStrategyToggle(s.id)}
                  className="h-4 w-4 rounded border-border bg-background accent-primary"
                />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Period selector */}
        <div>
          <label className="mb-2 block text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Period
          </label>
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === p.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Budget input */}
        <div>
          <label className="mb-2 block text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Budget
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <input
              type="number"
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              min={1}
              className="w-32 rounded-md border border-border bg-background pl-7 pr-3 py-2 text-sm font-mono"
            />
          </div>
        </div>

        {/* Simulate button */}
        <button
          onClick={handleSimulate}
          disabled={loading || selectedStrategies.length === 0 || budget <= 0}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Simulating...
            </span>
          ) : (
            "Simulate"
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-xs text-muted-foreground">Total Return</p>
              <p
                className={`mt-1 text-xl font-semibold font-mono tracking-tight ${
                  result.stats.totalReturn >= 0
                    ? "text-[color:var(--success)]"
                    : "text-destructive"
                }`}
              >
                {result.stats.totalReturn >= 0 ? "+" : ""}
                {formatCurrency(result.stats.totalReturn)}
              </p>
              <p
                className={`text-xs font-mono ${
                  result.stats.totalReturnPct >= 0
                    ? "text-[color:var(--success)]"
                    : "text-destructive"
                }`}
              >
                {result.stats.totalReturnPct >= 0 ? "+" : ""}
                {result.stats.totalReturnPct.toFixed(2)}%
              </p>
            </div>

            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-xs text-muted-foreground">Win Rate</p>
              <p className="mt-1 text-xl font-semibold font-mono tracking-tight">
                {result.stats.winRate.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                {result.stats.wins}W / {result.stats.losses}L
              </p>
            </div>

            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-xs text-muted-foreground">Sharpe Ratio</p>
              <p
                className={`mt-1 text-xl font-semibold font-mono tracking-tight ${
                  result.stats.sharpeRatio >= 1.0
                    ? "text-[color:var(--success)]"
                    : result.stats.sharpeRatio >= 0
                      ? "text-foreground"
                      : "text-destructive"
                }`}
              >
                {result.stats.sharpeRatio.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground font-mono">annualized</p>
            </div>

            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-xs text-muted-foreground">Max Drawdown</p>
              <p className="mt-1 text-xl font-semibold font-mono tracking-tight text-destructive">
                -{formatCurrency(result.stats.maxDrawdown)}
              </p>
              <p className="text-xs text-destructive font-mono">
                -{result.stats.maxDrawdownPct.toFixed(2)}%
              </p>
            </div>
          </div>

          {/* Equity curve */}
          {result.equityCurve.length > 1 && (
            <div className="h-64 w-full rounded-lg border border-border bg-background p-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={result.equityCurve}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={curveColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={curveColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    tickLine={false}
                    axisLine={{ stroke: "#27272a" }}
                    tickFormatter={(d: string) =>
                      new Date(d).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    }
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#a1a1aa" }}
                    tickLine={false}
                    axisLine={{ stroke: "#27272a" }}
                    tickFormatter={(v: number) => `$${v.toLocaleString()}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "#a1a1aa" }}
                    labelFormatter={(label: string) => formatDate(label)}
                    formatter={(value: number) => [
                      `$${value.toLocaleString()}`,
                      "Portfolio Value",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={curveColor}
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Trade log */}
          {result.trades.length > 0 && (
            <div>
              <button
                onClick={() => setShowTradeLog((prev) => !prev)}
                className="mb-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {showTradeLog ? "Hide" : "Show"} Trade Log
                {" "}
                <span className="text-xs">
                  ({result.trades.length} trade{result.trades.length !== 1 ? "s" : ""})
                </span>
              </button>

              {showTradeLog && (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Ticker
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Side
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Entry
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Exit
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Qty
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          P&L
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Date
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice(-50).map((trade, i) => (
                        <tr
                          key={`${trade.ticker}-${trade.date}-${i}`}
                          className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-2 font-mono text-xs">
                            {trade.ticker}
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                                trade.side === "yes"
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : "bg-red-500/10 text-red-400"
                              }`}
                            >
                              {trade.side.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs">
                            ${trade.entryPrice.toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs">
                            {trade.exitPrice !== null
                              ? `$${trade.exitPrice.toFixed(2)}`
                              : "-"}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs">
                            {trade.quantity}
                          </td>
                          <td
                            className={`px-4 py-2 text-right font-mono text-xs ${
                              trade.pnl >= 0
                                ? "text-[color:var(--success)]"
                                : "text-destructive"
                            }`}
                          >
                            {trade.pnl >= 0 ? "+" : ""}
                            {formatCurrency(trade.pnl)}
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                            {trade.closedAt
                              ? formatDate(trade.closedAt)
                              : formatDate(trade.date)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.trades.length > 50 && (
                    <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                      Showing 50 most recent of {result.trades.length} trades
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {result.stats.totalTrades === 0 && (
            <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-background">
              <p className="text-sm text-muted-foreground">
                No resolved trades found for the selected strategies and period.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
