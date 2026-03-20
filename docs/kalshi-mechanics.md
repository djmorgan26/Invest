# Kalshi Market Mechanics Reference

Comprehensive reference for building automated trading strategies on Kalshi.
Last updated: 2026-03-20.

---

## 1. Order Book Structure: Central Limit Order Book (CLOB)

Kalshi operates a **central limit order book (CLOB)** with price-time priority matching. Despite Kalshi's own marketing describing it as a "quote-driven market," the mechanics are functionally a CLOB:

- **Resting orders** sit on the book at specified prices until matched, canceled, or expired.
- **Matching** follows price-time priority: best price first, then earliest order at that price.
- **Single contract model**: There is only ONE contract per market. You go "long" (buy Yes) or "short" (buy No). P_YES + P_NO = $1.00 always. A Yes bid at price X is equivalent to a No ask at price ($1.00 - X).
- The order book endpoint returns **yes bids and no bids only** (no asks). You derive asks from the other side: best YES ask = $1.00 - (highest NO bid).

### API Endpoint
```
GET /markets/{ticker}/orderbook?depth=N
```
- `depth`: 0 or negative = all levels, 1-100 for specific depth (default: 10 via web, 0 via API).
- Response: `orderbook_fp.yes_dollars[]` and `orderbook_fp.no_dollars[]`, each an array of `[price_dollars_string, count_fp_string]` pairs sorted ascending by price.

### Contract Minting
Shares are atomically minted when opposing orders match. If Trader A bids YES @ $0.65 and Trader B bids NO @ $0.35, the exchange collects $1.00 total, mints 1 YES + 1 NO contract, and distributes to each party.

---

## 2. Price Impact & Depth-of-Book

**Yes, there is a full depth-of-book concept.** Price impact is determined entirely by the resting order depth at each price level.

### How Price Impact Works
- Each price level shows quantity available. If you want to buy 1,000 contracts but only 100 are at $0.42, you walk up the book.
- Example from the academic data (CPI market): Best Yes ask at 32c had 105 contracts ($33.60), next level at 33c had 10,008 contracts, then 35c had 10,000.
- **Typical liquidity is thin.** Median total volume per contract is ~$8,982. Mean transaction size is $100, median is $35.

### Calculating Spread
```
Spread = implied_yes_ask - best_yes_bid
       = (1.00 - highest_no_bid) - highest_yes_bid
```
Example: YES best bid $0.42, NO best bid $0.56 => YES implied ask = $0.44, spread = $0.02.

### Key Insight for Strategy
Most markets have **low liquidity**. Two-thirds of contract prices are at extremes (<10c or >90c). The most liquid markets are high-profile events (elections, S&P 500, crypto). Wide spreads are common in smaller markets -- this is what our wide-spread strategy exploits.

---

## 3. Contract Mechanics

### Structure
- **Binary contracts**: Settle at $1.00 (Yes wins) or $0.00 (Yes loses).
- **Scalar contracts**: Also exist (market_type: "scalar") but are less common.
- **Notional value**: Typically $1.00 per contract (field: `notional_value_dollars`).
- **Price range**: 1c to 99c (integer cents via legacy API; or $0.0100 to $0.9900 via dollar strings with up to 6 decimal precision).

### Price Format
- **Legacy**: Integer cents 1-99 (`yes_price`, `no_price` fields).
- **Modern**: Fixed-point dollar strings with up to 6 decimal places (`yes_price_dollars`, `no_price_dollars`). Example: `"0.5600"`.
- **Tick size**: Defined per-market via `price_ranges` array. Each range specifies `{start, end, step}` in dollars. Standard binary markets use $0.01 steps (1 cent ticks). The `tick_size` field is deprecated.
- Subpenny pricing is supported by the format but constrained by each market's `price_level_structure`.

### Fractional Trading
- `fractional_trading_enabled` field exists per market.
- Contract counts use fixed-point strings with 2 decimals (e.g., "10.00"), but currently only whole contracts are permitted.

