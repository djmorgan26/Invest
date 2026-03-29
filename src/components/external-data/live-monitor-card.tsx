"use client";

import { cn } from "@/lib/utils";

export function LiveMonitorCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-6 ring-1 ring-foreground/10">
      <div className="flex items-center gap-3 mb-4">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-success" />
        </span>
        <h2 className="text-base font-semibold">Live Speed Edge Monitor</h2>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Run the live monitor to stream real-time data and detect stale Kalshi markets.
      </p>

      <div className="space-y-3">
        {/* How it works */}
        <div className="rounded-lg bg-secondary/50 p-4">
          <h3 className="text-sm font-medium mb-2">How the Speed Edge Works</h3>
          <ol className="space-y-2 text-xs text-muted-foreground">
            <li className="flex gap-2">
              <span className="text-success font-mono font-bold shrink-0">1.</span>
              <span>Real-world event happens (score change, crypto spike)</span>
            </li>
            <li className="flex gap-2">
              <span className="text-success font-mono font-bold shrink-0">2.</span>
              <span>ESPN/Binance reports it in &lt;5 seconds</span>
            </li>
            <li className="flex gap-2">
              <span className="text-success font-mono font-bold shrink-0">3.</span>
              <span>Kalshi market hasn&apos;t repriced yet (30s-2min lag)</span>
            </li>
            <li className="flex gap-2">
              <span className="text-success font-mono font-bold shrink-0">4.</span>
              <span>We buy/sell the stale contract before the crowd corrects it</span>
            </li>
          </ol>
        </div>

        {/* Stream status */}
        <div className="grid gap-2 sm:grid-cols-3">
          <StreamCard
            name="ESPN Sports"
            icon="🏈"
            description="10s polls for NFL, NBA, MLB, NHL, MLS"
            type="Poller"
            speed="~10s"
          />
          <StreamCard
            name="Binance Crypto"
            icon="₿"
            description="Real-time BTC, ETH, SOL, DOGE ticks"
            type="WebSocket"
            speed="<100ms"
          />
          <StreamCard
            name="Kalshi Markets"
            icon="📈"
            description="Orderbook + trade stream"
            type="WebSocket"
            speed="<200ms"
          />
        </div>

        {/* CLI command */}
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Start the monitor
          </p>
          <div className="space-y-1">
            <code className="block text-xs font-mono text-success">
              npx tsx src/scripts/live-monitor.ts
            </code>
            <code className="block text-xs font-mono text-muted-foreground">
              npx tsx src/scripts/live-monitor.ts --sports-only
            </code>
            <code className="block text-xs font-mono text-muted-foreground">
              npx tsx src/scripts/live-monitor.ts --crypto-only
            </code>
            <code className="block text-xs font-mono text-muted-foreground">
              npx tsx src/scripts/live-monitor.ts --poll-interval 5
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}

function StreamCard({
  name,
  icon,
  description,
  type,
  speed,
}: {
  name: string;
  icon: string;
  description: string;
  type: string;
  speed: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-2 mb-1">
        <span>{icon}</span>
        <span className="text-sm font-medium">{name}</span>
      </div>
      <p className="text-[10px] text-muted-foreground mb-2">{description}</p>
      <div className="flex items-center justify-between">
        <span className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-medium",
          type === "WebSocket" ? "bg-success/15 text-success" : "bg-sky-500/15 text-sky-400"
        )}>
          {type}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">{speed}</span>
      </div>
    </div>
  );
}
