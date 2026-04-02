/**
 * ML Model Scorer — Uses trained XGBoost model to score market opportunities.
 *
 * Instead of replacing existing strategies, this acts as a calibration layer:
 * 1. Takes opportunities found by rule-based strategies
 * 2. Computes ML features for each market
 * 3. Scores with the trained model to get P(YES)
 * 4. Adjusts confidence and filters low-quality opportunities
 *
 * The model runs via a pre-computed scoring table (updated periodically)
 * or via direct feature computation + ONNX inference.
 */

import type { Market } from "@/lib/supabase/types";
import type { Opportunity } from "./types";

/** Features the ML model expects (must match training pipeline) */
export interface MLFeatures {
  // Trade microstructure
  total_trades: number;
  total_volume: number;
  last_trade_price: number;
  vwap: number;
  volatility: number;
  taker_imbalance: number;
  avg_trade_size: number;
  max_trade_size: number;
  trade_size_std: number;
  trade_freq_24h: number;
  momentum_1h: number;
  momentum_6h: number;
  momentum_24h: number;
  acceleration: number;
  volume_surge: number;
  vpin: number;
  price_range: number;
  last_trade_trend: number;
  // Candle technicals
  rsi: number;
  bb_position: number;
  atr: number;
  vol_trend: number;
  candle_sentiment: number;
  price_in_range: number;
  candle_count: number;
  // Temporal
  hours_to_close: number;
  market_age_hours: number;
  time_fraction: number;
  close_hour_utc: number;
  close_day_of_week: number;
  is_weekend_close: number;
  // Structure
  sibling_count: number;
  sibling_yes_sum: number;
  sibling_yes_spread: number;
  relative_volume: number;
  is_favorite: number;
  is_longshot: number;
  // External
  external_prob_mean: number;
  external_prob_std: number;
  external_prob_max: number;
  external_prob_min: number;
  external_source_count: number;
  has_external_signal: number;
  // Price-derived
  price_prob: number;
  dist_from_50: number;
  dist_from_0: number;
  dist_from_100: number;
  entropy: number;
  log_odds: number;
  // Category one-hot
  cat_sports: number;
  cat_crypto: number;
  cat_economics: number;
  cat_politics: number;
  cat_elections: number;
  cat_weather: number;
  cat_multi_category: number;
  cat_exotics: number;
  cat_unknown: number;
}

/**
 * Compute ML features from a market and its recent trade/candle data.
 * This mirrors the Python extract_features.py logic.
 */
