// =============================================================================
// Demo fixtures — simulated paper-trading dataset
// -----------------------------------------------------------------------------
// A realistic, internally-consistent snapshot of the Kalshi edge engine so the
// dashboard looks alive without any backend. All values are SIMULATED paper
// trading. No real money, no live API.
//
// The data is deterministic (seeded) so every page renders the same coherent
// story: portfolio grows $10,000 -> ~$10,057, ~56% win rate over 240 resolved
// trades, positive Sharpe, attributed across all 10 strategies.
// =============================================================================

import type {
  Event,
  Market,
  Prediction,
  PaperTrade,
  StrategyRow,
  StrategyLearningRow,
  PortfolioSnapshot,
  ReviewRow,
  ExternalSignalRow,
  ExternalMarketMappingRow,
} from "@/lib/supabase/types";

// ── Deterministic PRNG (mulberry32) ──────────────────────────────────────────
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = new Date("2026-05-25T16:00:00.000Z").getTime();
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

// ── Strategies (the 10 autonomous strategies) ────────────────────────────────
type StratSeed = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

const STRATEGY_SEEDS: StratSeed[] = [
  {
    id: "wide-spread",
    name: "Wide Spread",
    description: "Capture value in markets with large bid-ask gaps.",
    enabled: true,
    config: { min_spread: 0.06, min_volume: 500, max_position: 50 },
  },
  {
    id: "stale-price",
    name: "Stale Price",
    description: "Trade markets that haven't repriced after related events settle.",
    enabled: true,
    config: { staleness_minutes: 12, min_move: 0.04 },
  },
  {
    id: "extreme-value",
    name: "Extreme Value",
    description: "Buy near-certain outcomes still mispriced near expiry.",
    enabled: true,
    config: { price_floor: 0.92, hours_to_close: 48 },
  },
  {
    id: "mean-reversion",
    name: "Mean Reversion",
    description: "Fade sharp price moves that overshoot fair value.",
    enabled: true,
    config: { z_threshold: 2.0, lookback: 24 },
  },
  {
    id: "volume-spike",
    name: "Volume Spike",
    description: "Ride momentum when informed flow hits thin markets.",
    enabled: true,
    config: { volume_multiple: 3.0, min_liquidity: 1000 },
  },
  {
    id: "event-cluster",
    name: "Event Cluster Arb",
    description: "Exploit mutually exclusive markets whose YES prices don't sum to 100.",
    enabled: true,
    config: { min_overround: 0.03 },
  },
  {
    id: "favorite-longshot",
    name: "Favorite-Longshot",
    description: "Sell overpriced longshots, buy underpriced favorites.",
    enabled: true,
    config: { longshot_ceiling: 0.1, favorite_floor: 0.9 },
  },
  {
    id: "expiry-convergence",
    name: "Expiry Convergence",
    description: "Snipe markets near close still priced far from settlement.",
    enabled: true,
    config: { hours_to_close: 6, min_gap: 0.08 },
  },
  {
    id: "new-listing",
    name: "New Listing",
    description: "Trade newly listed markets with naive initial pricing.",
    enabled: false,
    config: { max_age_hours: 4, min_edge: 0.05 },
  },
  {
    id: "liquidity-provision",
    name: "Liquidity Provision",
    description: "Earn spread in stable, wide-spread markets using orderbook depth.",
    enabled: true,
    config: { min_depth: 200, target_spread: 0.04 },
  },
];

export const strategies: StrategyRow[] = STRATEGY_SEEDS.map((s, i) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  enabled: s.enabled,
  config: s.config,
  created_at: iso(NOW - (150 - i) * DAY),
}));

// ── Events + Markets ──────────────────────────────────────────────────────────
type MarketSeed = {
  ticker: string;
  event_ticker: string;
  title: string;
  category: string;
  last: number; // last price in cents (0-100)
  spread: number; // bid/ask half-spread in cents
  volume: number;
};

