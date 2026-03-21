import crypto from "crypto";
import fs from "fs";
import path from "path";
import type {
  KalshiMarketsResponse,
  KalshiEventResponse,
  KalshiTradesResponse,
  KalshiOrderBookResponse,
  KalshiMarket,
} from "./types";
import { dollarsToCents, fpToInt } from "./types";

// Normalized market with cents (0-100) for DB compatibility
export interface NormalizedMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string;
  status: string;
  yes_bid: number;
  yes_ask: number;
  last_price: number;
  volume: number;
  open_interest: number;
  close_time: string;
  result: string;
  market_type: string;
  volume_24h: number | null;
  liquidity: number | null;
}

export function normalizeMarket(m: KalshiMarket): NormalizedMarket {
  return {
    ticker: m.ticker,
    event_ticker: m.event_ticker,
    title: m.title,
    subtitle: m.subtitle,
    status: m.status,
    yes_bid: dollarsToCents(m.yes_bid_dollars) ?? 0,
    yes_ask: dollarsToCents(m.yes_ask_dollars) ?? 0,
    last_price: dollarsToCents(m.last_price_dollars) ?? 0,
    volume: fpToInt(m.volume_fp) ?? 0,
    open_interest: fpToInt(m.open_interest_fp) ?? 0,
    close_time: m.close_time,
    result: m.result,
    market_type: m.market_type,
    volume_24h: fpToInt(m.volume_24h_fp),
    liquidity: m.liquidity_dollars ? parseFloat(m.liquidity_dollars) : null,
  };
}

const DEMO_BASE = "https://demo-api.kalshi.co/trade-api/v2";
const PROD_BASE = "https://api.elections.kalshi.com/trade-api/v2";

interface KalshiClientConfig {
  keyId: string;
  privateKeyPem: string;
  baseUrl: string;
}

function loadConfig(): KalshiClientConfig {
  const isDemo = (process.env.KALSHI_API_BASE_URL || DEMO_BASE).includes("demo");

  const keyId = isDemo
    ? process.env.KALSHI_API_KEY_ID_DEMO!
    : process.env.KALSHI_API_KEY_ID!;

  // Support inline PEM via env var (for Vercel) or file path (for local dev)
  let privateKeyPem: string;
  const envPem = isDemo
    ? process.env.KALSHI_PRIVATE_KEY_DEMO
    : process.env.KALSHI_PRIVATE_KEY;

  if (envPem) {
    // Env var contains the PEM content directly (newlines as \n)
    privateKeyPem = envPem.replace(/\\n/g, "\n");
  } else {
    // Fall back to reading from file path
    const keyPath = isDemo
      ? process.env.KALSHI_API_PRIVATE_KEY_PATH_DEMO || "./kalshi/private_key_demo.pem"
      : process.env.KALSHI_API_PRIVATE_KEY_PATH || "./kalshi/private_key.pem";
    privateKeyPem = fs.readFileSync(path.resolve(keyPath), "utf-8");
  }

  return {
    keyId,
    privateKeyPem,
    baseUrl: process.env.KALSHI_API_BASE_URL || DEMO_BASE,
  };
}

function signRequest(
  privateKeyPem: string,
  timestamp: number,
  method: string,
  requestPath: string
): string {
  const message = `${timestamp}${method.toUpperCase()}${requestPath}`;
  const key = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign("sha256", Buffer.from(message), {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString("base64");
}

async function kalshiFetch<T>(
  method: string,
  endpoint: string,
  params?: Record<string, string>
): Promise<T> {
  const config = loadConfig();

  const url = new URL(`${config.baseUrl}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const requestPath = url.pathname + url.search;
  const signature = signRequest(config.privateKeyPem, timestamp, method, requestPath);

  const response = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      "KALSHI-ACCESS-KEY": config.keyId,
      "KALSHI-ACCESS-SIGNATURE": signature,
      "KALSHI-ACCESS-TIMESTAMP": timestamp.toString(),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kalshi API ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

export async function getMarkets(
  params: {
    limit?: number;
    cursor?: string;
    status?: string;
    event_ticker?: string;
  } = {}
): Promise<KalshiMarketsResponse> {
  const queryParams: Record<string, string> = {};
  if (params.limit) queryParams.limit = params.limit.toString();
  if (params.cursor) queryParams.cursor = params.cursor;
  if (params.status) queryParams.status = params.status;
  if (params.event_ticker) queryParams.event_ticker = params.event_ticker;

  return kalshiFetch<KalshiMarketsResponse>("GET", "/markets", queryParams);
}

export async function getAllActiveMarkets(): Promise<KalshiMarket[]> {
  const all: KalshiMarket[] = [];
  let cursor: string | undefined;

  do {
    const response = await getMarkets({
      limit: 200,
      status: "open",
      cursor,
    });
    all.push(...response.markets);
    cursor = response.cursor || undefined;
  } while (cursor);

  return all;
}

export async function getSettledMarkets(limit: number = 500): Promise<KalshiMarket[]> {
  const all: KalshiMarket[] = [];
  let cursor: string | undefined;

  do {
    const response = await getMarkets({
      limit: 200,
      status: "settled",
      cursor,
    });
    all.push(...response.markets);
    cursor = response.cursor || undefined;
  } while (cursor || all.length >= limit);

  return all.slice(0, limit);
}

export async function getEvent(eventTicker: string): Promise<KalshiEventResponse> {
  return kalshiFetch<KalshiEventResponse>("GET", `/events/${eventTicker}`);
}

export async function getTrades(
  ticker: string,
  params: { limit?: number; cursor?: string } = {}
): Promise<KalshiTradesResponse> {
  const queryParams: Record<string, string> = { ticker };
  if (params.limit) queryParams.limit = params.limit.toString();
  if (params.cursor) queryParams.cursor = params.cursor;

  return kalshiFetch<KalshiTradesResponse>("GET", "/markets/trades", queryParams);
}

export async function getMarketRaw(ticker: string): Promise<KalshiMarket> {
  const response = await kalshiFetch<{ market: KalshiMarket }>(
    "GET",
    `/markets/${ticker}`
  );
  return response.market;
}

export async function getMarket(ticker: string): Promise<NormalizedMarket> {
  const raw = await getMarketRaw(ticker);
  return normalizeMarket(raw);
}

export async function getOrderBook(
  ticker: string,
  depth: number = 5
): Promise<KalshiOrderBookResponse> {
  return kalshiFetch<KalshiOrderBookResponse>(
    "GET",
    `/markets/${ticker}/orderbook`,
    { depth: depth.toString() }
  );
}