---

## 4. Order Types

### Available via API (`time_in_force`)

| Order Type | API Value | Behavior |
|---|---|---|
| **Good Till Canceled** | `good_till_canceled` | Rests on book until filled, canceled, or market closes. Default. |
| **Immediate or Cancel** | `immediate_or_cancel` | Fills what it can immediately, cancels the rest. No resting. |
| **Fill or Kill** | `fill_or_kill` | Fills entirely or not at all. No partial fills. |

### Determined by System (`type` field on orders)

| Type | When |
|---|---|
| **limit** | Price is specified (resting possible) |
| **market** | No price specified (takes best available) |

### Advanced Parameters

| Parameter | Purpose |
|---|---|
| `post_only` | Boolean. Prevents immediate execution -- order MUST rest on book. Rejected if it would cross the spread. Key for maker strategies. |
| `reduce_only` | Boolean. Can only reduce existing position, never increase. |
| `buy_max_cost` | Integer cents. Maximum total cost. Triggers FOK behavior automatically. |
| `expiration_ts` | Unix timestamp (ms). Order expires at this time if unfilled. |
| `cancel_order_on_pause` | Boolean. Auto-cancel if exchange pauses trading. |
| `self_trade_prevention_type` | `taker_at_cross` or `maker`. Prevents self-matching. |
| `client_order_id` | Your custom ID for tracking. |
| `order_group_id` | Associate with a rate-limited order group. |
| `subaccount` | Integer 0-32 (0 = primary). Supports up to 32 subaccounts. |

### Batch Orders
- `POST /portfolio/orders/batched`: Up to 20 orders per batch.
- Each order counts against per-second rate limit.

### Order Lifecycle States
`resting` -> `executed` or `canceled`

---

## 5. Minimum / Maximum Order Sizes

| Constraint | Value |
|---|---|
| **Minimum order quantity** | 1 contract (`count` minimum: 1) |
| **Maximum open orders** | 200,000 per user |
| **Batch order limit** | 20 orders per batch request |
| **Price range** | 1-99 cents (integer) or $0.01-$0.99 (dollar strings) |
| **Rate limit** | Per-second rate limit on order operations; rolling 15-second window per order group |

There is no documented maximum order quantity per order. Position limits (see section 9) constrain total exposure, not individual order size.

---

## 6. Bid-Ask Spreads

### How They Work
- Spreads emerge naturally from the CLOB. No algorithmic spread-setting.
- The spread is the gap between the best Yes bid and the implied Yes ask (= $1.00 - best No bid).
- Spreads vary enormously by market. High-profile markets (elections, S&P) may have 1-2c spreads. Low-volume markets can have 10-20c+ spreads.

### Academic Evidence (Whelan et al., Jan 2026)
- Analyzed 46,282 contracts from 2021-April 2025.
- Markets with final bid-ask spread > 20c were excluded as too illiquid.
- Two-thirds of all traded prices are at extremes (<10c or >90c), where spreads tend to be wider in absolute terms but tighter relative to price.
- Mean transaction size: $100. Median: $35. These are small retail-sized trades.

### Implication for Strategies
Wide-spread markets are the primary opportunity for market-making strategies. Posting resting orders (maker) on both sides of illiquid markets captures the spread while paying lower fees.

---

## 7. Fee Structure

### Fee Types

Kalshi uses three fee types per series, visible on the `Series` object:

| Fee Type | Description |
|---|---|
| `quadratic` | Standard taker-only quadratic fee (pre-April 2025) |
| `quadratic_with_maker_fees` | Quadratic fees for both makers and takers (current default) |
| `flat` | Flat per-contract fee for specific market series |

### Taker Fee Formula (Quadratic)
```
taker_fee = ceil(0.07 * C * P * (1 - P))
```
Where:
- `C` = number of contracts
- `P` = contract price in dollars (0.01 to 0.99)
- Result rounded UP to nearest cent

