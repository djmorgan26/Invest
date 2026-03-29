"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Signal {
  source: string;
  signal_type: string;
  category: string;
  title: string;
  implied_probability: number | null;
  data: Record<string, unknown>;
  fetched_at: string;
  expires_at: string | null;
}

interface SignalFeedProps {
  signals: Signal[];
}

const SOURCE_COLORS: Record<string, string> = {
  polymarket: "bg-purple-500/15 text-purple-400",
  predictit: "bg-blue-500/15 text-blue-400",
  espn: "bg-red-500/15 text-red-400",
  odds_api: "bg-orange-500/15 text-orange-400",
  fred: "bg-cyan-500/15 text-cyan-400",
  coingecko: "bg-lime-500/15 text-lime-400",
  open_meteo: "bg-sky-500/15 text-sky-400",
  nws: "bg-teal-500/15 text-teal-400",
};

const CATEGORY_FILTERS = ["all", "politics", "crypto", "sports", "weather", "economics", "other"];

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SignalFeed({ signals }: SignalFeedProps) {
  const [filter, setFilter] = useState("all");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const filtered = filter === "all"
    ? signals
    : signals.filter((s) => s.category === filter);

  return (
    <div>
      {/* Category filter pills */}
      <div className="flex flex-wrap gap-1 mb-4">
        {CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize",
              filter === cat
                ? "bg-primary text-primary-foreground"
                : "bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Signal list */}
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No signals in this category yet.
          </p>
        )}
        {filtered.map((signal, idx) => {
          const isExpanded = expandedIdx === idx;
          const isExpired = signal.expires_at && new Date(signal.expires_at) < new Date();

          return (
            <button
              key={`${signal.source}-${signal.fetched_at}-${idx}`}
              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              className={cn(
                "w-full text-left rounded-lg border border-border bg-card px-4 py-2.5 transition-colors hover:bg-card-hover",
                isExpired && "opacity-50"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        SOURCE_COLORS[signal.source] ?? "bg-secondary text-muted-foreground"
                      )}
                    >
                      {signal.source}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {signal.category}
                    </span>
                  </div>
                  <p className="text-sm truncate">{signal.title}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {signal.implied_probability != null && (
                    <span className="font-mono text-sm font-semibold">
                      {(signal.implied_probability * 100).toFixed(0)}%
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {formatTime(signal.fetched_at)}
                  </span>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="mt-2 pt-2 border-t border-border">
                  <pre className="text-[11px] text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(signal.data, null, 2)}
                  </pre>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
