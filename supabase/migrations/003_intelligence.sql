-- Phase 3: Intelligence layer tables

-- Market context cache (news, sentiment, catalysts)
create table market_context (
  id uuid primary key default gen_random_uuid(),
  ticker text references markets(ticker) not null,
  context_type text not null,    -- 'news', 'sentiment', 'catalyst'
  content text not null,
  source text,
  relevance_score float,
  created_at timestamptz default now(),
  expires_at timestamptz         -- context goes stale
);

create index idx_market_context_ticker on market_context(ticker);
create index idx_market_context_type on market_context(context_type);
create index idx_market_context_expires on market_context(expires_at);

alter table market_context enable row level security;
create policy "Allow anon read" on market_context for select using (true);
create policy "Allow service role full access" on market_context for all using (true);

-- Reviews table (stores structured review reports)
create table reviews (
  id uuid primary key default gen_random_uuid(),
  review_type text not null,     -- 'weekly', 'ad-hoc', 'health-check'
  summary text not null,
  recommendations jsonb,         -- [{action, priority, reasoning}]
  metrics jsonb,                 -- snapshot of key metrics at review time
  created_at timestamptz default now()
);

create index idx_reviews_type on reviews(review_type);
create index idx_reviews_created on reviews(created_at desc);

alter table reviews enable row level security;
create policy "Allow anon read" on reviews for select using (true);
create policy "Allow service role full access" on reviews for all using (true);
