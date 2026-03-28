// Shared types for all external data connectors

export type SignalSource =
  | "polymarket"
  | "predictit"
  | "odds_api"
  | "fred"
  | "bls"
  | "espn"
  | "coingecko"
  | "open_meteo"
  | "nws"
  | "coinmarketcap";

export type SignalType =
  | "price"
  | "odds"
  | "forecast"
  | "economic_indicator"
  | "score"
  | "sentiment";

export type SignalCategory =
  | "politics"
  | "crypto"
  | "sports"
  | "weather"
  | "economics"
  | "entertainment"
  | "science"
  | "other";

export interface ExternalSignal {
  source: SignalSource;
  signal_type: SignalType;
  external_id?: string;
  ticker?: string; // Kalshi ticker if mapped
  category: SignalCategory;
  title: string;
  data: Record<string, unknown>;
  implied_probability?: number; // 0-1
  fetched_at: string;
  expires_at?: string;
}

export interface ExternalMarketMapping {
  kalshi_ticker: string;
  source: SignalSource;
  external_id: string;
  external_title?: string;
  match_confidence: number;
}

// Polymarket-specific
export interface PolymarketMarket {
  condition_id: string;
  question: string;
  tokens: { token_id: string; outcome: string; price: number }[];
  volume: number;
  liquidity: number;
  end_date_iso: string;
  active: boolean;
  closed: boolean;
  category: string;
}

// PredictIt-specific
export interface PredictItMarket {
  id: number;
  name: string;
  shortName: string;
  contracts: PredictItContract[];
  status: string;
}

export interface PredictItContract {
  id: number;
  name: string;
  shortName: string;
  lastTradePrice: number;
  bestBuyYesCost: number | null;
  bestBuyNoCost: number | null;
  bestSellYesCost: number | null;
  bestSellNoCost: number | null;
}

// The Odds API
export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
}

export interface OddsApiMarket {
  key: string; // h2h, spreads, totals
  outcomes: { name: string; price: number; point?: number }[];
}

// FRED API
export interface FredSeries {
  id: string;
  title: string;
  observation_start: string;
  observation_end: string;
  frequency: string;
  units: string;
}

export interface FredObservation {
  date: string;
  value: string; // FRED returns strings, "." for missing
}

// ESPN
export interface EspnEvent {
  id: string;
  name: string;
  date: string;
  status: { type: { state: string; completed: boolean; description: string } };
  competitions: EspnCompetition[];
}

export interface EspnCompetition {
  competitors: {
    team: { displayName: string; abbreviation: string };
    score: string;
    homeAway: string;
    winner?: boolean;
  }[];
  odds?: { details: string; overUnder: number }[];
}

// CoinGecko
export interface CoinGeckoPrice {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
}

// Weather
export interface OpenMeteoForecast {
  latitude: number;
  longitude: number;
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: number[];
    weathercode: number[];
  };
}

export interface NwsForecast {
  properties: {
    periods: {
      number: number;
      name: string;
      startTime: string;
      endTime: string;
      temperature: number;
      temperatureUnit: string;
      shortForecast: string;
      detailedForecast: string;
      probabilityOfPrecipitation: { value: number | null };
    }[];
  };
}

// Connector interface all sources implement
export interface DataConnector {
  source: SignalSource;
  fetchSignals(): Promise<ExternalSignal[]>;
}