export function computeMLFeatures(
  market: Market,
  trades: Array<{
    yes_price: number;
    count: number;
    taker_side: string;
    created_time: string;
  }>,
  candles: Array<{
    open_price: number;
    high_price: number;
    low_price: number;
    close_price: number;
    volume: number;
    bucket_start: string;
  }>,
  siblingCount: number,
  siblingPrices: number[],
  externalProbs: number[],
  category: string
): MLFeatures {
  const now = new Date();
  const closeTime = market.close_time ? new Date(market.close_time) : now;
  const createdAt = market.created_at ? new Date(market.created_at) : now;

  // --- Trade features ---
  const totalTrades = trades.length;
  const totalVolume = trades.reduce((s, t) => s + t.count, 0);
  const lastTradePrice = trades.length > 0 ? trades[trades.length - 1].yes_price : 50;
  const prices = trades.map((t) => t.yes_price);

  // VWAP
  const vwap =
    totalVolume > 0
      ? trades.reduce((s, t) => s + t.yes_price * t.count, 0) / totalVolume
      : lastTradePrice;

  // Volatility
  const priceChanges = prices.slice(1).map((p, i) => p - prices[i]);
  const volatility =
    priceChanges.length > 1 ? std(priceChanges) : 0;

  // Taker imbalance
  const yesTaker = trades
    .filter((t) => t.taker_side === "yes")
    .reduce((s, t) => s + t.count, 0);
  const noTaker = trades
    .filter((t) => t.taker_side === "no")
    .reduce((s, t) => s + t.count, 0);
  const takerImbalance = (yesTaker - noTaker) / Math.max(yesTaker + noTaker, 1);

  // Trade size stats
  const sizes = trades.map((t) => t.count);
  const avgTradeSize = sizes.length > 0 ? mean(sizes) : 0;
  const maxTradeSize = sizes.length > 0 ? Math.max(...sizes) : 0;
  const tradeSizeStd = sizes.length > 1 ? std(sizes) : 0;

  // Trade frequency (24h)
  const cutoff24h = new Date(now.getTime() - 24 * 3600 * 1000);
  const recent24h = trades.filter((t) => new Date(t.created_time) >= cutoff24h);
  let tradeFreq24h = 0;
  if (recent24h.length > 1) {
    const first = new Date(recent24h[0].created_time).getTime();
    const last = new Date(recent24h[recent24h.length - 1].created_time).getTime();
    const spanHours = (last - first) / 3600000;
    tradeFreq24h = recent24h.length / Math.max(spanHours, 0.1);
  }

  // Momentum
  const momentum1h = priceMomentum(trades, now, 1);
  const momentum6h = priceMomentum(trades, now, 6);
  const momentum24h = priceMomentum(trades, now, 24);
  const acceleration = momentum1h - momentum6h / 6;

  // Volume surge
  const cutoff6h = new Date(now.getTime() - 6 * 3600 * 1000);
  const recent6h = trades.filter((t) => new Date(t.created_time) >= cutoff6h);
  const recentVol = recent6h.reduce((s, t) => s + t.count, 0);
  const ageHours = Math.max(
    (now.getTime() - new Date(trades[0]?.created_time || now).getTime()) / 3600000,
    1
  );
  const expectedVol = totalVolume * (6 / ageHours);
  const volumeSurge = recentVol / Math.max(expectedVol, 1);

  // VPIN
  const vpin = Math.abs(yesTaker - noTaker) / Math.max(totalVolume, 1);

  // Price range
  const priceRange = prices.length > 0 ? Math.max(...prices) - Math.min(...prices) : 0;

  // Last trade trend
  const lastN = prices.slice(-10);
  let lastTradeTrend = 0;
  if (lastN.length > 1) {
    const xs = lastN.map((_, i) => i);
    lastTradeTrend = linearSlope(xs, lastN);
  }

  // --- Candle features ---
  const recentCandles = candles.slice(-24);
  const closes = recentCandles.map((c) => c.close_price);
  const highs = recentCandles.map((c) => c.high_price);
  const lows = recentCandles.map((c) => c.low_price);
  const volumes = recentCandles.map((c) => c.volume);
  const opens = recentCandles.map((c) => c.open_price);

  // RSI-14
  let rsi = 50;
  if (closes.length >= 14) {
    const deltas = closes.slice(1).map((c, i) => c - closes[i]);
    const gains = deltas.slice(-14).filter((d) => d > 0);
    const losses = deltas.slice(-14).filter((d) => d < 0).map((d) => -d);
    const avgGain = gains.length > 0 ? mean(gains) : 0;
    const avgLoss = losses.length > 0 ? mean(losses) : 0.01;
    const rs = avgGain / avgLoss;
    rsi = 100 - 100 / (1 + rs);
  }

  // Bollinger Band position
  let bbPosition = 0;
  if (closes.length >= 20) {
    const sma20 = mean(closes.slice(-20));
    const std20 = std(closes.slice(-20));
    bbPosition = std20 > 0 ? (closes[closes.length - 1] - sma20) / (2 * std20) : 0;
  }

  // ATR
  let atr = 0;
  if (recentCandles.length >= 2) {
    const trs = highs.slice(1).map((h, i) =>
      Math.max(h - lows[i + 1], Math.abs(h - closes[i]), Math.abs(lows[i + 1] - closes[i]))
    );
    atr = mean(trs);
  }

  // Volume trend
  let volTrend = 0;
  if (volumes.length >= 6) {
    const recentAvg = mean(volumes.slice(-3));
    const olderAvg = mean(volumes.slice(-6, -3));
    volTrend = (recentAvg - olderAvg) / Math.max(olderAvg, 1);
  }

  // Candle sentiment
  const bullish = opens.filter((o, i) => closes[i] > o).length;
  const bearish = opens.filter((o, i) => closes[i] < o).length;
  const candleSentiment = (bullish - bearish) / Math.max(recentCandles.length, 1);

  // Price in range
  const fullHigh = highs.length > 0 ? Math.max(...highs) : 100;
  const fullLow = lows.length > 0 ? Math.min(...lows) : 0;
  const priceInRange =
    (closes[closes.length - 1] || 50 - fullLow) / Math.max(fullHigh - fullLow, 1);

  // --- Temporal features ---
  const hoursToClose = Math.max((closeTime.getTime() - now.getTime()) / 3600000, 0);
  const marketAgeHours = Math.max((now.getTime() - createdAt.getTime()) / 3600000, 0);
  const totalLife = Math.max((closeTime.getTime() - createdAt.getTime()) / 3600000, 1);
  const timeFraction = marketAgeHours / totalLife;

  // --- Structure features ---
  const siblingYesSum = siblingPrices.reduce((s, p) => s + p, 0);
  const siblingYesSpread =
    siblingPrices.length > 0
      ? Math.max(...siblingPrices) - Math.min(...siblingPrices)
      : 0;
  const totalSibVol = market.volume || 1;
  const relativeVolume = (market.volume || 0) / totalSibVol;
  const q75 = siblingPrices.length > 0 ? quantile(siblingPrices, 0.75) : 50;
  const q25 = siblingPrices.length > 0 ? quantile(siblingPrices, 0.25) : 50;
  const isFavorite = lastTradePrice >= q75 ? 1 : 0;
  const isLongshot = lastTradePrice <= q25 ? 1 : 0;

  // --- External features ---
  const extProbMean = externalProbs.length > 0 ? mean(externalProbs) : 0.5;
  const extProbStd = externalProbs.length > 1 ? std(externalProbs) : 0;
  const extProbMax = externalProbs.length > 0 ? Math.max(...externalProbs) : 0.5;
  const extProbMin = externalProbs.length > 0 ? Math.min(...externalProbs) : 0.5;

  // --- Price-derived features ---
  const p = lastTradePrice / 100;
  const pClipped = Math.max(0.01, Math.min(0.99, p));
  const entropy = -(pClipped * Math.log2(pClipped) + (1 - pClipped) * Math.log2(1 - pClipped));
  const logOdds = Math.log(pClipped / (1 - pClipped));

  // --- Category ---
  const cats = ["Sports", "Crypto", "Economics", "Politics", "Elections", "Weather", "Multi-Category", "Exotics", "unknown"];
  const catMap: Record<string, number> = {};
  for (const c of cats) catMap[`cat_${c.toLowerCase().replace("-", "_")}`] = c === category ? 1 : 0;

  return {
    total_trades: totalTrades,
    total_volume: totalVolume,
    last_trade_price: lastTradePrice,
    vwap,
    volatility,
    taker_imbalance: takerImbalance,
    avg_trade_size: avgTradeSize,
    max_trade_size: maxTradeSize,
    trade_size_std: tradeSizeStd,
    trade_freq_24h: tradeFreq24h,
    momentum_1h: momentum1h,
    momentum_6h: momentum6h,
    momentum_24h: momentum24h,
    acceleration,
    volume_surge: volumeSurge,
    vpin,
    price_range: priceRange,
    last_trade_trend: lastTradeTrend,
    rsi,
    bb_position: bbPosition,
    atr,
    vol_trend: volTrend,
    candle_sentiment: candleSentiment,
    price_in_range: priceInRange,
    candle_count: candles.length,
    hours_to_close: hoursToClose,
    market_age_hours: marketAgeHours,
    time_fraction: timeFraction,
    close_hour_utc: closeTime.getUTCHours(),
    close_day_of_week: closeTime.getUTCDay(),
    is_weekend_close: closeTime.getUTCDay() >= 5 ? 1 : 0,
    sibling_count: siblingCount,
    sibling_yes_sum: siblingYesSum,
    sibling_yes_spread: siblingYesSpread,
    relative_volume: relativeVolume,
    is_favorite: isFavorite,
    is_longshot: isLongshot,
    external_prob_mean: extProbMean,
    external_prob_std: extProbStd,
    external_prob_max: extProbMax,
    external_prob_min: extProbMin,
    external_source_count: externalProbs.length,
    has_external_signal: externalProbs.length > 0 ? 1 : 0,
    price_prob: p,
    dist_from_50: Math.abs(p - 0.5),
    dist_from_0: p,
    dist_from_100: 1 - p,
    entropy,
    log_odds: logOdds,
    cat_sports: catMap.cat_sports ?? 0,
    cat_crypto: catMap.cat_crypto ?? 0,
    cat_economics: catMap.cat_economics ?? 0,
    cat_politics: catMap.cat_politics ?? 0,
    cat_elections: catMap.cat_elections ?? 0,
    cat_weather: catMap.cat_weather ?? 0,
    cat_multi_category: catMap.cat_multi_category ?? 0,
    cat_exotics: catMap.cat_exotics ?? 0,
    cat_unknown: catMap.cat_unknown ?? 0,
  };
}

