Deep research investigation for a prediction market opportunity.

If $ARGUMENTS contains a ticker, research that specific market using the deep-research skill.
If $ARGUMENTS is empty, find the top pending opportunities from the last 6 hours and present them for selection.

Use the deep-research skill to:
1. Gather all internal data (price history, orderbook, siblings, external signals)
2. Perform category-specific web research (politics → polls, sports → injury reports, crypto → on-chain data, etc.)
3. Cross-reference Kalshi pricing against external sources
4. Produce a structured trade recommendation: TRADE / PASS / WAIT with specific entry parameters

Load the research templates from `.claude/skills/deep-research/references/research-templates.md` for category-specific search queries.

Output a complete research report with: findings, fair value estimate, recommendation, risk factors, and time sensitivity.
