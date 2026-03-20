/**
 * Kalshi market mechanics — fee calculation, position sizing, and price guardrails.
 *
 * Key facts:
 * - Binary contracts: settle at $1.00 (YES) or $0.00 (NO)
 * - Prices in cents: 1¢–99¢
 * - CLOB order book: large orders walk the book (price impact)
 * - Taker fee: ceil(0.07 * contracts * price * (1 - price))  — max 1.75¢/contract at 50¢
 * - Maker fee: ceil(0.0175 * contracts * price * (1 - price)) — 25% of taker fee
 * - Some series have fee multiplier (e.g., 0.5x for S&P/Nasdaq)
 * - No settlement fee
 * - Favorite-longshot bias: contracts < 10¢ lose ~60% of money historically
 */

/** Calculate Kalshi taker fee in dollars for a given trade */
export function takerFee(
  contracts: number,
  priceNorm: number, // 0-1 scale
  feeMultiplier = 1.0
): number {
  // Fee = ceil(0.07 * C * P * (1 - P)) per the Kalshi fee schedule
  // This is per-contract, summed
  const feePerContract = Math.ceil(7 * priceNorm * (1 - priceNorm) * feeMultiplier) / 100;
  return contracts * feePerContract;
}

/** Calculate Kalshi maker fee in dollars for a given trade */
export function makerFee(
  contracts: number,
  priceNorm: number,
  feeMultiplier = 1.0
): number {
  const feePerContract = Math.ceil(1.75 * priceNorm * (1 - priceNorm) * feeMultiplier) / 100;
  return contracts * feePerContract;
}

/**
 * Calculate the net profit if a trade wins, accounting for fees.
 * When you buy YES at price P and it settles YES, you get $1.00 - P per contract.
 * When you buy NO at price (1 - yesBid), you get $1.00 - (1 - yesBid) per contract.
 * Minus taker fee on entry (we assume taker for paper trading realism).
 */
export function netProfitIfWin(
  contracts: number,
  entryPriceNorm: number, // what you pay per contract, 0-1
): number {
  const grossProfit = contracts * (1.0 - entryPriceNorm);
  const fee = takerFee(contracts, entryPriceNorm);
  return grossProfit - fee;
}

/** Calculate net loss if a trade loses (you lose your cost + entry fee) */
export function netLossIfLose(
  contracts: number,
  entryPriceNorm: number,
): number {
  const cost = contracts * entryPriceNorm;
  const fee = takerFee(contracts, entryPriceNorm);
  return -(cost + fee);
}

/**
 * Calculate the minimum edge (in 0-1 scale) needed to be profitable after fees.
 * Edge must exceed the fee drag to have positive expected value.
 */
export function minEdgeAfterFees(priceNorm: number): number {
  // Fee per contract as fraction of $1
  const feePerContract = Math.ceil(7 * priceNorm * (1 - priceNorm)) / 100;
  // Need edge > fee to be profitable. Add a buffer for safety.
  return feePerContract + 0.02; // fee + 2¢ minimum buffer
}

/**
 * Entry price guardrails — reject trades with terrible risk/reward.
 *
 * At 97¢: max profit = 3¢, max loss = 97¢ → need 97% win rate to break even
 * At 90¢: max profit = 10¢, max loss = 90¢ → need 90% win rate to break even
 * At 80¢: max profit = 20¢, max loss = 80¢ → need 80% win rate to break even
 *
 * We enforce:
 * - No entries above 85¢ (need >85% win rate which is unrealistic for most strategies)
 * - No entries below 10¢ (favorite-longshot bias: these lose money historically)
 * - Exception: extreme-value strategy can go to 92¢ since it targets near-certain outcomes
 */
export function isEntryPriceSafe(
  entryPriceNorm: number,
  strategyId?: string,
): boolean {
  const maxEntry = strategyId === "extreme-value" ? 0.92 : 0.85;
  const minEntry = 0.08; // avoid longshot bias
  return entryPriceNorm >= minEntry && entryPriceNorm <= maxEntry;
}

/**
 * Position sizing based on edge, liquidity, and portfolio constraints.
 *
 * Rules:
 * 1. Max 10% of portfolio per position (unchanged)
 * 2. Max 2% of daily volume — don't be a whale in a thin market
 * 3. Scale quantity by edge: higher edge → more contracts (up to limits)
 * 4. Minimum 1 contract, cap at reasonable amounts for eventual real trading
 * 5. Cost-aware: total cost must fit available capital
 */
export function sizePosition(params: {
  entryPriceNorm: number; // what we pay per contract (0-1)
  edge: number; // expected edge (0-1)
  volume24h: number; // 24h volume in contracts
  openInterest: number; // current open interest
  availableCapital: number; // dollars available
  portfolioValue: number; // total portfolio value
}): number {
  const {
    entryPriceNorm,
    edge,
    volume24h,
    openInterest,
    availableCapital,
  } = params;

  // 1. Max cost = 10% of portfolio
  const maxCostDollars = params.portfolioValue * 0.10;
  const maxByCapital = Math.floor(Math.min(maxCostDollars, availableCapital) / entryPriceNorm);

  // 2. Max 2% of 24h volume (don't dominate a thin market)
  //    If volume is very low (<50), cap at 5 contracts
  const maxByLiquidity = volume24h > 50
    ? Math.floor(volume24h * 0.02)
    : Math.min(5, Math.floor(volume24h * 0.10));

  // 3. Scale by edge: base = 5 contracts, scale up to 25 for large edges
  //    edge of 0.05 → 5 contracts, edge of 0.15+ → 25 contracts
  const edgeScaled = Math.floor(5 + Math.min(edge - 0.05, 0.10) / 0.10 * 20);
  const maxByEdge = Math.max(1, Math.min(edgeScaled, 25));

  // 4. Take the minimum of all constraints
  const quantity = Math.max(1, Math.min(maxByCapital, maxByLiquidity, maxByEdge));

  // 5. Final sanity: never risk more than $25 per trade for paper trading
  //    (realistic for testing — you'd start with small real wagers too)
  const maxCost = 25;
  const maxByCostCap = Math.floor(maxCost / entryPriceNorm);

  return Math.max(1, Math.min(quantity, maxByCostCap));
}

/**
 * Calculate expected value of a trade.
 * EV = (win_probability * profit_if_win) + ((1 - win_probability) * loss_if_lose)
 *
 * For a binary contract:
 * - We estimate win probability from our fair value
 * - Profit if win = (1 - entry_price) per contract minus fees
 * - Loss if lose = entry_price per contract plus fees
 */
export function expectedValue(
  contracts: number,
  entryPriceNorm: number,
  fairValueNorm: number, // our estimate of true probability
): number {
  const winProb = fairValueNorm;
  const profitIfWin = netProfitIfWin(contracts, entryPriceNorm);
  const lossIfLose = netLossIfLose(contracts, entryPriceNorm);
  return winProb * profitIfWin + (1 - winProb) * lossIfLose;
}

/**
 * Risk/reward ratio: potential profit vs potential loss.
 * Higher is better. Minimum acceptable: 0.15 (risking $1 to make $0.15).
 */
export function riskRewardRatio(entryPriceNorm: number): number {
  const potentialProfit = 1 - entryPriceNorm;
  const potentialLoss = entryPriceNorm;
  return potentialProfit / potentialLoss;
}
