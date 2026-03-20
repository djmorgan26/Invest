"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { Market } from "@/lib/supabase/types";
import { formatCurrency, formatDate } from "@/lib/utils";

interface MarketTableProps {
  markets: Market[];
}

type SortKey = "volume" | "last_price" | "close_time" | "ticker";
type SortDir = "asc" | "desc";

export function MarketTable({ markets }: MarketTableProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("volume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let result = markets.filter(
      (m) =>
        m.ticker.toLowerCase().includes(q) ||
        m.title.toLowerCase().includes(q)
    );

    result.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;

      switch (sortKey) {
        case "volume":
          av = a.volume ?? 0;
          bv = b.volume ?? 0;
          break;
        case "last_price":
          av = a.last_price ?? 0;
          bv = b.last_price ?? 0;
          break;
        case "close_time":
          av = a.close_time ?? "";
          bv = b.close_time ?? "";
          break;
        case "ticker":
          av = a.ticker;
          bv = b.ticker;
          break;
      }

      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [markets, search, sortKey, sortDir]);

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  return (
    <div className="space-y-4">
      <input
        type="text"
        placeholder="Search by ticker or title..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded-lg border border-input bg-background px-4 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left">
              <th
                className="cursor-pointer px-4 py-3 font-medium text-muted-foreground hover:text-foreground"
                onClick={() => toggleSort("ticker")}
              >
                Ticker{sortIndicator("ticker")}
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Title
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-right font-medium text-muted-foreground hover:text-foreground"
                onClick={() => toggleSort("last_price")}
              >
                Last Price{sortIndicator("last_price")}
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Yes Bid/Ask
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-right font-medium text-muted-foreground hover:text-foreground"
                onClick={() => toggleSort("volume")}
              >
                Volume{sortIndicator("volume")}
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-right font-medium text-muted-foreground hover:text-foreground"
                onClick={() => toggleSort("close_time")}
              >
                Close Time{sortIndicator("close_time")}
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  {markets.length === 0
                    ? "No markets found. Run sync-markets to fetch data."
                    : "No markets match your search."}
                </td>
              </tr>
            ) : (
              filtered.map((market) => (
                <tr
                  key={market.ticker}
                  className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/markets/${market.ticker}`}
                      className="font-mono text-sm font-medium text-primary hover:underline"
                    >
                      {market.ticker}
                    </Link>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3">
                    {market.title}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {market.last_price != null
                      ? `${market.last_price}\u00a2`
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {market.yes_bid != null && market.yes_ask != null
                      ? `${market.yes_bid}\u00a2 / ${market.yes_ask}\u00a2`
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {market.volume?.toLocaleString() ?? "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {market.close_time
                      ? formatDate(market.close_time)
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        market.status === "open"
                          ? "bg-success/15 text-success"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {market.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {markets.length} markets
      </p>
    </div>
  );
}