const MARKET_SEEDS: MarketSeed[] = [
  { ticker: "KXBTCD-26MAY25-T108000", event_ticker: "KXBTCD-26MAY25", title: "Bitcoin above $108,000 on May 25?", category: "Crypto", last: 62, spread: 3, volume: 184230 },
  { ticker: "KXETHD-26MAY25-T3900", event_ticker: "KXETHD-26MAY25", title: "Ethereum above $3,900 on May 25?", category: "Crypto", last: 47, spread: 4, volume: 96120 },
  { ticker: "KXSOLD-26MAY25-T180", event_ticker: "KXSOLD-26MAY25", title: "Solana above $180 on May 25?", category: "Crypto", last: 71, spread: 5, volume: 41880 },
  { ticker: "INXD-26MAY25-T5900", event_ticker: "INXD-26MAY25", title: "S&P 500 close above 5,900 today?", category: "Financials", last: 54, spread: 2, volume: 220410 },
  { ticker: "KXWTIW-26MAY29-B72", event_ticker: "KXWTIW-26MAY29", title: "WTI crude below $72 this week?", category: "Commodities", last: 38, spread: 6, volume: 28740 },
  { ticker: "CPI-26MAY-T3.2", event_ticker: "CPI-26MAY", title: "CPI YoY above 3.2% for May?", category: "Economics", last: 29, spread: 5, volume: 64530 },
  { ticker: "GDPNOW-26Q2-T2.5", event_ticker: "GDPNOW-26Q2", title: "GDPNow Q2 estimate above 2.5%?", category: "Economics", last: 43, spread: 7, volume: 18220 },
  { ticker: "KXNBA-26MAY26-BOS", event_ticker: "KXNBA-26MAY26", title: "Celtics win Game 5?", category: "Sports", last: 66, spread: 3, volume: 132890 },
  { ticker: "KXNBA-26MAY26-NYK", event_ticker: "KXNBA-26MAY26", title: "Knicks win Game 5?", category: "Sports", last: 36, spread: 3, volume: 128440 },
  { ticker: "KXFED-26JUN-CUT25", event_ticker: "KXFED-26JUN", title: "Fed cuts 25bps in June?", category: "Economics", last: 22, spread: 4, volume: 89210 },
  { ticker: "KXTEMP-26MAY25-NYC-T82", event_ticker: "KXTEMP-26MAY25-NYC", title: "NYC high above 82°F today?", category: "Climate", last: 58, spread: 8, volume: 9430 },
  { ticker: "KXMOVIE-26MAY-T120M", event_ticker: "KXMOVIE-26MAY", title: "Weekend box office #1 above $120M?", category: "Entertainment", last: 31, spread: 9, volume: 6210 },
  { ticker: "KXBTCD-26MAY26-T110000", event_ticker: "KXBTCD-26MAY26", title: "Bitcoin above $110,000 on May 26?", category: "Crypto", last: 41, spread: 4, volume: 77150 },
  { ticker: "INXW-26MAY29-T6000", event_ticker: "INXW-26MAY29", title: "S&P 500 above 6,000 this week?", category: "Financials", last: 19, spread: 3, volume: 154320 },
  { ticker: "KXSENATE-26-GOP", event_ticker: "KXSENATE-26", title: "GOP holds Senate majority in 2026?", category: "Politics", last: 73, spread: 2, volume: 410220 },
];

const CATEGORY_BY_EVENT = new Map(MARKET_SEEDS.map((m) => [m.event_ticker, m.category]));

export const events: Event[] = [...new Map(MARKET_SEEDS.map((m) => [m.event_ticker, m])).values()].map(
  (m) => ({
    event_ticker: m.event_ticker,
    title: m.title.replace(/\?$/, ""),
    category: m.category,
    sub_title: null,
    mutually_exclusive: m.event_ticker.startsWith("KXNBA"),
    status: "active",
    created_at: iso(NOW - 40 * DAY),
    updated_at: iso(NOW - 1 * DAY),
  })
);

export const markets: Market[] = MARKET_SEEDS.map((m) => ({
  ticker: m.ticker,
  event_ticker: m.event_ticker,
  title: m.title,
  subtitle: null,
  status: "active",
  yes_bid: m.last - m.spread,
  yes_ask: m.last + m.spread,
  last_price: m.last,
  volume: m.volume,
  open_interest: Math.round(m.volume * 0.42),
  close_time: iso(NOW + (1 + (m.volume % 9)) * DAY),
  result: null,
  volume_24h: Math.round(m.volume * 0.31),
  liquidity: Math.round(m.volume * 1.7),
  created_at: iso(NOW - 40 * DAY),
  updated_at: iso(NOW - 0.02 * DAY),
}));

// ── Portfolio history: $10,000 -> ~$10,057 over ~120 days ────────────────────
const HISTORY_DAYS = 120;
const FINAL_VALUE = 10_057.4;