/**
 * Score an opportunity using the ML model's probability estimate.
 * Returns adjusted confidence and whether the ML model agrees with the strategy.
 */
export function scoreOpportunity(
  opp: Opportunity,
  mlProbYes: number
): {
  mlConfidence: number;
  mlAgreement: boolean;
  mlEdge: number;
  adjustedConfidence: number;
} {
  // ML model predicts P(YES). Convert to the relevant side.
  const mlProbForSide = opp.side === "yes" ? mlProbYes : 1 - mlProbYes;

  // The market-implied probability for the chosen side
  const marketProb = opp.side === "yes" ? opp.fair_value : 1 - opp.fair_value;

  // ML edge = ML probability - market probability
  const mlEdge = mlProbForSide - marketProb;

  // Does ML agree with the strategy's direction?
  const mlAgreement = mlEdge > 0;

  // Blend strategy confidence with ML confidence
  // Weight: 60% strategy (domain-specific rules), 40% ML (data-driven)
  const adjustedConfidence = 0.6 * opp.confidence + 0.4 * mlProbForSide;

  return {
    mlConfidence: mlProbForSide,
    mlAgreement,
    mlEdge,
    adjustedConfidence,
  };
}

// --- Helper math functions ---
function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function quantile(arr: number[], q: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function linearSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  const sx = xs.reduce((s, v) => s + v, 0);
  const sy = ys.reduce((s, v) => s + v, 0);
  const sxy = xs.reduce((s, v, i) => s + v * ys[i], 0);
  const sxx = xs.reduce((s, v) => s + v * v, 0);
  return (n * sxy - sx * sy) / Math.max(n * sxx - sx * sx, 1);
}

function priceMomentum(
  trades: Array<{ yes_price: number; created_time: string }>,
  now: Date,
  hours: number
): number {
  const cutoff = new Date(now.getTime() - hours * 3600 * 1000);
  const past = trades.filter((t) => new Date(t.created_time) <= cutoff);
  if (past.length === 0 || trades.length === 0) return 0;
  return trades[trades.length - 1].yes_price - past[past.length - 1].yes_price;
}
