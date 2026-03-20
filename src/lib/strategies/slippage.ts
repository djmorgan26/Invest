/**
 * Slippage estimation from order book depth.
 *
 * Walks the order book levels to compute the volume-weighted average price (VWAP)
 * for a given quantity. Returns the effective entry price and slippage in cents.
 */

export interface SlippageEstimate {
  /** Effective price per contract (0-1 scale) after walking the book */
  effectivePrice: number;
  /** Slippage in cents (effectivePrice - bestPrice) * 100 */
  slippageCents: number;
  /** Whether the full quantity can be filled from available depth */
  canFill: boolean;
  /** Quantity that can actually be filled */
  fillableQuantity: number;
}

export interface DepthLevel {
  price: number; // cents (0-100)
  quantity: number; // contracts available
}

/**
 * Estimate slippage for buying YES contracts.
 * Walks the ask side of the order book (ascending price).
 */
export function estimateSlippageYes(
  depthYesAsk: DepthLevel[],
  quantity: number
): SlippageEstimate {
  return walkBook(depthYesAsk, quantity, "asc");
}

/**
 * Estimate slippage for buying NO contracts.
 * Walks the bid side inverted: buying NO = selling YES at the bid.
 * depth_yes_bid is sorted descending by price (best bid first).
 * NO cost = (100 - yes_bid_price) per contract.
 */
export function estimateSlippageNo(
  depthYesBid: DepthLevel[],
  quantity: number
): SlippageEstimate {
  // Convert YES bid levels to NO cost levels
  const noLevels: DepthLevel[] = depthYesBid.map((l) => ({
    price: 100 - l.price, // NO cost in cents
    quantity: l.quantity,
  }));
  // NO levels are now ascending in cost (cheapest first, since highest YES bid → lowest NO cost)
  return walkBook(noLevels, quantity, "asc");
}

function walkBook(
  levels: DepthLevel[],
  quantity: number,
  _direction: "asc" | "desc"
): SlippageEstimate {
  if (levels.length === 0 || quantity <= 0) {
    return {
      effectivePrice: 0,
      slippageCents: 0,
      canFill: false,
      fillableQuantity: 0,
    };
  }

  const bestPrice = levels[0].price;
  let remaining = quantity;
  let totalCost = 0; // in cents * contracts
  let filled = 0;

  for (const level of levels) {
    if (remaining <= 0) break;

    const fillAtLevel = Math.min(remaining, level.quantity);
    totalCost += fillAtLevel * level.price;
    filled += fillAtLevel;
    remaining -= fillAtLevel;
  }

  if (filled === 0) {
    return {
      effectivePrice: 0,
      slippageCents: 0,
      canFill: false,
      fillableQuantity: 0,
    };
  }

  const vwapCents = totalCost / filled;
  const effectivePrice = vwapCents / 100; // normalize to 0-1
  const slippageCents = vwapCents - bestPrice;

  return {
    effectivePrice,
    slippageCents: Math.round(slippageCents * 100) / 100,
    canFill: remaining <= 0,
    fillableQuantity: filled,
  };
}
