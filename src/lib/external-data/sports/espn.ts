import type { DataConnector, ExternalSignal } from "../types";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

// Major sports leagues ESPN covers
const SPORTS = [
  { path: "football/nfl", label: "NFL" },
  { path: "basketball/nba", label: "NBA" },
  { path: "baseball/mlb", label: "MLB" },
  { path: "hockey/nhl", label: "NHL" },
  { path: "soccer/usa.1", label: "MLS" },
];

interface EspnScoreboard {
  events: {
    id: string;
    name: string;
    date: string;
    status: {
      type: { state: string; completed: boolean; description: string };
      displayClock?: string;
      period?: number;
    };
    competitions: {
      competitors: {
        team: { displayName: string; abbreviation: string };
        score: string;
        homeAway: string;
        winner?: boolean;
      }[];
      odds?: { details: string; overUnder: number; spread: number }[];
    }[];
  }[];
}

export const espn: DataConnector = {
  source: "espn",

  async fetchSignals(): Promise<ExternalSignal[]> {
    const signals: ExternalSignal[] = [];
    const now = new Date().toISOString();

    for (const sport of SPORTS) {
      try {
        const res = await fetch(`${ESPN_BASE}/${sport.path}/scoreboard`);
        if (!res.ok) continue;

        const data: EspnScoreboard = await res.json();

        for (const event of data.events) {
          const comp = event.competitions[0];
          if (!comp) continue;

          const home = comp.competitors.find((c) => c.homeAway === "home");
          const away = comp.competitors.find((c) => c.homeAway === "away");
          if (!home || !away) continue;

          const odds = comp.odds?.[0];

          signals.push({
            source: "espn",
            signal_type: "score",
            external_id: event.id,
            category: "sports",
            title: `${sport.label}: ${away.team.displayName} @ ${home.team.displayName}`,
            data: {
              league: sport.label,
              home_team: home.team.displayName,
              home_abbr: home.team.abbreviation,
              away_team: away.team.displayName,
              away_abbr: away.team.abbreviation,
              home_score: parseInt(home.score) || 0,
              away_score: parseInt(away.score) || 0,
              game_state: event.status.type.state, // "pre", "in", "post"
              completed: event.status.type.completed,
              status_desc: event.status.type.description,
              game_time: event.date,
              clock: event.status.displayClock,
              period: event.status.period,
              ...(odds && {
                spread: odds.details,
                over_under: odds.overUnder,
              }),
            },
            fetched_at: now,
            expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(), // 2 min for live scores
          });
        }
      } catch (err) {
        console.error(`[ESPN] Error fetching ${sport.label}:`, err);
      }
    }

    console.log(`[ESPN] Fetched ${signals.length} signals`);
    return signals;
  },
};
