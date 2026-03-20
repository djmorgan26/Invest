-- Strategies table
create table strategies (
  id text primary key,
  name text not null,
  description text,
  enabled boolean default true,
  config jsonb default '{}',
  created_at timestamptz default now()
);

-- Add strategy_id to predictions and paper_trades
alter table predictions add column strategy_id text references strategies(id);
alter table paper_trades add column strategy_id text references strategies(id);

create index idx_predictions_strategy on predictions(strategy_id);
create index idx_paper_trades_strategy on paper_trades(strategy_id);

-- Strategy learnings / audit trail
create table strategy_learnings (
  id uuid primary key default gen_random_uuid(),
  strategy_id text references strategies(id) not null,
  learning_type text not null,
  description text not null,
  data jsonb default '{}',
  created_at timestamptz default now()
);

-- RLS
alter table strategies enable row level security;
alter table strategy_learnings enable row level security;

create policy "Allow anon read" on strategies for select using (true);
create policy "Allow anon read" on strategy_learnings for select using (true);

-- Seed initial strategies
insert into strategies (id, name, description, config) values
  ('wide-spread', 'Wide Spread', 'Buy in markets with bid-ask spread > threshold — capturing the spread as edge', '{"min_spread": 0.10, "min_volume": 100, "max_days_to_close": 14}'),
  ('stale-price', 'Stale Price', 'Detect markets whose price hasn''t moved after a related event resolved — likely mispriced', '{"min_sibling_settlement_hours": 1, "max_hours_since_settlement": 48}'),
  ('extreme-value', 'Extreme Value', 'Buy YES contracts priced < 0.05 or > 0.95 where the outcome is nearly certain', '{"low_threshold": 0.05, "high_threshold": 0.95, "min_volume": 50, "max_days_to_close": 3}'),
  ('mean-reversion', 'Mean Reversion', 'Bet against sharp price moves that overshoot — prices tend to partially revert', '{"min_move": 0.15, "lookback_hours": 24, "reversion_factor": 0.5}');