**Per-contract taker fee**: `0.07 * P * (1 - P)`
- **Maximum**: 1.75c per contract (at P = $0.50)
- **At P = $0.10**: 0.63c per contract
- **At P = $0.05**: 0.33c per contract
- **At P = $0.95**: 0.33c per contract
- **At P = $0.02**: 0.14c per contract

### Maker Fee Formula (Quadratic, since ~April 2025)
```
maker_fee = ceil(0.0175 * C * P * (1 - P))
```
- **Maximum**: 0.4375c per contract (at P = $0.50)
- Maker fees are exactly 25% of taker fees.
- **Before April 2025**: Makers paid ZERO fees. This was a significant advantage for market-making strategies.

### Fee Multiplier
Each series has a `fee_multiplier` (float) that scales the base fee calculation:
- **Standard markets**: multiplier = 1.0 (use formulas above as-is)
- **S&P 500 / Nasdaq-100**: multiplier = 0.5 (fees halved: 0.035 coefficient for takers)
- Multiplier can change over time via `SeriesFeeChange` records (API: `GET /series/fee_changes`)

### Settlement Fees
**No separate settlement fee.** You are not charged when contracts settle. Your profit/loss is simply settlement value minus purchase price minus trading fees.

### Fee-Free Scenarios
- Canceled resting orders incur no fees.
- Market makers in the designated program may trade with zero fees.

### Interest on Deposits
Kalshi pays ~4% interest on cash balances, which partially offsets fee drag on longer-duration positions.

---

## 8. Market Makers & Liquidity

### Designated Market Maker Program
- **Highly selective** -- requires financial resources, experience, and reputation review.
- Benefits: **zero trading fees**, adjusted position limits, enhanced platform access, financial incentives.
- Market makers provide two-sided quotes to ensure liquidity.
- Filed with CFTC (documented in rulebook filings).

### Liquidity Incentive Program
- Separate from the MM program, open to broader participation.
- Pays participants for maintaining resting orders that improve market liquidity.
- You get paid even if your orders don't get filled, just for having them on the book.

