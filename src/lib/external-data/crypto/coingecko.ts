import type { DataConnector, ExternalSignal, CoinGeckoPrice } from "../types";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// Top coins that commonly appear in Kalshi crypto markets
const COIN_IDS = [
  "bitcoin",
  "ethereum",
  "solana",
  "dogecoin",
  "ripple",
  "cardano",
  "avalanche-2",
  "chainlink",
  "polkadot",
  "polygon-ecosystem-token",
];

export const coingecko: DataConnector = {
  source: "coingecko",

  async fetchSignals(): Promise<ExternalSignal[]> {
    const signals: ExternalSignal[] = [];
    const now = new Date().toISOString();

    try {
      const ids = COIN_IDS.join(",");
      const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=1h,24h,7d`;
      const res = await fetch(url);

      if (!res.ok) {
        // CoinGecko rate limits aggressively on free tier
        if (res.status === 429) {
          console.warn("[CoinGecko] Rate limited, will retry next cycle");
          return [];
        }
        throw new Error(`CoinGecko API ${res.status}: ${res.statusText}`);
      }

      const coins: (CoinGeckoPrice & {
        price_change_percentage_1h_in_currency?: number;
        price_change_percentage_7d_in_currency?: number;
        ath: number;
        atl: number;
      })[] = await res.json();

      for (const coin of coins) {
        signals.push({
          source: "coingecko",
          signal_type: "price",
          external_id: coin.id,
          category: "crypto",
          title: `${coin.name} (${coin.symbol.toUpperCase()}): $${coin.current_price.toLocaleString()}`,
          data: {
            coin_id: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            price_usd: coin.current_price,
            change_1h_pct: coin.price_change_percentage_1h_in_currency ?? null,
            change_24h_pct: coin.price_change_percentage_24h,
            change_7d_pct: coin.price_change_percentage_7d_in_currency ?? null,
            market_cap: coin.market_cap,
            volume_24h: coin.total_volume,
            high_24h: coin.high_24h,
            low_24h: coin.low_24h,
            ath: coin.ath,
            atl: coin.atl,
          },
          fetched_at: now,
          expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(), // 3 min
        });
      }
    } catch (err) {
      console.error("[CoinGecko] Fetch error:", err);
    }

    // Also fetch Fear & Greed Index
    try {
      const fngRes = await fetch("https://api.alternative.me/fng/?limit=1");
      if (fngRes.ok) {
        const fngData: { data: { value: string; value_classification: string; timestamp: string }[] } = await fngRes.json();
        const fng = fngData.data[0];
        if (fng) {
          signals.push({
            source: "coingecko",
            signal_type: "sentiment",
            external_id: "fear-greed-index",
            category: "crypto",
            title: `Crypto Fear & Greed: ${fng.value} (${fng.value_classification})`,
            data: {
              value: parseInt(fng.value),
              classification: fng.value_classification,
              timestamp: fng.timestamp,
            },
            fetched_at: now,
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
          });
        }
      }
    } catch (err) {
      console.error("[CoinGecko] Fear & Greed error:", err);
    }

    console.log(`[CoinGecko] Fetched ${signals.length} signals`);
    return signals;
  },
};
