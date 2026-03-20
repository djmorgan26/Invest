import type { Market } from "@/lib/supabase/types";
import type { Strategy, Opportunity, ScanContext, StrategyConfig } from "./types";
import { isEntryPriceSafe, minEdgeAfterFees, riskRewardRatio } from "./kalshi-math";

const STRATEGY_ID = "stale-price";
const DEFAULT_CONFIG = {
  min_sibling_settlement_hours: 1,
  max_hours_since_settlement: 48,
};

function getConfig(dbConfig: StrategyConfig) {
  return { ...DEFAULT_CONFIG, ...dbConfig };
}

export const stalePrice: Strategy = {
  id: STRATEGY_ID,
  name: "Stale Price",

  async scan(markets: Market[], context: ScanContext): Promise<Opportunity[]> {
    const { data: strategy } = await context.supabase
      .from("strategies")
      .select("config")
      .eq("id", STRATEGY_ID)
      .single();

    const config = getConfig((strategy?.config as StrategyConfig) ?? {});
    const now = Date.now();
    const opportunities: Opportunity[] = [];

    // Group markets by event_ticker
    const eventGroups = new Map<string, Market[]>();
    for (const m of markets) {
      const group = eventGroups.get(m.event_ticker) ?? [];
      group.push(m);
      eventGroups.set(m.event_ticker, group);
    }

    for (const [eventTicker, siblings] of eventGroups) {
      // Find settled siblings in this event
      const settled = siblings.filter((m) => m.result && m.result !== "");
      const open = siblings.filter((m) => !m.result && (m.status === "open" || m.status === "active"));

      if (settled.length === 0 || open.length === 0) continue;

      // Check if settlement was recent enough to matter
      const recentlySettled = settled.some((m) => {
        if (!m.updated_at) return false;
        const hoursAgo = (now - new Date(m.updated_at).getTime()) / (1000 * 60 * 60);
        return hoursAgo >= config.min_sibling_settlement_hours &&
               hoursAgo <= config.max_hours_since_settlement;
      });

      if (!recentlySettled) continue;

      // For each open sibling, check if its price seems stale
      for (const m of open) {
        if (m.last_price == null) continue;
        if ((m.volume ?? 0) < 20) continue;

        const lastPrice = m.last_price / 100; // normalize

        // Get price snapshots to see if price has moved since settlement
        const { data: snapshots } = await context.supabase
          .from("price_snapshots")
          .select("last_price, snapshot_at")
          .eq("ticker", m.ticker)
          .order("snapshot_at", { ascending: false })
          .limit(10);

        if (!snapshots || snapshots.length < 2) continue;

        // Check price stability — if price hasn't moved > 2¢ in recent snapshots
        const prices = snapshots.map((s) => s.last_price);
        const priceRange = Math.max(...prices) - Math.min(...prices);
        if (priceRange > 5) continue; // price is already moving, not stale

        // The logic: if one sibling settled YES (e.g., "Team wins by 5+"),
        // related markets should reprice. If they haven't, there's an opportunity.
        // Conservative: small edge since we're inferring from correlation
        const settledResults = settled.map((s) => `${s.ticker}=${s.result}`).join(", ");

        // Heuristic: if sibling settled YES and this market is cheap, it may be underpriced
        // If sibling settled NO and this market is expensive, it may be overpriced
        const yesSettled = settled.filter((s) => s.result === "yes").length;
        const noSettled = settled.filter((s) => s.result === "no").length;

        let side: "yes" | "no";
        let fairValue: number;

        if (yesSettled > noSettled && lastPrice < 0.4) {
          // Siblings resolving YES suggests related markets should be higher
          side = "yes";
          fairValue = Math.min(lastPrice + 0.10, 0.9);
        } else if (noSettled > yesSettled && lastPrice > 0.6) {
          // Siblings resolving NO suggests related markets should be lower
          side = "no";
          fairValue = Math.max(lastPrice - 0.10, 0.1);
        } else {
          continue;
        }

        const edge = Math.abs(fairValue - lastPrice);
        if (edge < 0.05) continue;

        // Entry price = what we'd pay as taker
        const entryPrice = side === "yes"
          ? (m.yes_ask != null ? m.yes_ask / 100 : lastPrice)
          : (m.yes_bid != null ? (100 - m.yes_bid) / 100 : 1 - lastPrice);

        // Guardrails
        if (!isEntryPriceSafe(entryPrice, STRATEGY_ID)) continue;
        if (riskRewardRatio(entryPrice) < 0.20) continue;
        if (edge < minEdgeAfterFees(entryPrice)) continue;

        opportunities.push({
          ticker: m.ticker,
          event_ticker: eventTicker,
          market_title: m.title,
          strategy_id: STRATEGY_ID,
          side,
          confidence: Math.min(0.5 + edge * 0.5, 0.75),
          fair_value: Math.round(fairValue * 10000) / 10000,
          edge: Math.round(edge * 10000) / 10000,
          reasoning: `Stale price: siblings settled (${settledResults}) but ${m.ticker} hasn't repriced. Last=${(lastPrice * 100).toFixed(0)}¢ → FV=${(fairValue * 100).toFixed(0)}¢. Entry=${(entryPrice * 100).toFixed(0)}¢ ${side.toUpperCase()}. R/R=${riskRewardRatio(entryPrice).toFixed(2)}. Vol=${m.volume}.`,
          quantity: 10,
        });
      }
    }

    opportunities.sort((a, b) => b.edge - a.edge);
    return opportunities;
  },
};
