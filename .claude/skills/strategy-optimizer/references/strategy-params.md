# Strategy Parameter Reference

## Wide Spread (`wide-spread`)
Captures the bid-ask spread by buying at the midpoint.

| Parameter | Default | Range | What It Controls |
|-----------|---------|-------|-----------------|
| `min_spread` | 0.10 | 0.05-0.25 | Minimum bid-ask spread to consider (10¢ = 10% spread) |
| `min_volume` | 100 | 50-500 | Minimum total volume |
| `max_days_to_close` | 14 | 3-30 | Maximum days until market closes |
| `max_entry_price` | 0.75 | 0.60-0.85 | Max price to pay (75¢ = 25¢ max profit) |
| `min_entry_price` | 0.15 | 0.10-0.25 | Min price to pay (avoid longshots) |
| `min_risk_reward` | 0.35 | 0.15-0.50 | Min reward/risk ratio |

**Edge logic:** Fair value = midpoint. Edge = midpoint - entry price. Buys YES if midpoint < 50¢, NO if > 50¢.
**Known issue:** Previously entered at 95¢+ with terrible risk/reward. Fixed by lowering max_entry_price to 75¢.

---

## Mean Reversion (`mean-reversion`)
Bets against sharp price moves, expecting partial reversion.

| Parameter | Default | Range | What It Controls |
|-----------|---------|-------|-----------------|
| `min_move` | 0.12 | 0.08-0.20 | Minimum 24h price move to trigger (12¢) |
| `lookback_hours` | 24 | 12-48 | How far back to look for the move |
| `reversion_factor` | 0.5 | 0.3-0.7 | How much of the move we expect to revert (50%) |
| `min_days_to_close` | 1 | 0.5-3 | Need time for reversion to happen |
| `max_days_to_close` | 14 | 7-30 | Don't bet on very distant markets |

**Edge logic:** If price moved +15¢ in 24h, predict 7.5¢ reversion (50%). Fair value = current - 7.5¢. Buy the opposite direction.
**Time-to-expiry scaling:** Reversion factor reduced for markets <3 days from close (near-expiry moves are more likely informed).

---

## Extreme Value (`extreme-value`)
Buys near-certain outcomes priced below 8¢ or above 92¢ near expiry.

| Parameter | Default | Range | What It Controls |
|-----------|---------|-------|-----------------|
| `low_threshold` | 0.08 | 0.05-0.12 | Below this price → bet NO (near-certain NO) |
| `high_threshold` | 0.92 | 0.88-0.95 | Above this price → bet YES (near-certain YES) |
| `min_volume` | 50 | 30-200 | Minimum volume |
| `max_days_to_close` | 7 | 1-10 | Only near-expiry markets |

**Edge logic:** Time-decay model. Market at 5¢ with 6h to close is very likely NO. Fair value scales 95-99% with proximity to close.
**Risk:** Small profit per contract (~3-8¢) but high win rate expected.

---

## Stale Price (`stale-price`)
Detects markets that haven't repriced after sibling settlement.

| Parameter | Default | Range | What It Controls |
|-----------|---------|-------|-----------------|
| `max_hours_since_settlement` | 48 | 12-72 | How recently a sibling must have settled |

**Edge logic:** If a sibling market in the same event settled YES, related open markets should reprice. If they haven't moved, there's edge.
**Dependency:** Needs events with multiple markets where some have settled.

---

## Volume Spike (`volume-spike`)
Momentum continuation on unusual volume with price moves.

| Parameter | Default | Range | What It Controls |
|-----------|---------|-------|-----------------|
| `volume_multiplier` | 3.0 | 2.0-5.0 | How many times baseline volume (3x = spike) |
| `min_price_move` | 0.03 | 0.02-0.08 | Min price move accompanying the spike |
| `momentum_factor` | 0.3 | 0.2-0.5 | How much further we expect price to move |
| `lookback_hours` | 48 | 24-72 | Baseline volume calculation window |

**Edge logic:** 3x volume + 3¢+ price move = informed flow. Follow the direction with 30% momentum.

---

## Event Cluster Arbitrage (`event-cluster`)
Exploits mutually exclusive markets where YES prices don't sum to 100¢.

| Parameter | Default | Range | What It Controls |
|-----------|---------|-------|-----------------|
| `min_mispricing` | 0.05 | 0.03-0.10 | Min total deviation from 100¢ |
| `max_markets_per_event` | 15 | 5-20 | Max siblings to consider |

**Edge logic:** In a mutually exclusive event (exactly one outcome wins), YES prices must sum to 100¢. If sum > 100¢, some are overpriced → sell. If < 100¢, some are underpriced → buy.
**Known limitation:** Hard to short on Kalshi. Works better when sum < 100¢.

---

## Favorite-Longshot Bias (`favorite-longshot`)
Academic bias: longshots are overpriced, favorites underpriced.

| Parameter | Default | Range | What It Controls |
|-----------|---------|-------|-----------------|
| `longshot_overpricing` | 0.30 | 0.20-0.40 | How much longshots are overpriced (30%) |
| `favorite_underpricing` | 0.03 | 0.02-0.05 | How much favorites are underpriced (3%) |
| `min_volume` | 100 | 50-300 | Minimum volume |

**Edge logic:** Longshot at 10¢ YES → true prob ~7¢ → buy NO. Favorite at 90¢ YES → true prob ~93¢ → buy YES.
**Based on:** Snowberg & Wolfers (2010) research on prediction market biases.

---

## Expiry Convergence (`expiry-convergence`)
Snipe markets <48h from close in uncertain zone with momentum.

| Parameter | Default | Range | What It Controls |
|-----------|---------|-------|-----------------|
| `max_hours_to_close` | 48 | 12-72 | Max hours until close |
| `min_momentum` | 0.05 | 0.03-0.10 | Min 12h price momentum |

**Edge logic:** Markets near close priced 25-75¢ with momentum signal → follow momentum with time-pressure multiplier.

---

## New Listing Edge (`new-listing`)
Trade newly listed markets (<24h) with naive initial pricing.

| Parameter | Default | Range | What It Controls |
|-----------|---------|-------|-----------------|
| `max_hours_since_listing` | 24 | 6-48 | How new the market must be |
| `min_spread` | 0.08 | 0.05-0.15 | Minimum spread (wide = naive pricing) |

**Edge logic:** New markets have uninformed initial pricing. Wide spread + off-50¢ midpoint = opportunity.

---

## Liquidity Provision (`liquidity-provision`)
Capture spread in stable, wide-spread markets.

| Parameter | Default | Range | What It Controls |
|-----------|---------|-------|-----------------|
| `min_spread` | 0.08 | 0.05-0.15 | Minimum spread |
| `max_price_volatility` | 0.05 | 0.03-0.10 | Max 24h price range (stable markets only) |
| `min_depth_ratio` | 0.3 | 0.2-0.5 | Min orderbook depth ratio |

**Edge logic:** Passive market making — buy the side with better orderbook depth. Lean toward deeper side to reduce adverse selection.
**Known limitation:** Paper trading simulates as directional bet, not real two-sided market making.
