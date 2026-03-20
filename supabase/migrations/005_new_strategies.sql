-- Seed volume-spike and event-cluster (missed from earlier), plus 4 new strategies

INSERT INTO strategies (id, name, description, enabled, config) VALUES
  (
    'volume-spike',
    'Volume Spike',
    'Momentum continuation on volume spikes with accompanying price moves. Follows informed flow direction.',
    true,
    '{"volume_multiplier": 3.0, "min_price_move": 0.03, "momentum_factor": 0.3, "lookback_hours": 48, "min_volume": 50, "max_days_to_close": 14, "max_entry_price": 0.85, "min_entry_price": 0.10, "min_risk_reward": 0.20}'
  ),
  (
    'event-cluster',
    'Event Cluster Arbitrage',
    'Exploits mispricings in mutually exclusive event markets where YES prices should sum to 100¢.',
    true,
    '{"min_mispricing": 0.05, "max_markets_per_event": 15, "min_volume": 20}'
  ),
  (
    'favorite-longshot',
    'Favorite-Longshot Bias',
    'Exploits the well-documented favorite-longshot bias: sell overpriced longshots (5-15¢ YES → buy NO), buy underpriced favorites (85-95¢ YES → buy YES). Academic backing: Snowberg & Wolfers 2010.',
    true,
    '{"longshot_low": 0.05, "longshot_high": 0.15, "favorite_low": 0.85, "favorite_high": 0.95, "min_volume": 100, "min_days_to_close": 3, "max_days_to_close": 30, "longshot_overpricing": 0.30, "favorite_underpricing": 0.03, "min_spread_tightness": 0.08}'
  ),
  (
    'expiry-convergence',
    'Expiry Convergence',
    'Snipes markets within 48h of close that are still priced in the uncertain zone (25-75¢). Uses momentum and sibling resolution signals to predict convergence direction.',
    true,
    '{"max_hours_to_close": 48, "min_hours_to_close": 1, "uncertain_low": 0.25, "uncertain_high": 0.75, "min_volume": 50, "momentum_lookback_hours": 12, "min_momentum": 0.05, "momentum_confidence_boost": 0.15, "sibling_resolved_boost": 0.10}'
  ),
  (
    'new-listing',
    'New Listing Edge',
    'Trades newly listed markets (< 24h old) with naive initial pricing. Uses midpoint deviation and sibling context to detect mispricings before market makers arrive.',
    true,
    '{"max_hours_since_listing": 24, "min_spread": 0.06, "min_volume": 5, "max_volume": 500, "max_entry_price": 0.80, "min_entry_price": 0.15, "min_risk_reward": 0.25, "sibling_weight": 0.70, "default_edge_estimate": 0.08}'
  ),
  (
    'liquidity-provision',
    'Liquidity Provision',
    'Passive market making: captures bid-ask spread in stable, wide-spread markets. Uses orderbook depth asymmetry to pick the safer side. Volume strategy with modest per-trade edge.',
    true,
    '{"min_spread": 0.08, "max_spread": 0.25, "min_volume": 30, "max_price_volatility": 0.08, "lookback_hours": 24, "min_depth_ratio": 1.5, "max_days_to_close": 21, "min_days_to_close": 2, "min_entry_price": 0.15, "max_entry_price": 0.85}'
  )
ON CONFLICT (id) DO NOTHING;
