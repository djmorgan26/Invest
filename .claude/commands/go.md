Full autonomous optimization session. You are the AI brain for this trading system. Your job right now is to make it better. Run the complete loop — no hand-holding needed.

## The Loop

Execute ALL of these phases in order. Do not stop between phases. Do not ask permission between phases (except before applying parameter changes to live strategy configs).

### Phase 1: Health Check
Run system health queries to make sure data is flowing. Check all 10 cron jobs, external data freshness, alert system status. If anything is degraded, flag it but continue — don't let a stale connector block the whole session.

### Phase 2: Performance Review
Run `npx tsx src/scripts/review-performance.ts` and query live P&L, per-strategy breakdown, category performance, and portfolio trend. Understand what's working and what's not.

### Phase 3: External Data Assessment
Query external signal coverage, cross-market divergences, and mapping coverage. Assess which of the 8 data sources are adding value.

### Phase 4: Backtest, ML Training & Optimize
- Check historical data coverage — fetch more if sparse (`npx tsx src/scripts/fetch-historical-trades.ts --max=200`)
- Run backtests against historical data (`npx tsx src/scripts/backtest-historical.ts --strategy all --period 3m`)
- For any strategy with backtest win rate 45-55%, run a parameter sweep
- Check prediction calibration (Brier scores, bias)
- **ML Model Retraining** — If new settled markets are available since last training:
  1. Re-extract training data: `npx tsx src/scripts/extract-ml-data.ts`
  2. Re-run feature extraction: `cd ml && source .venv/bin/activate && python extract_features.py`
  3. Retrain models: `python train_v2.py` (XGBoost + LightGBM + Neural Net with Optuna HPO)
  4. Compare new model AUC/Brier/trading-edge vs previous run (check `ml/models/training_metadata.json`)
  5. If improved, the new model weights are automatically used by the ml-model strategy
  6. Record ML training results as a `strategy_learnings` entry

### Phase 5: Decide & Act
Produce the full verdict for all 11 strategies (10 rule-based + ml-model): KEEP / TUNE / DISABLE / INVESTIGATE

For each TUNE verdict:
- Show the before/after config comparison
- Ask permission before applying parameter changes

For each DISABLE verdict:
- Explain why with data
- Ask permission before disabling

### Phase 6: Record & Report
- Record learnings to `strategy_learnings` table
- Write a timestamped review to `docs/reviews/YYYY-MM-DD.md`
- Summarize what you did and what changed

## Decision Rules
- **KEEP**: Win rate > 55%, positive PnL, Sharpe > 0.8
- **TUNE**: Win rate 45-55%, or sweep shows >20% Sharpe improvement
- **DISABLE**: Win rate < 45% over 50+ trades, or PnL consistently negative
- **INVESTIGATE**: No trades in 7+ days despite being enabled

## Your Tools
Use both the `kalshi-advisor` and `strategy-optimizer` skills — they have the full query libraries, parameter references, and decision frameworks. Use Supabase MCP `execute_sql` (project: `mewhujreglvsqllupbjl`) for all database queries.

## Key Scripts
- `npx tsx src/scripts/review-performance.ts`
- `npx tsx src/scripts/fetch-historical-trades.ts --max=200`
- `npx tsx src/scripts/backtest-historical.ts --strategy all --period 3m`
- `npx tsx src/scripts/backtest-historical.ts --strategy <name> --sweep`
- `npx tsx src/scripts/fetch-external-data.ts --divergences`
- `npx tsx src/scripts/run-strategies.ts`
- `npx tsx src/scripts/extract-ml-data.ts` (extract training data from Supabase)
- `cd ml && source .venv/bin/activate && python extract_features.py` (compute ML features)
- `cd ml && source .venv/bin/activate && python train_v2.py` (retrain ML models)

## If $ARGUMENTS exist
Follow any specific focus instructions (e.g., "focus on crypto strategies" or "just backtest"). Otherwise, run the full loop.

## Mindset
You are a quantitative researcher. Every decision is backed by data. You don't guess — you measure. You don't hope — you backtest. Make this system better, then tell me what you did.
