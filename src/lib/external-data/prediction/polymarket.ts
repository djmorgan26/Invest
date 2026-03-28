import type { DataConnector, ExternalSignal, SignalCategory } from "../types";

const GAMMA_API = "https://gamma-api.polymarket.com";

interface PolymarketEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  active: boolean;
  closed: boolean;
  volume: number;
  liquidity: number;
  endDate: string;
  markets: PolymarketEventMarket[];
}

interface PolymarketEventMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomePrices: string; // JSON string of [yesPrice, noPrice]
  volume: number;
  liquidity: number;
  active: boolean;
  closed: boolean;
  groupItemTitle?: string;
}

function categorize(title: string): SignalCategory {
  const lower = title.toLowerCase();
  if (lower.includes("bitcoin") || lower.includes("btc") || lower.includes("eth") || lower.includes("crypto")) return "crypto";
  if (lower.includes("election") || lower.includes("president") || lower.includes("trump") || lower.includes("congress") || lower.includes("senate")) return "politics";
  if (lower.includes("nfl") || lower.includes("nba") || lower.includes("mlb") || lower.includes("super bowl") || lower.includes("world cup")) return "sports";
  if (lower.includes("temperature") || lower.includes("hurricane") || lower.includes("weather")) return "weather";
  if (lower.includes("cpi") || lower.includes("gdp") || lower.includes("fed") || lower.includes("inflation") || lower.includes("jobs") || lower.includes("unemployment")) return "economics";
  return "other";
}

export const polymarket: DataConnector = {
  source: "polymarket",

  async fetchSignals(): Promise<ExternalSignal[]> {
    const signals: ExternalSignal[] = [];
    const now = new Date().toISOString();

    try {
      // Fetch active events with high volume
      const res = await fetch(
        `${GAMMA_API}/events?active=true&closed=false&limit=100&order=volume&ascending=false`
      );
      if (!res.ok) throw new Error(`Polymarket API ${res.status}: ${res.statusText}`);

      const events: PolymarketEvent[] = await res.json();

      for (const event of events) {
        if (!event.markets) continue;

        for (const market of event.markets) {
          if (market.closed || !market.active) continue;

          let yesPrice = 0;
          let noPrice = 0;
          try {
            const prices = JSON.parse(market.outcomePrices);
            yesPrice = parseFloat(prices[0]) || 0;
            noPrice = parseFloat(prices[1]) || 0;
          } catch {
            continue;
          }

          if (yesPrice === 0 && noPrice === 0) continue;

          signals.push({
            source: "polymarket",
            signal_type: "price",
            external_id: market.conditionId,
            category: categorize(market.question || event.title),
            title: market.question || event.title,
            data: {
              yes_price: yesPrice,
              no_price: noPrice,
              volume: market.volume,
              liquidity: market.liquidity,
              event_title: event.title,
              slug: market.slug,
              end_date: event.endDate,
              group_item: market.groupItemTitle,
            },
            implied_probability: yesPrice,
            fetched_at: now,
            expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min
          });
        }
      }
    } catch (err) {
      console.error("[Polymarket] Fetch error:", err);
    }

    console.log(`[Polymarket] Fetched ${signals.length} signals`);
    return signals;
  },
};