export const portfolioSnapshots: PortfolioSnapshot[] = (() => {
  const rng = makeRng(20260525);
  const snaps: PortfolioSnapshot[] = [];
  // Build a gently-upward equity curve with realistic chop.
  const totalGain = FINAL_VALUE - 10_000;
  const push = (id: string, total: number, atMs: number) => {
    const realized = (total - 10_000) * 0.78;
    const unrealized = total - 10_000 - realized;
    snaps.push({
      id,
      cash: Math.round((total - unrealized * 0.5) * 100) / 100,
      unrealized_pnl: Math.round(unrealized * 100) / 100,
      realized_pnl: Math.round(realized * 100) / 100,
      total_value: Math.round(total * 100) / 100,
      snapshot_at: iso(atMs),
    });
  };
  // Daily history up to (but not including) the final day...
  let dayBeforeFinal = 10_000;
  for (let d = 0; d < HISTORY_DAYS; d++) {
    const progress = d / HISTORY_DAYS;
    // smooth drift + noise
    const drift = totalGain * progress;
    const noise = (rng() - 0.45) * 22 * Math.sin(progress * Math.PI);
    const total = 10_000 + drift + noise;
    if (d === HISTORY_DAYS - 1) dayBeforeFinal = total;
    push(`snap-${d}`, total, NOW - (HISTORY_DAYS - d) * DAY);
  }
  // ...then an hourly tail across the final 24h so the 1D and 1W chart ranges
  // have real intraday shape instead of a near-empty window.
  const HOUR = DAY / 24;
  for (let h = 23; h >= 1; h--) {
    const progress = (24 - h) / 24;
    const base = dayBeforeFinal + (FINAL_VALUE - dayBeforeFinal) * progress;
    const noise = (rng() - 0.5) * 6;
    push(`snap-h${h}`, base + noise, NOW - h * HOUR);
  }
  // ensure the last point lands on FINAL_VALUE
  push(`snap-${HISTORY_DAYS}`, FINAL_VALUE, NOW);
  return snaps;
})();

const LATEST_PORTFOLIO = portfolioSnapshots[portfolioSnapshots.length - 1];

// ── Paper trades: 240 closed (~56% win) + open positions ─────────────────────
type GenTrade = PaperTrade & { _category: string };

const TICKERS = MARKET_SEEDS.map((m) => m.ticker);

function buildClosedTrades(): GenTrade[] {
  const rng = makeRng(771);
  const out: GenTrade[] = [];
  const count = 240;
  // Per-strategy target win rates so the attribution looks differentiated.
  const winRateByStrat: Record<string, number> = {
    "wide-spread": 0.61,
    "stale-price": 0.58,
    "extreme-value": 0.67,
    "mean-reversion": 0.52,
    "volume-spike": 0.49,
    "event-cluster": 0.63,
    "favorite-longshot": 0.55,
    "expiry-convergence": 0.6,
    "new-listing": 0.44,
    "liquidity-provision": 0.57,
  };
  for (let i = 0; i < count; i++) {
    const seed = MARKET_SEEDS[i % MARKET_SEEDS.length];
    const strat = STRATEGY_SEEDS[i % STRATEGY_SEEDS.length];
    const side: "yes" | "no" = rng() > 0.5 ? "yes" : "no";
    const qty = 10 + Math.floor(rng() * 60);
    const entry = Math.round((0.18 + rng() * 0.64) * 100) / 100;
    const win = rng() < (winRateByStrat[strat.id] ?? 0.55);
    const move = (0.02 + rng() * 0.16) * (win ? 1 : -1);
    const exit = Math.min(0.99, Math.max(0.01, Math.round((entry + (side === "yes" ? move : -move)) * 100) / 100));
    const cost = Math.round(entry * qty * 100) / 100;
    const fee = Math.round(cost * 0.01 * 100) / 100;
    const gross = side === "yes" ? (exit - entry) * qty : (entry - exit) * qty;
    const pnl = Math.round((gross - fee) * 100) / 100;
    const createdMs = NOW - (HISTORY_DAYS - Math.floor((i / count) * HISTORY_DAYS)) * DAY - Math.floor(rng() * DAY);
    const closedMs = createdMs + Math.floor((0.5 + rng() * 5) * DAY);
    out.push({
      id: `pt-closed-${i}`,
      ticker: seed.ticker,
      side,
      quantity: qty,
      price: entry,
      cost,
      status: "closed",
      exit_price: exit,
      pnl,
      prediction_id: `pred-${i}`,
      fee,
      strategy_id: strat.id,
      created_at: iso(createdMs),
      closed_at: iso(Math.min(closedMs, NOW - DAY)),
      _category: seed.category,
    });
  }
  return out;
}

