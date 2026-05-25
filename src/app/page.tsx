import Link from "next/link";
import { TrendingUp, ArrowRight, Radio, Zap, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Kalshi Investment Assistant",
  description:
    "An autonomous edge engine for prediction markets — 10 strategies, 8 data connectors, paper trading.",
};

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-10%] h-[420px] w-[680px] -translate-x-1/2 rounded-full bg-success/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5 text-success" />
          Kalshi Edge — autonomous prediction-market engine
        </div>

        <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          An edge engine for prediction markets.
        </h1>

        <p className="mt-5 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
          Ten autonomous strategies continuously scan 40,000+ Kalshi markets,
          detect mispricings before the crowd corrects them, and prove
          themselves through paper trading — fused with eight external data
          sources and a live speed-edge monitor.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/demo"
            className="group inline-flex items-center gap-2 rounded-lg bg-success px-5 py-3 text-sm font-semibold text-background transition-colors hover:bg-success/90"
          >
            View live demo
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <span className="text-xs text-muted-foreground">
            No login required · simulated paper-trading data
          </span>
        </div>

        <div className="mt-14 grid w-full max-w-xl grid-cols-1 gap-4 sm:grid-cols-3">
          <Feature
            icon={<Zap className="h-4 w-4 text-success" />}
            title="10 strategies"
            body="Wide spread, stale price, mean reversion, and more — running every 5 minutes."
          />
          <Feature
            icon={<Radio className="h-4 w-4 text-success" />}
            title="8 data sources"
            body="Binance, ESPN, FRED, sportsbooks, and other connectors fused for edge."
          />
          <Feature
            icon={<ShieldCheck className="h-4 w-4 text-success" />}
            title="Paper-traded"
            body="A full track record builds before any real capital is deployed."
          />
        </div>
      </div>
    </main>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-left">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
