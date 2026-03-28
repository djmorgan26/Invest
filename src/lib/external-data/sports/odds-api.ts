import type { DataConnector, ExternalSignal, OddsApiEvent } from "../types";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// Sports keys for The Odds API — covers the major US leagues
const SPORT_KEYS = [
  "americanfootball_nfl",
  "basketball_nba",
  "baseball_mlb",
  "icehockey_nhl",
  "soccer_usa_mls",
  "americanfootball_ncaaf",
  "basketball_ncaab",
];

function oddsToImpliedProb(americanOdds: number): number {
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

function decimalToImpliedProb(decimal: number): number {
  return 1 / decimal;
}

export const oddsApi: DataConnector = {
  source: "odds_api",

  async fetchSignals(): Promise<ExternalSignal[]> {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) {
      console.warn("[OddsAPI] ODDS_API_KEY not set, skipping");
      return [];
    }

    const signals: ExternalSignal[] = [];
    const now = new Date().toISOString();

    for (const sportKey of SPORT_KEYS) {
      try {
        const url = `${ODDS_API_BASE}/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=decimal`;
        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 401) {
            console.error("[OddsAPI] Invalid API key");
            return signals;
          }
          continue;
        }

        const events: OddsApiEvent[] = await res.json();

        for (const event of events) {
          // Aggregate consensus odds across all bookmakers
          const h2hOdds: Record<string, number[]> = {};
          const spreads: Record<string, { point: number; price: number }[]> = {};
          let totalOverUnder: number[] = [];

          for (const book of event.bookmakers) {
            for (const market of book.markets) {
              if (market.key === "h2h") {
                for (const outcome of market.outcomes) {
                  if (!h2hOdds[outcome.name]) h2hOdds[outcome.name] = [];
                  h2hOdds[outcome.name].push(outcome.price);
                }
              } else if (market.key === "spreads") {
                for (const outcome of market.outcomes) {
                  if (!spreads[outcome.name]) spreads[outcome.name] = [];
                  spreads[outcome.name].push({ point: outcome.point ?? 0, price: outcome.price });
                }
              } else if (market.key === "totals") {
                const over = market.outcomes.find((o) => o.name === "Over");
                if (over?.point) totalOverUnder.push(over.point);
              }
            }
          }

          // Compute consensus implied probability for each team
          const consensusProbs: Record<string, number> = {};
          for (const [team, odds] of Object.entries(h2hOdds)) {
            const avgDecimal = odds.reduce((a, b) => a + b, 0) / odds.length;
            consensusProbs[team] = decimalToImpliedProb(avgDecimal);
          }

          const avgOverUnder = totalOverUnder.length > 0
            ? totalOverUnder.reduce((a, b) => a + b, 0) / totalOverUnder.length
            : null;

          signals.push({
            source: "odds_api",
            signal_type: "odds",
            external_id: event.id,
            category: "sports",
            title: `${event.sport_title}: ${event.away_team} @ ${event.home_team}`,
            data: {
              sport_key: event.sport_key,
              sport_title: event.sport_title,
              home_team: event.home_team,
              away_team: event.away_team,
              commence_time: event.commence_time,
              consensus_implied_prob: consensusProbs,
              num_bookmakers: event.bookmakers.length,
              avg_over_under: avgOverUnder,
              bookmaker_names: event.bookmakers.map((b) => b.title),
            },
            implied_probability: consensusProbs[event.home_team] ?? undefined,
            fetched_at: now,
            expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          });
        }
      } catch (err) {
        console.error(`[OddsAPI] Error fetching ${sportKey}:`, err);
      }
    }

    console.log(`[OddsAPI] Fetched ${signals.length} signals`);
    return signals;
  },
};
