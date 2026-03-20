# Roadmap: Paper Trading → Real Money

> From "system runs autonomously" to "I trust this with my capital."
> Each phase has clear exit criteria. You don't advance until they're met.

---

## Where We Are Today (2026-03-20)

**Phases 1–3 complete.** The system syncs 64K+ markets, runs 4 strategies every 15 min, tracks portfolio value, and has Kalshi-aware fee/sizing logic. We have 5 open paper trades (all Wide Spread), zero resolved. The engine is running but unproven.

**What's missing before real money:**
1. Not enough trade data to evaluate anything (need 200+ resolved)
2. No maker order support (we're paying full taker fees)
3. No real-time order book data (decisions based on stale bid/ask from sync)
4. No circuit breakers or kill switch
5. No live Kalshi order execution
6. No real P&L tracking or tax reporting

---

## Phase 4: Data Collection & Strategy Validation
**Goal:** Get to 200+ resolved trades with statistically meaningful results.
**Timeline:** 2–4 weeks (depends on market expiry cadence)

### 4A. Expand data coverage
- [ ] **Auto-watchlist all traded markets** — Every market a strategy evaluates gets added to watchlist for price snapshots. This unblocks Mean Reversion (currently only 5 tickers tracked).
- [ ] **Snapshot high-volume markets** — Extend the price snapshot cron to cover top 200 markets by volume, not just the watchlist. Cost: more DB rows but Supabase free tier handles it.
- [ ] **Store order book depth** — New table `orderbook_snapshots` capturing top 5 levels of depth for watchlisted markets. Critical for understanding real fill prices vs. displayed bid/ask.
- [ ] **Track 24h volume and liquidity** — We have `volume_24h_fp` and `liquidity_dollars` from Kalshi but don't store them. Add columns to `markets` table.

### 4B. Increase trade frequency
- [ ] **Scan every 5 minutes** (up from 15 min) — More frequent scanning catches short-lived opportunities, especially for Extreme Value near expiry.
- [ ] **Add more strategy capacity** — Raise `MAX_OPEN_PER_STRATEGY` from 5 to 8 for strategies showing promise. Still conservative.
- [ ] **Reduce min_volume filter on Extreme Value** — From 50 to 20 for near-expiry markets. When something is 3¢ with 2 hours left, low volume doesn't invalidate the thesis.

### 4C. New strategies (expand opportunity surface)
- [ ] **Event cluster arbitrage** — In mutually exclusive events, YES probabilities should sum to ~100%. When they don't (e.g., sums to 110% or 88%), sell the overpriced side or buy the underpriced side.
- [ ] **Volume spike detector** — When a market sees 10x its normal daily volume, something happened. Scan for these and flag for investigation or automated entry if price hasn't fully adjusted.

### 4D. Track what matters
- [ ] **Per-trade fee tracking** — Store taker fee paid on each paper trade. Critical for knowing true P&L.
- [ ] **Slippage tracking** — Compare the price we "paper traded" at vs. what we'd have actually gotten (using orderbook depth data). Slippage on thin markets is a real cost.
- [ ] **Automated daily P&L email/dashboard** — Don't wait for manual reviews. Dashboard should show today's resolved trades, running P&L, and any strategy health warnings.

**Exit criteria for Phase 4:**
- 100+ resolved trades across at least 2 strategies
- Price snapshot coverage for all markets strategies evaluate
- Order book depth data collecting for 2+ weeks
- System running stable with no manual intervention needed

---

## Phase 5: Statistical Validation & Strategy Tuning
**Goal:** Prove the strategies have real edge, not luck.
**Timeline:** 2–4 weeks after Phase 4

### 5A. Statistical rigor
- [ ] **Confidence intervals on win rate** — With 50 trades, a 60% win rate could easily be luck (95% CI: 45–74%). With 200 trades at 60%, CI narrows to 53–67%. We need enough trades to be confident.
- [ ] **Strategy-level Sharpe ratio** — Calculate per-strategy, not just portfolio-wide. A strategy with Sharpe < 0.5 isn't worth running.
- [ ] **Profit factor** — Gross profits / gross losses. Must be > 1.2 to justify fees and risk.
- [ ] **Win rate vs. edge analysis** — Are we winning the trades we have the most edge on? If high-edge trades lose and low-edge trades win, the edge calculation is broken.
- [ ] **Drawdown analysis** — Max consecutive losing streak. Max drawdown from peak. These determine position sizing for real money.

### 5B. Backtesting framework
- [ ] **Historical simulation** — Replay all price snapshots through the strategy engine. Did the strategy ALSO find these opportunities in historical data? If it only works in the last week, it's overfitting.
- [ ] **Walk-forward validation** — Train parameters on weeks 1-2, test on week 3. Retrain on weeks 1-3, test on week 4. Prevents lookahead bias.
- [ ] **Fee sensitivity analysis** — How does P&L change if fees increase 50%? If the strategy breaks, the edge was too thin.

### 5C. Maker order strategy (the big unlock)
- [ ] **Maker order paper trading** — Instead of "buying at the ask" (taker), simulate posting limit orders inside the spread. Calculate theoretical fills based on order book data we've been collecting.
- [ ] **Maker vs. taker comparison** — Run both in parallel on paper. The fee difference (1.75¢ vs 0.44¢ max per contract) is 4x. If a strategy barely works as taker, it might be very profitable as maker.
- [ ] **Fill rate estimation** — Makers don't always get filled. Estimate fill probability from historical order book data. A maker order that fills 30% of the time still needs to account for the capital tied up in the 70% that doesn't.

**Exit criteria for Phase 5:**
- 200+ resolved trades total
- Win rate > 55% with 95% confidence interval lower bound > 50%
- Total P&L positive
- Sharpe ratio > 1.0 (annualized)
- Max drawdown < 15% of portfolio
- At least 1 strategy passing all thresholds independently
- Backtesting confirms results aren't just recent luck

---

## Phase 6: Pre-Live Hardening
**Goal:** Build everything needed to run with real money safely.
**Timeline:** 1–2 weeks

### 6A. Live order execution
- [ ] **Kalshi production API integration** — Switch from demo to production API. The client already supports both (`KALSHI_API_BASE_URL`). Need production API keys.
- [ ] **Order placement module** — New `src/lib/kalshi/orders.ts` with:
  - `placeLimitOrder(ticker, side, price, quantity, postOnly)` — Creates a resting order
  - `placeMarketOrder(ticker, side, quantity)` — Takes best available
  - `cancelOrder(orderId)` — Cancel a resting order
  - `getOpenOrders()` — Current resting orders
  - `getPositions()` — Current holdings
- [ ] **Paper trade → live trade migration** — System runs both paper and live in parallel initially. Same signals, but live executes smaller sizes.

### 6B. Risk management (non-negotiable before real money)
- [ ] **Daily loss limit** — If total daily realized + unrealized loss exceeds $X (start at $50), halt all new trades for 24h. This is the kill switch.
- [ ] **Per-trade loss limit** — No single trade can risk more than $25 initially. Already roughly enforced by position sizing, but needs a hard stop.
- [ ] **Correlation limit** — Don't have 5 trades all on Bitcoin markets. If BTC moves against you, you lose on all 5. Max 3 trades per event category.
- [ ] **Drawdown circuit breaker** — If portfolio drops 10% from peak, disable all strategies until manual review.
- [ ] **Manual kill switch** — Dashboard button and CLI command that immediately cancels all resting orders and disables all strategies. Must work in < 5 seconds.
- [ ] **Position reconciliation** — Every hour, compare DB state to actual Kalshi positions. If they diverge (missed fill, manual trade), alert immediately.

### 6C. Alerting
- [ ] **Trade execution alerts** — Push notification or email when a real trade executes.
- [ ] **Error alerts** — If any cron job fails, strategy scan errors, or API returns unexpected responses.
- [ ] **Threshold alerts** — Daily loss limit approaching, drawdown approaching circuit breaker, strategy decay approaching auto-disable.

### 6D. Operational readiness
- [ ] **Runbook document** — What to do when: strategy disabled by decay, circuit breaker triggers, API errors, settlement disputes, etc.
- [ ] **Disaster recovery** — What if Vercel goes down? What if Supabase goes down? Resting orders on Kalshi survive both, but you need to know your exposure.
- [ ] **Tax tracking** — Every realized trade needs: entry date, entry price, exit date, exit price, fees, P&L. Kalshi sends 1099s but you want your own records.

**Exit criteria for Phase 6:**
- Production API keys working
- Order placement tested (manually place and cancel 1 real order for 1 contract)
- All circuit breakers implemented and tested
- Kill switch tested
- Alerting working (test with a fake error)
- Runbook written

---

## Phase 7: Graduated Live Trading
**Goal:** Start real money with minimal risk, scale up as confidence builds.
**Timeline:** Ongoing

### 7A. Week 1–2: Micro scale ($100 bankroll)
- [ ] **$100 initial deposit** on Kalshi
- [ ] **1–3 contracts per trade** maximum
- [ ] **Max $10 at risk per trade**
- [ ] **Run 1 strategy only** — whichever has the best paper track record
- [ ] **Daily manual review** — Check every trade, every fill, every P&L calculation
- [ ] **Compare to paper** — Are real fills matching paper assumptions? Is slippage worse than expected?

**Advance when:** 20+ real trades resolved, results within 2σ of paper trading performance, no operational issues

### 7B. Week 3–4: Conservative scale ($250 bankroll)
- [ ] **Add second strategy** if the first is performing
- [ ] **3–5 contracts per trade**
- [ ] **Max $25 at risk per trade**
- [ ] **Enable maker orders** for Wide Spread (post_only limit orders instead of taking the ask)
- [ ] **Review weekly** instead of daily

**Advance when:** 50+ total real trades, positive P&L, Sharpe > 0.5, no circuit breaker triggers

### 7C. Month 2+: Scaling ($500–$1000 bankroll)
- [ ] **All proven strategies enabled**
- [ ] **5–15 contracts per trade** (still capped by liquidity rules)
- [ ] **Max $50 at risk per trade**
- [ ] **Maker orders default** where possible
- [ ] **Automated weekly reviews** — System generates report, you read it
- [ ] **Begin using Kalshi's 4% interest** on idle cash to offset fee drag

**Advance when:** Consistent profitability over 1 month, all go-live thresholds met, operational confidence

### 7D. Steady state
- [ ] **Scale position sizes** based on proven strategy Sharpe ratios
- [ ] **Add new strategies** as opportunities are discovered
- [ ] **Retire underperforming strategies** based on rolling performance windows
- [ ] **Consider ECP status** if bankroll exceeds $25K max-loss limits
- [ ] **Consider Liquidity Incentive Program** if maker strategy is profitable

---

## Decision Framework: "Should I go live?"

Answer ALL of these honestly:

| Question | Required Answer |
|----------|----------------|
| Do I have 200+ resolved paper trades? | Yes |
| Is the overall win rate > 55% with statistical significance? | Yes |
| Is total paper P&L positive? | Yes |
| Is annualized Sharpe > 1.0? | Yes |
| Has max drawdown stayed < 15%? | Yes |
| Do I have a working kill switch? | Yes |
| Do I have daily loss limits? | Yes |
| Have I tested a real order (place + cancel)? | Yes |
| Do I understand how Kalshi fees affect my edge? | Yes |
| Am I OK losing the entire initial deposit? | Yes |
| Have I compared paper fills to order book depth? | Yes |
| Do circuit breakers actually fire when tested? | Yes |

If any answer is "No" — you're not ready. The system will tell you when the numbers are undeniable.

---

## What NOT to Do

- **Don't rush to real money.** The system needs hundreds of trades to prove anything. 50 trades at 60% win rate is noise.
- **Don't increase size after a winning streak.** That's how you give back gains. Size increases should be planned and gradual.
- **Don't override the system.** If a circuit breaker fires, respect it. Don't manually re-enable and "give it one more chance."
- **Don't trade markets you don't understand.** The strategies should. But if you see a trade on a market whose settlement conditions are ambiguous, skip it.
- **Don't ignore fees.** At small sizes, the 1.75¢ taker fee seems tiny. But it's 7% of a 25¢ contract. Over thousands of trades, fees are the difference between profitable and not.
- **Don't fight the longshot bias.** Contracts under 10¢ lose money historically. Even if "this one is different," the base rate is against you.
