"use client";

import { cn } from "@/lib/utils";

interface SourceInfo {
  name: string;
  source: string;
  icon: string;
  category: string;
  auth: "free" | "api_key";
  description: string;
}

const SOURCES: SourceInfo[] = [
  { name: "Polymarket", source: "polymarket", icon: "🔮", category: "Prediction Markets", auth: "free", description: "Prediction market prices & volumes" },
  { name: "PredictIt", source: "predictit", icon: "🏛️", category: "Prediction Markets", auth: "free", description: "Political contract prices" },
  { name: "ESPN", source: "espn", icon: "🏈", category: "Sports", auth: "free", description: "Live scores, odds for NFL/NBA/MLB/NHL/MLS" },
  { name: "The Odds API", source: "odds_api", icon: "🎰", category: "Sports", auth: "api_key", description: "Consensus odds from 40+ sportsbooks" },
  { name: "FRED", source: "fred", icon: "📊", category: "Economics", auth: "api_key", description: "15 key economic series (CPI, GDP, rates)" },
  { name: "CoinGecko", source: "coingecko", icon: "🦎", category: "Crypto", auth: "free", description: "Top 10 crypto prices, Fear & Greed" },
  { name: "Open-Meteo", source: "open_meteo", icon: "🌤️", category: "Weather", auth: "free", description: "7-day forecasts for 10 US cities" },
  { name: "NWS", source: "nws", icon: "🇺🇸", category: "Weather", auth: "free", description: "Official NOAA forecasts (settlement source)" },
];

interface SourceStatusGridProps {
  sourceStats: Record<string, { count: number; latest: string | null; stale: boolean }>;
}

function formatAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SourceStatusGrid({ sourceStats }: SourceStatusGridProps) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {SOURCES.map((info) => {
        const stats = sourceStats[info.source];
        const hasData = stats && stats.count > 0;
        const isStale = stats?.stale ?? true;
        const isOnline = hasData && !isStale;
        const needsKey = info.auth === "api_key" && !hasData;

        return (
          <div
            key={info.source}
            className={cn(
              "relative rounded-xl border bg-card p-4 transition-colors ring-1",
              isOnline
                ? "ring-success/30 border-success/20"
                : needsKey
                  ? "ring-warning/20 border-warning/15"
                  : hasData && isStale
                    ? "ring-warning/30 border-warning/20"
                    : "ring-foreground/10 border-border"
            )}
          >
            {/* Status dot */}
            <div className="absolute top-3 right-3">
              <span
                className={cn(
                  "inline-block h-2.5 w-2.5 rounded-full",
                  isOnline
                    ? "bg-success animate-pulse"
                    : hasData && isStale
                      ? "bg-warning"
                      : needsKey
                        ? "bg-warning/50"
                        : "bg-muted-foreground/30"
                )}
              />
            </div>

            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{info.icon}</span>
              <div>
                <p className="text-sm font-semibold">{info.name}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {info.category}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mb-3 line-clamp-1">
              {info.description}
            </p>

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {hasData ? `${stats.count} signals` : needsKey ? "Needs API key" : "No data"}
              </span>
              <span
                className={cn(
                  "font-mono",
                  isOnline
                    ? "text-success"
                    : isStale && hasData
                      ? "text-warning"
                      : "text-muted-foreground"
                )}
              >
                {formatAgo(stats?.latest ?? null)}
              </span>
            </div>

            {info.auth === "api_key" && (
              <div className="mt-2">
                <span className="inline-flex items-center rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                  API Key
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
