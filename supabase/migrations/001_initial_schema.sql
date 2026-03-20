-- Events
create table events (
  event_ticker text primary key,
  title text not null,
  category text,
  sub_title text,
  mutually_exclusive boolean default false,
  status text not null default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Markets
create table markets (
  ticker text primary key,
  event_ticker text references events(event_ticker),
  title text not null,
  subtitle text,
  status text not null default 'open',
  yes_bid numeric,
  yes_ask numeric,
  last_price numeric,
  volume integer,
  open_interest integer,
  close_time timestamptz,
  result text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Price Snapshots
create table price_snapshots (
  id uuid primary key default gen_random_uuid(),
  ticker text references markets(ticker) not null,
  yes_bid numeric not null,
  yes_ask numeric not null,
  last_price numeric not null,
  volume integer not null default 0,
  snapshot_at timestamptz default now()
);
create index idx_price_snapshots_ticker_time on price_snapshots(ticker, snapshot_at desc);

-- Predictions
create table predictions (
  id uuid primary key default gen_random_uuid(),
  ticker text references markets(ticker) not null,
  side text not null check (side in ('yes', 'no')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  fair_value numeric not null check (fair_value >= 0 and fair_value <= 1),
  edge numeric not null,
  reasoning text not null,
  status text not null default 'pending' check (status in ('pending', 'correct', 'incorrect', 'expired')),
  created_at timestamptz default now(),
  resolved_at timestamptz
);
create index idx_predictions_ticker on predictions(ticker);

-- Paper Trades
create table paper_trades (
  id uuid primary key default gen_random_uuid(),
  ticker text references markets(ticker) not null,
  side text not null check (side in ('yes', 'no')),
  quantity integer not null,
  price numeric not null,
  cost numeric not null,
  status text not null default 'open' check (status in ('open', 'closed', 'expired')),
  exit_price numeric,
  pnl numeric,
  prediction_id uuid references predictions(id),
  created_at timestamptz default now(),
  closed_at timestamptz
);
create index idx_paper_trades_status on paper_trades(status);

-- Portfolio Snapshots
create table portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  cash numeric not null default 10000,
  unrealized_pnl numeric not null default 0,
  realized_pnl numeric not null default 0,
  total_value numeric not null default 10000,
  snapshot_at timestamptz default now()
);

-- Watchlist
create table watchlist (
  ticker text primary key references markets(ticker),
  added_at timestamptz default now(),
  notes text
);

-- Sync Log
create table sync_log (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  status text not null check (status in ('success', 'error')),
  records_processed integer not null default 0,
  error_message text,
  started_at timestamptz not null,
  completed_at timestamptz not null
);

-- Enable RLS but allow service role full access
alter table events enable row level security;
alter table markets enable row level security;
alter table price_snapshots enable row level security;
alter table predictions enable row level security;
alter table paper_trades enable row level security;
alter table portfolio_snapshots enable row level security;
alter table watchlist enable row level security;
alter table sync_log enable row level security;

-- Policies for anon read access (dashboard)
create policy "Allow anon read" on events for select using (true);
create policy "Allow anon read" on markets for select using (true);
create policy "Allow anon read" on price_snapshots for select using (true);
create policy "Allow anon read" on predictions for select using (true);
create policy "Allow anon read" on paper_trades for select using (true);
create policy "Allow anon read" on portfolio_snapshots for select using (true);
create policy "Allow anon read" on watchlist for select using (true);
create policy "Allow anon read" on sync_log for select using (true);
