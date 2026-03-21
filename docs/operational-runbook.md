# Operational Runbook

## Circuit Breaker Response Procedures

### Kill Switch (Manual)

**Trigger:** Manual activation via CLI or API.

**Response:**
1. Assess reason for activation (logged in `strategy_learnings`)
2. Investigate root cause
3. Fix underlying issue
4. Deactivate: `npx tsx src/scripts/kill-switch.ts off`
5. Monitor first 10 trades after re-enabling

**Re-enable:** Only after root cause is resolved. No cooldown period required.

---

### Daily Loss Limit (-$500)

**Trigger:** Daily realized + unrealized P&L drops to -$500 or below.

**Response:**
1. Check `/dashboard/circuit-breakers` or `GET /api/circuit-breakers` for exact P&L
2. Review which trades caused the loss: `/dashboard/trades`
3. Check for market-wide events (election results, economic data, etc.)
4. Determine if losses are systemic or strategy-specific

**Re-enable:** Automatic at midnight UTC (new trading day resets daily P&L).

**Escalation:** If daily loss limit trips 3+ times in a week → activate kill switch and review all strategies.

---

### Drawdown (10% from peak)

**Trigger:** Portfolio value drops 10% or more from its all-time peak.

**Response:**
1. Check portfolio peak vs current value on the dashboard
2. Review cumulative P&L trend: is this a gradual bleed or a sudden drop?
3. If sudden: check for correlated losses across strategies
4. If gradual: review each strategy's recent performance

**Re-enable:** Only when portfolio recovers (new deposits don't count — peak is organic). Alternatively:
1. Activate kill switch
2. Manually adjust the peak baseline by inserting a portfolio snapshot
3. Deactivate kill switch

**Escalation:** Drawdown > 10% is P1 — review all active strategies before resuming.

---

### Category Limit (3 trades per category)

**Trigger:** Attempting to open a 4th trade in the same Kalshi category.

**Response:**
1. Check `/dashboard/circuit-breakers` → Category Exposure table
2. Review if category concentration is intentional (strong edge) or accidental
3. Wait for existing trades in that category to close, or close losing positions manually

**Re-enable:** Automatic when trades in the blocked category close/resolve.

---

### Consecutive Losses (5 per strategy)

**Trigger:** A strategy accumulates 5 consecutive losing trades.

**Response:**
1. Check which strategy is blocked on the dashboard
2. Review the 5 losing trades — are they correlated or independent?
3. Check if market conditions have shifted (regime change)
4. Consider parameter adjustments: `npx tsx src/scripts/backtest-historical.ts --strategy <id> --sweep`

**Re-enable:** Automatic when the strategy records a winning trade. To force-reset, close an open trade at a profit.

**Escalation:** If a strategy hits this limit twice in 2 weeks → disable the strategy and run a full backtest.

---

## Escalation Matrix

| Severity | Criteria | Response Time | Action |
|----------|----------|---------------|--------|
| **P0** | Kill switch activated, drawdown > 15%, or system producing invalid trades | Immediate | Stop everything. Review within 1 hour. |
| **P1** | Drawdown 10-15%, daily loss limit hit, or 2+ strategies blocked | Same day | Review strategies, consider parameter changes |
| **P2** | Category limit hit, single strategy blocked by consecutive losses | Next check-in | Monitor, adjust if pattern persists |
| **P3** | Warning thresholds (drawdown > 7%, daily loss > -$300) | Weekly review | Note in review, no immediate action |

---

## Daily Monitoring Checklist

1. **Check circuit breaker status:** `npx tsx src/scripts/kill-switch.ts status` or visit `/dashboard/circuit-breakers`
2. **Review overnight trades:** `/dashboard/trades` — any unexpected fills or settlements?
3. **Check P&L dashboard:** `/dashboard/pnl` — daily P&L trend, go-live progress
4. **Strategy health:** `/dashboard/strategies` — all strategies enabled? Win rates stable?
5. **Cron jobs running:** Check GitHub Actions → are all scheduled jobs succeeding?
6. **Error logs:** Check Vercel deployment logs for any 500 errors on API routes

---

## Weekly Review Procedure

1. Run: `npx tsx src/scripts/review-performance.ts`
2. Check go-live readiness metrics (especially CI lower bounds on win rates)
3. Review strategy learnings: `/dashboard/reviews`
4. Run parameter sweeps on underperforming strategies
5. Update `docs/plan.md` with status changes
6. Record any insights as strategy learnings

---

## Emergency Procedures

### Halt All Trading Immediately
```bash
npx tsx src/scripts/kill-switch.ts on "Emergency halt: <reason>"
```

### Check System After Outage
```bash
# 1. Check circuit breaker status
npx tsx src/scripts/kill-switch.ts status

# 2. Resolve any trades that settled during outage
npx tsx src/scripts/resolve-trades.ts

# 3. Sync market data
npx tsx src/scripts/sync-markets.ts

# 4. Review P&L
npx tsx src/scripts/review-performance.ts
```

### Roll Back a Bad Strategy Change
1. Check `strategy_learnings` for the param change entry
2. Revert the strategy config in the `strategies` table
3. Record a learning: type `failure_analysis`, describing what went wrong
