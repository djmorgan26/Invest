-- Add missing indexes for query performance

-- paper_trades: frequently filtered by strategy_id and status
CREATE INDEX IF NOT EXISTS idx_paper_trades_strategy_id ON paper_trades (strategy_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_status ON paper_trades (status);
CREATE INDEX IF NOT EXISTS idx_paper_trades_strategy_status ON paper_trades (strategy_id, status);

-- markets: frequently joined on event_ticker, filtered by status
CREATE INDEX IF NOT EXISTS idx_markets_event_ticker ON markets (event_ticker);
CREATE INDEX IF NOT EXISTS idx_markets_status ON markets (status);
CREATE INDEX IF NOT EXISTS idx_markets_result ON markets (result) WHERE result IS NOT NULL;

-- predictions: filtered by strategy_id and status
CREATE INDEX IF NOT EXISTS idx_predictions_strategy_id ON predictions (strategy_id);
CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions (status);

-- strategy_learnings: filtered by strategy_id and type
CREATE INDEX IF NOT EXISTS idx_strategy_learnings_strategy ON strategy_learnings (strategy_id, learning_type);