const CLOSED_TRADES = buildClosedTrades();

const OPEN_TRADES: GenTrade[] = (() => {
  const rng = makeRng(99);
  const picks = [0, 3, 7, 9, 12, 14];
  return picks.map((idx, i) => {
    const seed = MARKET_SEEDS[idx];
    const strat = STRATEGY_SEEDS[(idx + 1) % STRATEGY_SEEDS.length];
    const side: "yes" | "no" = rng() > 0.5 ? "yes" : "no";
    const qty = 15 + Math.floor(rng() * 45);
    const entry = Math.round((seed.last / 100 - 0.05 + rng() * 0.04) * 100) / 100;
    const cost = Math.round(entry * qty * 100) / 100;
    const fee = Math.round(cost * 0.01 * 100) / 100;
    return {
      id: `pt-open-${i}`,
      ticker: seed.ticker,
      side,
      quantity: qty,
      price: entry,
      cost,
      status: "open" as const,
      exit_price: null,
      pnl: null,
      prediction_id: `pred-open-${i}`,
      fee,
      strategy_id: strat.id,
      created_at: iso(NOW - (1 + i) * DAY - Math.floor(rng() * DAY)),
      closed_at: null,
      _category: seed.category,
    };
  });
})();

export const paperTrades: PaperTrade[] = [...OPEN_TRADES, ...CLOSED_TRADES].map(
  ({ _category, ...t }) => t
);

// ── Predictions ───────────────────────────────────────────────────────────────
export const predictions: Prediction[] = (() => {
  const rng = makeRng(555);
  const out: Prediction[] = [];
  // recent + historical predictions, mix of statuses
  for (let i = 0; i < 60; i++) {
    const seed = MARKET_SEEDS[i % MARKET_SEEDS.length];
    const strat = STRATEGY_SEEDS[i % STRATEGY_SEEDS.length];
    const side: "yes" | "no" = rng() > 0.5 ? "yes" : "no";
    const fair = Math.round((0.15 + rng() * 0.7) * 100) / 100;
    const edge = Math.round((0.03 + rng() * 0.14) * 100) / 100;
    let status: Prediction["status"];
    if (i < 8) status = "pending";
    else {
      const r = rng();
      status = r < 0.56 ? "correct" : r < 0.92 ? "incorrect" : "expired";
    }
    const createdMs = NOW - i * 1.7 * DAY - Math.floor(rng() * DAY);
    out.push({
      id: `pred-${i}`,
      ticker: seed.ticker,
      side,
      confidence: Math.round((0.55 + rng() * 0.4) * 100) / 100,
      fair_value: fair,
      edge,
      reasoning:
        `${strat.name} flagged a ${(edge * 100).toFixed(0)}% edge: model fair value ` +
        `${(fair * 100).toFixed(0)}c vs market ${seed.last}c on "${seed.title}".`,
      status,
      strategy_id: strat.id,
      created_at: iso(createdMs),
      resolved_at: status === "pending" ? null : iso(createdMs + 2 * DAY),
    });
  }
  return out;
})();

// ── Opportunities (derived, for any "opportunities" view) ────────────────────
export type DemoOpportunity = {
  ticker: string;
  title: string;
  category: string;
  yes_price: number;
  no_price: number;
  fair_value: number;
  edge: number;
  side: "yes" | "no";
  strategy_id: string;
  strategy_name: string;
};

export const opportunities: DemoOpportunity[] = MARKET_SEEDS.slice(0, 10).map((m, i) => {
  const strat = STRATEGY_SEEDS[i % STRATEGY_SEEDS.length];
  const fair = Math.min(0.97, Math.max(0.03, m.last / 100 + (i % 2 === 0 ? 0.08 : -0.07)));
  const edge = Math.abs(fair - m.last / 100);
  return {
    ticker: m.ticker,
    title: m.title,
    category: m.category,
    yes_price: m.last / 100,
    no_price: Math.round((1 - m.last / 100) * 100) / 100,
    fair_value: Math.round(fair * 100) / 100,
    edge: Math.round(edge * 1000) / 1000,
    side: fair > m.last / 100 ? "yes" : "no",
    strategy_id: strat.id,
    strategy_name: strat.name,
  };
});

