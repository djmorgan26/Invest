Read the performance report by running: npx tsx src/scripts/review-performance.ts

Analyze:
1. Which strategies are profitable? Which are bleeding?
2. Are any strategies approaching decay threshold (40% win rate)?
3. What market categories/types produce the best trades?
4. Review recent strategy_learnings — are the tuner's adjustments helping?
5. Check if any strategy should be disabled, re-parameterized, or fundamentally redesigned.

Output a structured report with:
- **Status summary** (1 paragraph)
- **Per-strategy assessment** (2-3 sentences each)
- **Category performance** (which market categories work best)
- **Top 3 recommended actions** (ranked by expected impact)
- **Any new strategy ideas** based on patterns you see

After outputting, save the review:
1. Write a timestamped review file to docs/reviews/ (format: YYYY-MM-DD.md)
2. Record key insights as learnings using the recordLearning utility pattern (insert into strategy_learnings table)