### Practical Liquidity Reality
- Most markets are **thinly traded**. Median total volume per contract: ~$9,000.
- Volume is highly skewed: top decile markets exceed $1M in volume; most markets are much smaller.
- Volume surged after January 2025 when sports markets launched.
- The 10,000-contract blocks visible at certain price levels (from the academic paper's CPI example) suggest market maker activity.

### Adverse Selection Risk
Key insight from practitioners: "Whenever we post a limit order, we are exposed to adverse selection." Getting filled at attractive prices often means the true fair value has moved against you.

---

## 9. Position Limits

### Current Framework: Position Accountability (since late 2024)

| Trader Type | Limit |
|---|---|
| **Standard retail** | $25,000 maximum loss per contract series |
| **Eligible Contract Participants (ECP)** | $50,000,000 per member |
| **ECP with hedging need** | $100,000,000 per member |

Kalshi shifted from hard position limits to **position accountability levels** in November 2024. This means:
- Positions below the threshold are unrestricted.
- Positions above the threshold trigger enhanced monitoring and may require justification.
- The exchange can order position reduction if accountability levels are breached.

### Per-API Limits
- 200,000 maximum open orders.
- Up to 32 subaccounts with netting options and inter-account transfers.

---

## 10. Settlement Mechanics

### Lifecycle
```
initialized -> inactive -> active -> closed -> determined -> finalized
                                              -> disputed -> amended -> finalized
```

### Key Fields
- `close_time`: When trading stops (no more orders accepted).
- `expiration_time` / `latest_expiration_time`: When the outcome should be known.
- `settlement_timer_seconds`: Delay between determination and actual settlement (fund distribution).
- `settlement_value_dollars`: The YES/LONG side settlement value (only filled after determination).
- `settlement_ts`: Timestamp of actual settlement.
- `result`: `"yes"`, `"no"`, `"scalar"`, or `""` (undetermined).

### Source Agencies
Each market specifies source agencies (filed with CFTC) that determine outcomes:
- **Sports**: NFL, NBA, Associated Press, ESPN
- **Crypto**: CF Benchmarks Real-Time Indices (1-min window, trimmed averaging)
- **Economics**: BLS, BEA, Federal Reserve
- **Weather**: NOAA, National Weather Service

### Timing
- Most markets settle **within a few hours** after the outcome is known (typically ~3 hours).
- Can be longer if waiting for official data (government releases, etc.).
- Some markets can close early (`can_close_early` field).

### Dispute Handling
- Kalshi's internal Markets Team makes final determinations.
- An Outcome Review Committee handles ambiguous cases.
- **No formal trader dispute mechanism** -- decisions are final.
- If unresolvable, Kalshi may invoke Rule 6.3(c): settle at last traded price instead of $1/$0.

### Payout
- **Yes wins**: Each Yes contract pays $1.00. Each No contract pays $0.00.
- **No wins**: Each Yes contract pays $0.00. Each No contract pays $1.00.
- Funds are credited to your account balance automatically upon settlement.

---

## 11. Key Academic Findings (Whelan et al., Jan 2026)

**Critical intelligence for strategy design:**

1. **Favorite-longshot bias**: Low-price contracts (<10c) win far less often than needed to break even. Investors buying contracts <10c lose ~60% of their money. Contracts >50c earn small positive returns on average.

2. **Makers earn higher returns than Takers**: All trades involve a maker and a taker. Makers (who post resting orders) earn higher returns than takers (who accept offers). This is because takers pay higher fees and accept adverse selection.

3. **Average return is -20%**: The overall average rate of return on Kalshi contracts is approximately minus 20%, driven heavily by the longshot bias and fees.

4. **Prices are informative**: Despite biases, prices do converge toward accuracy as markets approach closing.

5. **Takers have more extreme beliefs**: Takers self-select by having stronger convictions and being willing to pay taker fees for immediate execution.

### Strategy Implications
- **Avoid buying longshots** (<10c) unless you have strong private information.
- **Be a maker, not a taker** whenever possible -- the fee advantage (1.75c vs 0.44c max at 50c) plus maker returns are significantly better.
- **Focus on contracts >50c** where average returns are slightly positive.
- **Post-only orders** (`post_only: true`) guarantee maker fee treatment.

---

## 12. API Rate Limits & Operational Notes

- **Order operations**: Per-second rate limit (exact number not public, ~20/sec based on batch limit).
- **Order groups**: Rate-limiting mechanism with rolling 15-second contract count windows.
- **WebSocket**: Available for real-time orderbook updates (avoids polling).
- **Data latency**: There is typically a short delay before exchange events are reflected in API endpoints. Combine REST responses with WebSocket data for most accurate state.
- **Exchange pauses**: Trading can be paused exchange-wide. Use `cancel_order_on_pause: true` to protect against being caught with resting orders during a pause.
- **Production API**: `https://api.elections.kalshi.com/trade-api/v2` (note: domain changed from `trading-api.kalshi.com`).
- **Demo API**: `https://demo-api.kalshi.co/trade-api/v2`.

---

## Summary Table: What Matters for Automated Strategies

| Dimension | Key Fact |
|---|---|
| **Order book** | CLOB with price-time priority |
| **Tick size** | $0.01 standard (per-market via `price_ranges`) |
| **Min order** | 1 contract |
| **Max open orders** | 200,000 |
| **Taker fee** | ceil(0.07 * C * P * (1-P)), max 1.75c/contract |
| **Maker fee** | ceil(0.0175 * C * P * (1-P)), max ~0.44c/contract |
| **Settlement fee** | None |
| **Position limit** | $25K max loss (retail), $50M (ECP) |
| **Settlement** | $1 or $0, typically within hours |
| **Liquidity** | Thin in most markets, concentrated in high-profile events |
| **Best edge** | Be a maker, avoid longshots, exploit wide spreads |
| **Interest** | ~4% on cash balances |
