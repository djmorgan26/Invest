/**
 * ESPN Fast Poller — Polls ESPN scoreboard every 10 seconds for live score changes.
 * ESPN doesn't have WebSockets, but 10s polling is fast enough to beat Kalshi repricing.
 *
 * The edge: ESPN updates scores within seconds of plays happening.
 * Kalshi sports markets often take 30s-2min to reprice after scoring events.
 * That gap is our window.
 */

import type { LiveScore } from "./types";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

const LEAGUES = [
  { path: "football/nfl", league: "NFL" },
  { path: "basketball/nba", league: "NBA" },
  { path: "baseball/mlb", league: "MLB" },
  { path: "hockey/nhl", league: "NHL" },
  { path: "soccer/usa.1", league: "MLS" },
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
      }[];
    }[];
  }[];
}

// Track previous scores to detect changes
const previousScores = new Map<string, { home: number; away: number }>();

export class EspnPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private listeners: ((score: LiveScore, changed: boolean) => void)[] = [];
  private pollIntervalMs: number;

  constructor(pollIntervalMs: number = 10_000) {
    this.pollIntervalMs = pollIntervalMs;
  }

  onScore(listener: (score: LiveScore, changed: boolean) => void): void {
    this.listeners.push(listener);
  }

  start(): void {
    if (this.intervalId) return;
    console.log(`[ESPN Poller] Starting (every ${this.pollIntervalMs / 1000}s)`);

    // Initial poll
    this.poll();

    // Recurring poll
    this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[ESPN Poller] Stopped");
    }
  }

  private async poll(): Promise<void> {
    for (const { path, league } of LEAGUES) {
      try {
        const res = await fetch(`${ESPN_BASE}/${path}/scoreboard`);
        if (!res.ok) continue;

        const data: EspnScoreboard = await res.json();

        for (const event of data.events) {
          const comp = event.competitions[0];
          if (!comp) continue;

          const home = comp.competitors.find((c) => c.homeAway === "home");
          const away = comp.competitors.find((c) => c.homeAway === "away");
          if (!home || !away) continue;

          const homeScore = parseInt(home.score) || 0;
          const awayScore = parseInt(away.score) || 0;
          const gameState = event.status.type.state as "pre" | "in" | "post";

          // Only track live games
          if (gameState !== "in") continue;

          const key = `${league}-${event.id}`;
          const prev = previousScores.get(key);
          const changed =
            prev !== undefined &&
            (prev.home !== homeScore || prev.away !== awayScore);

          previousScores.set(key, { home: homeScore, away: awayScore });

          const score: LiveScore = {
            source: "espn",
            league,
            event_id: event.id,
            home_team: home.team.displayName,
            away_team: away.team.displayName,
            home_score: homeScore,
            away_score: awayScore,
            game_state: gameState,
            clock: event.status.displayClock ?? null,
            period: event.status.period ?? null,
            status_desc: event.status.type.description,
            timestamp: Date.now(),
          };

          // Notify listeners
          for (const listener of this.listeners) {
            try {
              listener(score, changed);
            } catch (err) {
              console.error("[ESPN Poller] Listener error:", err);
            }
          }
        }
      } catch (err) {
        // Silently continue on network errors
      }
    }
  }
}
