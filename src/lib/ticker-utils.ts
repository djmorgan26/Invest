/**
 * Parse a Kalshi ticker into a human-readable description.
 * Tickers follow patterns like:
 *   KXBTCD-26MAR2017-T73749.99  → BTC above $73,749.99 on Mar 26
 *   KXWTIW-26MAR20-B97.5        → WTI Crude below $97.50 on Mar 26
 *   INX-25DEC31-T6000            → S&P 500 above 6000 on Dec 31
 */

const ASSET_MAP: Record<string, string> = {
  KXBTCD: "Bitcoin",
  KXBTCW: "Bitcoin",
  KXBTC: "Bitcoin",
  KXETHD: "Ethereum",
  KXETHW: "Ethereum",
  KXETH: "Ethereum",
  KXWTIW: "WTI Crude Oil",
  KXWTID: "WTI Crude Oil",
  INX: "S&P 500",
  INXD: "S&P 500",
  INXW: "S&P 500",
  NASDAQ100: "Nasdaq 100",
  GDPNOW: "GDP",
  CPI: "CPI",
  KXSOLD: "SOL",
  KXSOLW: "SOL",
};

const MONTH_MAP: Record<string, string> = {
  JAN: "Jan",
  FEB: "Feb",
  MAR: "Mar",
  APR: "Apr",
  MAY: "May",
  JUN: "Jun",
  JUL: "Jul",
  AUG: "Aug",
  SEP: "Sep",
  OCT: "Oct",
  NOV: "Nov",
  DEC: "Dec",
};

export interface ParsedTicker {
  asset: string;
  direction: "above" | "below" | null;
  strike: string | null;
  date: string | null;
  summary: string;
}

export function parseTicker(ticker: string): ParsedTicker {
  // Try to match standard Kalshi patterns
  // Pattern: PREFIX-DDMMMYY-[T|B]STRIKE
  const parts = ticker.split("-");

  if (parts.length < 2) {
    return { asset: ticker, direction: null, strike: null, date: null, summary: ticker };
  }

  const prefix = parts[0];

  // Find asset from prefix
  let asset = prefix;
  for (const [key, name] of Object.entries(ASSET_MAP)) {
    if (prefix.startsWith(key)) {
      asset = name;
      break;
    }
  }

  // Parse date from second part (e.g., "26MAR20" or "25DEC31")
  let date: string | null = null;
  const dateMatch = parts[1]?.match(/^(\d{1,2})([A-Z]{3})(\d{2,4})$/);
  if (dateMatch) {
    const day = dateMatch[1];
    const monthStr = MONTH_MAP[dateMatch[2]] ?? dateMatch[2];
    date = `${monthStr} ${day}`;
  }

  // Parse direction and strike from last part (e.g., "T73749.99" or "B97.5")
  let direction: "above" | "below" | null = null;
  let strike: string | null = null;
  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    const strikeMatch = lastPart.match(/^([TB])(\d+\.?\d*)$/);
    if (strikeMatch) {
      direction = strikeMatch[1] === "T" ? "above" : "below";
      const num = parseFloat(strikeMatch[2]);
      strike = num >= 1000
        ? `$${num.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
        : num >= 1
          ? `$${num}`
          : `${num}`;
    }
  }

  // Build summary
  let summary: string;
  if (strike && direction && date) {
    summary = `${asset} ${direction} ${strike} on ${date}`;
  } else if (strike && direction) {
    summary = `${asset} ${direction} ${strike}`;
  } else if (date) {
    summary = `${asset} — ${date}`;
  } else {
    summary = asset !== prefix ? asset : ticker;
  }

  return { asset, direction, strike, date, summary };
}

export function daysUntil(closeTime: string | null): number | null {
  if (!closeTime) return null;
  const diff = new Date(closeTime).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86400000);
}

export function daysUntilLabel(closeTime: string | null): string | null {
  const days = daysUntil(closeTime);
  if (days === null) return null;
  if (days === 0) return "Closing today";
  if (days === 1) return "1 day left";
  return `${days}d left`;
}