// ── Strategy learnings (auto-tuning history) ─────────────────────────────────
export const strategyLearnings: StrategyLearningRow[] = [
  {
    id: "lrn-1",
    strategy_id: "volume-spike",
    learning_type: "auto_disabled",
    description:
      "Auto-disabled after win rate fell to 49% over 31 resolved trades (CI lower 36%). Re-enable after parameter review.",
    data: { trades: 31, win_rate: 0.49 },
    created_at: iso(NOW - 6 * DAY),
  },
  {
    id: "lrn-2",
    strategy_id: "extreme-value",
    learning_type: "param_change",
    description: "Raised price_floor 0.90 -> 0.92 after near-expiry losses clustered in the 0.90-0.92 band.",
    data: { from: 0.9, to: 0.92 },
    created_at: iso(NOW - 9 * DAY),
  },
  {
    id: "lrn-3",
    strategy_id: "mean-reversion",
    learning_type: "regime_change",
    description: "Detected lower realized vol regime in crypto markets; widened z_threshold to reduce false fades.",
    data: { z_threshold: 2.0 },
    created_at: iso(NOW - 14 * DAY),
  },
  {
    id: "lrn-4",
    strategy_id: "wide-spread",
    learning_type: "category_insight",
    description: "Sports markets show the most persistent wide spreads pre-tipoff; allocating more budget there.",
    data: { category: "Sports" },
    created_at: iso(NOW - 19 * DAY),
  },
  {
    id: "lrn-5",
    strategy_id: "favorite-longshot",
    learning_type: "strategy_idea",
    description: "Longshot overpricing strongest in entertainment/box-office markets with thin liquidity.",
    data: {},
    created_at: iso(NOW - 23 * DAY),
  },
];

// ── Reviews (Claude-Code performance reviews) ────────────────────────────────
export const reviews: ReviewRow[] = [
  {
    id: "rev-1",
    review_type: "weekly",
    summary:
      "Portfolio +$57 (0.57%) over the period across 240 resolved trades at a 56% win rate. " +
      "Extreme Value and Event Cluster Arb are the top contributors; Volume Spike was auto-disabled. " +
      "Sharpe is positive but below the 1.0 go-live threshold — more samples needed before deploying capital.",
    recommendations: [
      { action: "Keep Volume Spike disabled until parameter sweep completes", priority: "high", reasoning: "Win rate below 50% with CI lower bound at 36%." },
      { action: "Increase allocation to Extreme Value near expiry windows", priority: "medium", reasoning: "67% win rate, lowest drawdown contribution." },
      { action: "Accumulate to 200+ resolved trades before go-live decision", priority: "high", reasoning: "Current sample insufficient for stable Sharpe estimate." },
    ],
    metrics: { total_pnl: 57.4, win_rate: 0.56, resolved: 240, sharpe: 0.84 },
    created_at: iso(NOW - 2 * DAY),
  },
  {
    id: "rev-2",
    review_type: "backtest",
    summary:
      "Backtest over 90 days of historical orderbook data confirms positive expectancy for 8 of 10 strategies. " +
      "New Listing underperforms out-of-sample and remains disabled.",
    recommendations: [
      { action: "Disable New Listing pending more listing-day data", priority: "medium", reasoning: "44% win rate, negative out-of-sample expectancy." },
    ],
    metrics: { strategies_profitable: 8, days: 90 },
    created_at: iso(NOW - 11 * DAY),
  },
];

