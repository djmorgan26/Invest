"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { Market } from "@/lib/supabase/types";
import { formatDate } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

  // Max volume for heat indicator
  const maxVolume = useMemo(
    () => Math.max(1, ...markets.map((m) => m.volume ?? 0)),
    [markets]
  );

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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer hover:text-foreground"
                onClick={() => toggleSort("ticker")}
              >
                Ticker{sortIndicator("ticker")}
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead
                className="cursor-pointer text-right hover:text-foreground"
                onClick={() => toggleSort("last_price")}
              >
                Last Price{sortIndicator("last_price")}
              </TableHead>
              <TableHead className="text-right">Yes Bid/Ask</TableHead>
              <TableHead
                className="cursor-pointer text-right hover:text-foreground"
                onClick={() => toggleSort("volume")}
              >
                Volume{sortIndicator("volume")}
              </TableHead>
              <TableHead
                className="cursor-pointer text-right hover:text-foreground"
                onClick={() => toggleSort("close_time")}
              >
                Close Time{sortIndicator("close_time")}
              </TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  {markets.length === 0
                    ? "No markets found. Run sync-markets to fetch data."
                    : "No markets match your search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((market) => {
                const heat =
                  market.volume != null ? market.volume / maxVolume : 0;
                return (
                  <TableRow
                    key={market.ticker}
                    className="transition-colors hover:bg-card-hover"
                    style={
                      heat > 0.1
                        ? {
                            background: `rgba(var(--success-rgb, 34 197 94), ${heat * 0.04})`,
                          }
                        : undefined
                    }
                  >
                    <TableCell>
                      <Link
                        href={`/dashboard/markets/${market.ticker}`}
                        className="font-mono text-sm font-medium text-primary hover:underline"
                      >
                        {market.ticker}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {market.title}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {market.last_price != null
                        ? `${market.last_price}\u00a2`
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {market.yes_bid != null && market.yes_ask != null
                        ? `${market.yes_bid}\u00a2 / ${market.yes_ask}\u00a2`
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {market.volume?.toLocaleString() ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {market.close_time
                        ? formatDate(market.close_time)
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          market.status === "open"
                            ? "bg-success/15 text-success"
                            : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {market.status}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {markets.length} markets
      </p>
    </div>
  );
}
