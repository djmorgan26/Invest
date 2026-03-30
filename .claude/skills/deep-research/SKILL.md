---
name: deep-research
description: "Deep research agent for investigating prediction market opportunities before committing capital. Performs web research, analyzes domain-specific data, and synthesizes a trade recommendation. Use when you want to deeply investigate a specific market or scan for high-conviction opportunities. Invoked via /project:research-opportunity [TICKER]."
---

# Deep Research — Opportunity Investigation Agent

This skill turns Claude into a research analyst for prediction market opportunities. It combines internal market data with live web research to produce an informed trade recommendation.

**This is a manual skill.** The user runs it when they want a second opinion backed by real-world data before committing capital.

## When This Skill Applies

- User wants to deeply investigate a specific market before trading
- User wants to find high-conviction opportunities across all strategies
- User asks "should I take this bet?"
- User wants research on a specific topic (politics, sports, crypto, weather, economics)
- User invokes `/project:research-opportunity`

## Workflow

Use the Supabase MCP `execute_sql` tool (project ID: `mewhujreglvsqllupbjl`) for all database queries. Use WebSearch and WebFetch for external research.

### Phase 1: Identify the Opportunity

**If a ticker is provided ($ARGUMENTS):**

Query the market record:
```sql
SELECT m.ticker, m.title, m.subtitle, m.status, m.last_price, m.yes_bid, m.yes_ask,
       m.volume, m.open_interest, m.close_time, m.result, m.event_ticker,
       e.title as event_title, e.category
FROM markets m
LEFT JOIN events e ON m.event_ticker = e.event_ticker
WHERE m.ticker = '$TICKER';
```

**If no ticker provided:**

Find the best current opportunities across all strategies:
```sql
-- Recent strategy predictions (last 6 hours)
SELECT p.ticker, p.side, p.confidence, p.fair_value, p.edge, p.reasoning, p.strategy_id, p.created_at,
       m.title, m.last_price, m.yes_bid, m.yes_ask, m.volume, m.close_time,
       e.category
FROM predictions p
JOIN markets m ON p.ticker = m.ticker
LEFT JOIN events e ON m.event_ticker = e.event_ticker
WHERE p.created_at > NOW() - INTERVAL '6 hours'
  AND p.status = 'pending'
  AND m.result IS NULL
ORDER BY p.edge DESC
LIMIT 15;
```

Present the top opportunities to the user and ask which to research. If none found, check open markets with the highest volume and interesting spreads.

### Phase 2: Gather Internal Context

For the selected ticker, run these queries:

**Price history (24h):**
```sql
SELECT last_price, yes_bid, yes_ask, snapshot_at
FROM price_snapshots
WHERE ticker = '$TICKER'
ORDER BY snapshot_at DESC
LIMIT 48;
```

**Sibling markets (same event):**
```sql
SELECT ticker, title, last_price, yes_bid, yes_ask, volume, result
FROM markets
WHERE event_ticker = (SELECT event_ticker FROM markets WHERE ticker = '$TICKER')
ORDER BY volume DESC;
```

**Our open positions:**
```sql
SELECT * FROM paper_trades WHERE ticker = '$TICKER' AND status = 'open';
```

**External signals (if mapped):**
```sql
SELECT es.source, es.title, es.implied_probability, es.signal_type, es.data, es.fetched_at
FROM external_signals es
WHERE (es.ticker = '$TICKER'
   OR es.category = (SELECT e.category FROM markets m JOIN events e ON m.event_ticker = e.event_ticker WHERE m.ticker = '$TICKER'))
  AND es.fetched_at > NOW() - INTERVAL '24 hours'
ORDER BY es.fetched_at DESC
LIMIT 20;
```

**Orderbook depth:**
```sql
SELECT depth_yes_bid, depth_yes_ask, snapshot_at
FROM orderbook_snapshots
WHERE ticker = '$TICKER'
ORDER BY snapshot_at DESC
LIMIT 1;
```

### Phase 3: Web Research (Category-Specific)

Detect the market's category from Phase 1, then load the appropriate research template from `references/research-templates.md`.

Execute 3-5 targeted web searches using WebSearch. For key results, use WebFetch to read the full article content.

**Critical:** Search for the most RECENT information. Include date qualifiers in searches (e.g., "March 2026", "today", "this week"). Stale research is worse than no research.

### Phase 4: Cross-Reference & Analyze

Compare all data sources:

1. **Kalshi price vs. your research** — Does the current price make sense given what you found?
2. **External signals vs. Kalshi** — Do Polymarket, PredictIt, Vegas odds, or other sources agree?
3. **Trend analysis** — Is the price moving toward or away from your fair value estimate?
4. **Market microstructure** — Is the spread tight enough to enter? Is there enough volume? How close to expiry?
5. **Risk factors** — What could make you wrong? What's the worst case?

### Phase 5: Synthesize Recommendation

Output a structured report in this exact format:

```
## Research Report: [Market Title]
**Ticker:** [TICKER]
**Category:** [category]
**Current Price:** [YES bid/ask] | Last: [last_price]c
**Close Date:** [date] ([X days/hours remaining])

### Research Findings
- [Bullet 1: key finding from web research, with source]
- [Bullet 2: ...]
- [Bullet 3: ...]
- [Bullet 4: ...]

### External Market Comparison
| Source | Price/Odds | Implied Prob | vs Kalshi |
|--------|-----------|-------------|-----------|
| [source] | [price] | [prob] | [+/- divergence] |

### Fair Value Assessment
**Estimated fair value:** [X]c [YES/NO]
**Reasoning:** [1-2 sentences explaining your estimate]
**Confidence:** [Low/Medium/High] — [why]

### Recommendation
**Verdict:** [TRADE / PASS / WAIT]
- **Side:** [YES/NO]
- **Entry price:** [X]c
- **Suggested quantity:** [N contracts] ($[cost])
- **Edge:** [X]c ([Y]%)
- **Expected value:** $[EV per contract]
- **Time horizon:** [when does this resolve?]

### Risk Factors
1. [What could go wrong #1]
2. [What could go wrong #2]
3. [What could go wrong #3]

### Time Sensitivity
[How urgent is this? Will the edge disappear soon? Is there an upcoming event that changes things?]
```

**Decision rules:**
- **TRADE**: Fair value diverges from market price by >5c AND you have high confidence AND risk/reward is favorable
- **PASS**: Edge is <3c, OR confidence is low, OR risk factors outweigh the edge
- **WAIT**: Edge may develop soon (upcoming event, data release), watch and re-evaluate

## Important Constraints

- Never recommend more than $25 per trade (paper trading limits)
- Always account for Kalshi taker fees: `ceil(7 * P * (1-P))` cents per contract
- If the market closes in <2 hours, be extra cautious — prices can move fast
- If volume is <100, note liquidity risk in your report
- If you can't find enough information to form a view, say PASS with reasoning — don't guess
- Cite your sources. Link to articles when possible.