// ── External signals (8-source data fusion) ──────────────────────────────────
export const externalSignals: ExternalSignalRow[] = [
  { id: "sig-1", source: "binance", signal_type: "price", external_id: "BTCUSDT", ticker: "KXBTCD-26MAY25-T108000", category: "Crypto", title: "BTC spot $108,420", data: { price: 108420, change_24h: 0.021 }, implied_probability: 0.63, fetched_at: iso(NOW - 0.01 * DAY), expires_at: iso(NOW + 0.2 * DAY), created_at: iso(NOW - 0.01 * DAY) },
  { id: "sig-2", source: "binance", signal_type: "price", external_id: "ETHUSDT", ticker: "KXETHD-26MAY25-T3900", category: "Crypto", title: "ETH spot $3,872", data: { price: 3872, change_24h: -0.008 }, implied_probability: 0.46, fetched_at: iso(NOW - 0.01 * DAY), expires_at: iso(NOW + 0.2 * DAY), created_at: iso(NOW - 0.01 * DAY) },
  { id: "sig-3", source: "espn", signal_type: "live_score", external_id: "BOS-NYK-G5", ticker: "KXNBA-26MAY26-BOS", category: "Sports", title: "Celtics 88 - Knicks 81 (Q4 6:12)", data: { home: 88, away: 81, period: 4 }, implied_probability: 0.7, fetched_at: iso(NOW - 0.005 * DAY), expires_at: iso(NOW + 0.05 * DAY), created_at: iso(NOW - 0.005 * DAY) },
  { id: "sig-4", source: "the_odds_api", signal_type: "sportsbook", external_id: "nba-bos-g5", ticker: "KXNBA-26MAY26-BOS", category: "Sports", title: "Sportsbook implied: Celtics 68%", data: { american: -213 }, implied_probability: 0.68, fetched_at: iso(NOW - 0.1 * DAY), expires_at: iso(NOW + 0.3 * DAY), created_at: iso(NOW - 0.1 * DAY) },
  { id: "sig-5", source: "fred", signal_type: "economic", external_id: "CPIAUCSL", ticker: "CPI-26MAY-T3.2", category: "Economics", title: "FRED CPI nowcast 3.1% YoY", data: { value: 3.1 }, implied_probability: 0.31, fetched_at: iso(NOW - 0.5 * DAY), expires_at: iso(NOW + 1 * DAY), created_at: iso(NOW - 0.5 * DAY) },
  { id: "sig-6", source: "polymarket", signal_type: "prediction", external_id: "fed-june-cut", ticker: "KXFED-26JUN-CUT25", category: "Economics", title: "Polymarket: June cut 24%", data: { price: 0.24 }, implied_probability: 0.24, fetched_at: iso(NOW - 0.2 * DAY), expires_at: iso(NOW + 1 * DAY), created_at: iso(NOW - 0.2 * DAY) },
  { id: "sig-7", source: "coingecko", signal_type: "price", external_id: "solana", ticker: "KXSOLD-26MAY25-T180", category: "Crypto", title: "SOL spot $183.40", data: { price: 183.4 }, implied_probability: 0.71, fetched_at: iso(NOW - 0.02 * DAY), expires_at: iso(NOW + 0.2 * DAY), created_at: iso(NOW - 0.02 * DAY) },
  { id: "sig-8", source: "open_meteo", signal_type: "weather", external_id: "nyc-forecast", ticker: "KXTEMP-26MAY25-NYC-T82", category: "Climate", title: "NYC forecast high 83°F", data: { high_f: 83 }, implied_probability: 0.58, fetched_at: iso(NOW - 0.3 * DAY), expires_at: iso(NOW + 0.5 * DAY), created_at: iso(NOW - 0.3 * DAY) },
];

export const externalMarketMappings: ExternalMarketMappingRow[] = [
  { id: "map-1", kalshi_ticker: "KXNBA-26MAY26-BOS", source: "the_odds_api", external_id: "nba-bos-g5", external_title: "Celtics vs Knicks Game 5", match_confidence: 0.96, created_at: iso(NOW - 3 * DAY), updated_at: iso(NOW - 0.1 * DAY) },
  { id: "map-2", kalshi_ticker: "KXFED-26JUN-CUT25", source: "polymarket", external_id: "fed-june-cut", external_title: "Fed June rate cut", match_confidence: 0.91, created_at: iso(NOW - 5 * DAY), updated_at: iso(NOW - 0.2 * DAY) },
  { id: "map-3", kalshi_ticker: "KXBTCD-26MAY25-T108000", source: "binance", external_id: "BTCUSDT", external_title: "BTC/USDT", match_confidence: 0.99, created_at: iso(NOW - 7 * DAY), updated_at: iso(NOW - 0.01 * DAY) },
];

// ── App settings + misc tables referenced by pages ───────────────────────────
export const appSettings: Array<{ key: string; value: unknown; updated_at: string }> = [
  { key: "alerts_enabled", value: true, updated_at: iso(NOW - 1 * DAY) },
  { key: "trading_paused", value: false, updated_at: iso(NOW - 1 * DAY) },
  { key: "demo_mode", value: true, updated_at: iso(NOW - 1 * DAY) },
];

