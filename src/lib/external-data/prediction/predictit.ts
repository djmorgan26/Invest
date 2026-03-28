import type { DataConnector, ExternalSignal, PredictItMarket } from "../types";

const PREDICTIT_API = "https://www.predictit.org/api/marketdata/all/";

export const predictit: DataConnector = {
  source: "predictit",

  async fetchSignals(): Promise<ExternalSignal[]> {
    const signals: ExternalSignal[] = [];
    const now = new Date().toISOString();

    try {
      const res = await fetch(PREDICTIT_API);
      if (!res.ok) throw new Error(`PredictIt API ${res.status}: ${res.statusText}`);

      const data: { markets: PredictItMarket[] } = await res.json();

      for (const market of data.markets) {
        if (market.status !== "Open") continue;

        for (const contract of market.contracts) {
          if (contract.lastTradePrice === 0 && !contract.bestBuyYesCost) continue;

          signals.push({
            source: "predictit",
            signal_type: "price",
            external_id: String(contract.id),
            category: "politics", // PredictIt is mostly political
            title: `${market.shortName}: ${contract.shortName}`,
            data: {
              market_id: market.id,
              market_name: market.name,
              contract_name: contract.name,
              last_trade_price: contract.lastTradePrice,
              best_buy_yes: contract.bestBuyYesCost,
              best_buy_no: contract.bestBuyNoCost,
              best_sell_yes: contract.bestSellYesCost,
              best_sell_no: contract.bestSellNoCost,
            },
            implied_probability: contract.lastTradePrice,
            fetched_at: now,
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
          });
        }
      }
    } catch (err) {
      console.error("[PredictIt] Fetch error:", err);
    }

    console.log(`[PredictIt] Fetched ${signals.length} signals`);
    return signals;
  },
};
