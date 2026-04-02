"""
Feature extraction pipeline for Kalshi market prediction.

Loads pre-extracted CSV data (from extract_data.py) and computes rich
features at multiple observation points before settlement.
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# Observation points: hours before market close
OBSERVATION_HOURS = [168, 72, 48, 24, 12, 6, 3, 1]


def load_raw_data():
    """Load pre-extracted CSVs."""
    markets = pd.read_csv(DATA_DIR / "settled_markets.csv", parse_dates=["close_time", "created_at"])
    trades = pd.read_csv(DATA_DIR / "market_trades.csv", parse_dates=["created_time"])
    candles = pd.read_csv(DATA_DIR / "market_candles.csv", parse_dates=["bucket_start"])

    print(f"Loaded: {len(markets)} markets, {len(trades)} trades, {len(candles)} candles")
    return markets, trades, candles


def compute_trade_features(trades: pd.DataFrame, obs_time) -> dict:
    """Compute microstructure features from trade history up to observation time."""
    if trades.empty:
        return _empty_trade_features()

    mask = trades["created_time"] <= obs_time
    visible = trades[mask]

    if visible.empty or len(visible) < 2:
        return _empty_trade_features()

    total_trades = len(visible)
    total_volume = int(visible["count"].sum())
    prices = visible["yes_price"].astype(float)
    last_trade_price = float(visible.iloc[-1]["yes_price"])

    # VWAP
    weights = visible["count"].astype(float)
    vwap = float(np.average(prices, weights=weights)) if total_volume > 0 else last_trade_price

    # Volatility
    price_changes = prices.diff().dropna()
    volatility = float(price_changes.std()) if len(price_changes) > 1 else 0.0

    # Taker side imbalance
    yes_taker = int(visible[visible["taker_side"] == "yes"]["count"].sum())
    no_taker = int(visible[visible["taker_side"] == "no"]["count"].sum())
    total_taker = yes_taker + no_taker
    taker_imbalance = (yes_taker - no_taker) / max(total_taker, 1)

    # Trade size stats
    avg_trade_size = float(visible["count"].mean())
    max_trade_size = float(visible["count"].max())
    trade_size_std = float(visible["count"].std()) if len(visible) > 1 else 0.0

    # Trade frequency (last 24h)
    cutoff_24h = obs_time - timedelta(hours=24)
    last_24h = visible[visible["created_time"] >= cutoff_24h]
    if len(last_24h) > 1:
        span = (last_24h["created_time"].max() - last_24h["created_time"].min()).total_seconds() / 3600
        trade_freq_24h = len(last_24h) / max(span, 0.1)
    else:
        trade_freq_24h = 0.0

    # Momentum
    momentum_1h = _price_momentum(visible, obs_time, 1)
    momentum_6h = _price_momentum(visible, obs_time, 6)
    momentum_24h = _price_momentum(visible, obs_time, 24)
    acceleration = momentum_1h - momentum_6h / 6

    # Volume surge (recent 6h vs expected)
    cutoff_6h = obs_time - timedelta(hours=6)
    recent = visible[visible["created_time"] >= cutoff_6h]
    if not recent.empty and total_volume > 0:
        recent_vol = int(recent["count"].sum())
        age_hours = max((visible["created_time"].max() - visible["created_time"].min()).total_seconds() / 3600, 1)
        expected = total_volume * (6 / age_hours)
        volume_surge = recent_vol / max(expected, 1)
    else:
        volume_surge = 0.0

    # VPIN (order flow toxicity)
    buy_vol = int(visible[visible["taker_side"] == "yes"]["count"].sum())
    sell_vol = int(visible[visible["taker_side"] == "no"]["count"].sum())
    vpin = abs(buy_vol - sell_vol) / max(total_volume, 1)

    # Price range
    price_range = float(prices.max() - prices.min())

    # Last-trade trend
    last_n = visible.tail(min(10, len(visible)))
    if len(last_n) > 1:
        vals = last_n["yes_price"].astype(float).values
        last_trade_trend = float(np.polyfit(range(len(vals)), vals, 1)[0])
    else:
        last_trade_trend = 0.0

    return {
        "total_trades": total_trades,
        "total_volume": total_volume,
        "last_trade_price": last_trade_price,
        "vwap": vwap,
        "volatility": volatility,
        "taker_imbalance": taker_imbalance,
        "avg_trade_size": avg_trade_size,
        "max_trade_size": max_trade_size,
        "trade_size_std": trade_size_std,
        "trade_freq_24h": trade_freq_24h,
        "momentum_1h": momentum_1h,
        "momentum_6h": momentum_6h,
        "momentum_24h": momentum_24h,
        "acceleration": acceleration,
        "volume_surge": volume_surge,
        "vpin": vpin,
        "price_range": price_range,
        "last_trade_trend": last_trade_trend,
    }


def _price_momentum(trades, obs_time, hours):
    cutoff = obs_time - timedelta(hours=hours)
    past = trades[trades["created_time"] <= cutoff]
    current = trades[trades["created_time"] <= obs_time]
    if past.empty or current.empty:
        return 0.0
    return float(current.iloc[-1]["yes_price"]) - float(past.iloc[-1]["yes_price"])


def _empty_trade_features():
    return {
        "total_trades": 0, "total_volume": 0, "last_trade_price": 50.0,
        "vwap": 50.0, "volatility": 0.0, "taker_imbalance": 0.0,
        "avg_trade_size": 0.0, "max_trade_size": 0.0, "trade_size_std": 0.0,
        "trade_freq_24h": 0.0, "momentum_1h": 0.0, "momentum_6h": 0.0,
        "momentum_24h": 0.0, "acceleration": 0.0, "volume_surge": 0.0,
        "vpin": 0.0, "price_range": 0.0, "last_trade_trend": 0.0,
    }


def compute_candle_features(candles: pd.DataFrame, obs_time) -> dict:
    """Compute technical indicator features from OHLCV candles."""
    if candles.empty:
        return _empty_candle_features()

    visible = candles[candles["bucket_start"] <= obs_time]
    if visible.empty:
        return _empty_candle_features()

    recent = visible.tail(24)
    closes = recent["close_price"].astype(float).values
    highs = recent["high_price"].astype(float).values
    lows = recent["low_price"].astype(float).values
    volumes = recent["volume"].astype(float).values

    # RSI-14
    if len(closes) >= 14:
        deltas = np.diff(closes)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        avg_gain = np.mean(gains[-14:])
        avg_loss = np.mean(losses[-14:])
        rs = avg_gain / max(avg_loss, 0.01)
        rsi = 100 - (100 / (1 + rs))
    else:
        rsi = 50.0

    # Bollinger Band position
    if len(closes) >= 20:
        sma20 = np.mean(closes[-20:])
        std20 = np.std(closes[-20:])
        bb_position = (closes[-1] - sma20) / (2 * max(std20, 0.01))
    else:
        bb_position = 0.0

    # ATR
    if len(recent) >= 2:
        tr = np.maximum(highs[1:] - lows[1:],
                       np.maximum(np.abs(highs[1:] - closes[:-1]),
                                  np.abs(lows[1:] - closes[:-1])))
        atr = float(np.mean(tr))
    else:
        atr = 0.0

    # Volume trend
    if len(volumes) >= 6:
        recent_avg = np.mean(volumes[-3:])
        older_avg = np.mean(volumes[-6:-3])
        vol_trend = (recent_avg - older_avg) / max(older_avg, 1)
    else:
        vol_trend = 0.0

    # Candle sentiment
    opens = recent["open_price"].astype(float).values
    bullish = np.sum(closes > opens)
    bearish = np.sum(closes < opens)
    candle_sentiment = (bullish - bearish) / max(len(recent), 1)

    # Price in range
    full_high = float(highs.max())
    full_low = float(lows.min())
    price_in_range = (closes[-1] - full_low) / max(full_high - full_low, 1)

    return {
        "rsi": rsi,
        "bb_position": bb_position,
        "atr": atr,
        "vol_trend": vol_trend,
        "candle_sentiment": candle_sentiment,
        "price_in_range": price_in_range,
        "candle_count": len(visible),
    }


def _empty_candle_features():
    return {
        "rsi": 50.0, "bb_position": 0.0, "atr": 0.0,
        "vol_trend": 0.0, "candle_sentiment": 0.0,
        "price_in_range": 0.5, "candle_count": 0,
    }


def compute_temporal_features(market: dict, obs_time) -> dict:
    """Compute time-based features."""
    close_time = pd.Timestamp(market["close_time"])
    created_at = pd.Timestamp(market["created_at"])
    obs_ts = pd.Timestamp(obs_time)

    if pd.isna(close_time) or pd.isna(created_at):
        return {"hours_to_close": 0, "market_age_hours": 0, "time_fraction": 1.0,
                "close_hour_utc": 0, "close_day_of_week": 0, "is_weekend_close": 0}

    hours_to_close = max((close_time - obs_ts).total_seconds() / 3600, 0)
    market_age_hours = max((obs_ts - created_at).total_seconds() / 3600, 0)
    total_life = max((close_time - created_at).total_seconds() / 3600, 1)
    time_fraction = market_age_hours / total_life

    return {
        "hours_to_close": hours_to_close,
        "market_age_hours": market_age_hours,
        "time_fraction": time_fraction,
        "close_hour_utc": close_time.hour,
        "close_day_of_week": close_time.weekday(),
        "is_weekend_close": 1 if close_time.weekday() >= 5 else 0,
    }


def compute_structure_features(market: dict, all_markets: pd.DataFrame) -> dict:
    """Compute cross-market structural features."""
    event = market["event_ticker"]
    siblings = all_markets[all_markets["event_ticker"] == event]
    n = len(siblings)

    if n <= 1:
        return {"sibling_count": n, "sibling_yes_sum": 0.0, "sibling_yes_spread": 0.0,
                "relative_volume": 1.0, "is_favorite": 0, "is_longshot": 0}

    prices = siblings["last_price"].astype(float)
    volumes = siblings["volume"].astype(float)
    mkt_price = float(market.get("last_price", 50) or 50)
    mkt_vol = float(market.get("volume", 0) or 0)

    return {
        "sibling_count": n,
        "sibling_yes_sum": float(prices.sum()),
        "sibling_yes_spread": float(prices.max() - prices.min()),
        "relative_volume": mkt_vol / max(float(volumes.sum()), 1),
        "is_favorite": 1 if mkt_price >= float(prices.quantile(0.75)) else 0,
        "is_longshot": 1 if mkt_price <= float(prices.quantile(0.25)) else 0,
    }


def compute_price_features(last_trade_price: float) -> dict:
    """Compute derived price features."""
    p = last_trade_price / 100.0
    p_clipped = np.clip(p, 0.01, 0.99)

    entropy = -(p_clipped * np.log2(p_clipped) + (1 - p_clipped) * np.log2(1 - p_clipped))
    log_odds = np.log(p_clipped / (1 - p_clipped))

    return {
        "price_prob": p,
        "dist_from_50": abs(p - 0.5),
        "dist_from_0": p,
        "dist_from_100": 1.0 - p,
        "entropy": entropy,
        "log_odds": log_odds,
    }


CATEGORIES = ["Sports", "Crypto", "Economics", "Politics", "Elections",
              "Weather", "Multi-Category", "Exotics", "unknown"]

def encode_category(category) -> dict:
    cat = str(category) if pd.notna(category) and str(category) in CATEGORIES else "unknown"
    return {f"cat_{c.lower().replace('-', '_')}": (1 if c == cat else 0) for c in CATEGORIES}


def extract_all_features(markets: pd.DataFrame, trades: pd.DataFrame,
                          candles: pd.DataFrame) -> pd.DataFrame:
    """Extract feature vectors for all markets at multiple observation points."""
    all_rows = []

    for i, mkt in markets.iterrows():
        ticker = mkt["ticker"]
        close_time = pd.Timestamp(mkt["close_time"])
        created_at = pd.Timestamp(mkt["created_at"])
        label = 1 if mkt["result"] == "yes" else 0

        # Get this market's trades and candles
        mkt_trades = trades[trades["ticker"] == ticker].copy()
        mkt_candles = candles[candles["ticker"] == ticker].copy()

        if len(mkt_trades) < 2:
            continue

        if (i + 1) % 25 == 0 or i == 0:
            print(f"  [{i+1}/{len(markets)}] Processing {ticker}...")

        for hours_before in OBSERVATION_HOURS:
            obs_time = close_time - timedelta(hours=hours_before)

            if pd.notna(created_at) and obs_time < created_at:
                continue

            trade_feats = compute_trade_features(mkt_trades, obs_time)
            if trade_feats["total_trades"] < 2:
                continue

            candle_feats = compute_candle_features(mkt_candles, obs_time)
            temporal_feats = compute_temporal_features(mkt.to_dict(), obs_time)
            structure_feats = compute_structure_features(mkt.to_dict(), markets)
            price_feats = compute_price_features(trade_feats["last_trade_price"])
            cat_feats = encode_category(mkt.get("category"))

            row = {
                "ticker": ticker,
                "event_ticker": mkt["event_ticker"],
                "obs_hours_before_close": hours_before,
                "label": label,
                **trade_feats,
                **candle_feats,
                **temporal_feats,
                **structure_feats,
                **price_feats,
                **cat_feats,
            }
            all_rows.append(row)

    df = pd.DataFrame(all_rows)
    return df


def main():
    print("=" * 60)
    print("FEATURE EXTRACTION PIPELINE")
    print("=" * 60)

    markets, trades, candles = load_raw_data()

    print(f"\nExtracting features at {len(OBSERVATION_HOURS)} observation points per market...")
    df = extract_all_features(markets, trades, candles)

    print(f"\nTotal feature vectors: {len(df)}")
    print(f"Unique markets: {df['ticker'].nunique()}")
    print(f"Label distribution: YES={df['label'].sum()}, NO={len(df) - df['label'].sum()}")
    feat_cols = [c for c in df.columns if c not in ("ticker", "event_ticker", "obs_hours_before_close", "label")]
    print(f"Features: {len(feat_cols)}")

    # Save
    output_path = DATA_DIR / "features.parquet"
    try:
        df.to_parquet(output_path, index=False)
    except ImportError:
        output_path = DATA_DIR / "features.csv"
        df.to_csv(output_path, index=False)
    print(f"\nSaved to {output_path}")

    # Also save CSV for inspection
    df.to_csv(DATA_DIR / "features.csv", index=False)

    summary = {
        "total_samples": len(df),
        "total_markets": int(df["ticker"].nunique()),
        "label_dist": {"yes": int(df["label"].sum()), "no": int(len(df) - df["label"].sum())},
        "features": feat_cols,
        "observation_points": sorted(df["obs_hours_before_close"].unique().tolist()),
        "extracted_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(DATA_DIR / "extraction_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    return df


if __name__ == "__main__":
    df = main()