export const syncLog: Array<Record<string, unknown>> = [
  { id: "sync-1", type: "sync-markets", status: "success", records_processed: 41872, error_message: null, started_at: iso(NOW - 0.02 * DAY), completed_at: iso(NOW - 0.015 * DAY) },
  { id: "sync-2", type: "scan-strategies", status: "success", records_processed: 312, error_message: null, started_at: iso(NOW - 0.04 * DAY), completed_at: iso(NOW - 0.038 * DAY) },
  { id: "sync-3", type: "snapshot-prices", status: "success", records_processed: 41872, error_message: null, started_at: iso(NOW - 0.06 * DAY), completed_at: iso(NOW - 0.055 * DAY) },
  { id: "sync-4", type: "fetch-external-data", status: "success", records_processed: 8, error_message: null, started_at: iso(NOW - 0.08 * DAY), completed_at: iso(NOW - 0.079 * DAY) },
];

export const latestPortfolio = LATEST_PORTFOLIO;
export const categoryByEvent = CATEGORY_BY_EVENT;

// ── Demo backtest result (for the in-app backtester in demo mode) ────────────
export function buildDemoBacktest(budget = 10_000): {
  equityCurve: { date: string; value: number }[];
  stats: {
    totalReturn: number;
    totalReturnPct: number;
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
    maxDrawdownPct: number;
    totalTrades: number;
    wins: number;
    losses: number;
  };
  trades: {
    ticker: string;
    side: "yes" | "no";
    entryPrice: number;
    exitPrice: number | null;
    quantity: number;
    pnl: number;
    date: string;
    closedAt: string | null;
  }[];
} {
  const rng = makeRng(424242);
  const days = 90;
  const finalReturnPct = 0.0064; // ~0.64%
  const equityCurve: { date: string; value: number }[] = [];
  for (let d = 0; d <= days; d++) {
    const p = d / days;
    const noise = (rng() - 0.45) * budget * 0.0009 * Math.sin(p * Math.PI);
    const value =
      d === days
        ? Math.round(budget * (1 + finalReturnPct) * 100) / 100
        : Math.round((budget * (1 + finalReturnPct * p) + noise) * 100) / 100;
    equityCurve.push({ date: iso(NOW - (days - d) * DAY).slice(0, 10), value });
  }
  const finalValue = equityCurve[equityCurve.length - 1].value;
  const totalReturn = Math.round((finalValue - budget) * 100) / 100;

  const trades = CLOSED_TRADES.slice(0, 90).map((t) => ({
    ticker: t.ticker,
    side: t.side,
    entryPrice: t.price,
    exitPrice: t.exit_price,
    quantity: t.quantity,
    pnl: t.pnl ?? 0,
    date: t.created_at,
    closedAt: t.closed_at,
  }));
  const wins = trades.filter((t) => t.pnl > 0).length;

  // max drawdown from the curve
  let peak = 0;
  let maxDd = 0;
  for (const pt of equityCurve) {
    if (pt.value > peak) peak = pt.value;
    if (peak > 0) maxDd = Math.max(maxDd, peak - pt.value);
  }

  return {
    equityCurve,
    stats: {
      totalReturn,
      totalReturnPct: Math.round((totalReturn / budget) * 10000) / 100,
      winRate: Math.round((wins / trades.length) * 1000) / 1000,
      sharpeRatio: 0.84,
      maxDrawdown: Math.round(maxDd * 100) / 100,
      maxDrawdownPct: Math.round((maxDd / (peak || budget)) * 10000) / 100,
      totalTrades: trades.length,
      wins,
      losses: trades.length - wins,
    },
    trades,
  };
}

// ── Table -> fixture rows lookup used by the mock Supabase client ────────────
export const TABLE_DATA: Record<string, unknown[]> = {
  strategies,
  events,
  markets,
  portfolio_snapshots: portfolioSnapshots,
  paper_trades: paperTrades,
  predictions,
  strategy_learnings: strategyLearnings,
  reviews,
  external_signals: externalSignals,
  external_market_mappings: externalMarketMappings,
  app_settings: appSettings,
  sync_log: syncLog,
  // Tables the dashboard touches but for which an empty set is fine:
  orderbook_snapshots: [],
  price_snapshots: [],
  market_candles: [],
  market_trades: [],
  alert_history: [],
  backtest_results: [],
  watchlist: [],
  prediction_calibration: [],
};
