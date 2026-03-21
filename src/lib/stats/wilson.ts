/**
 * Wilson Score Confidence Interval
 *
 * Better than normal approximation for small sample sizes.
 * Used to determine statistically significant win rates.
 */

export interface WilsonInterval {
  lower: number;
  upper: number;
  center: number;
}

/**
 * Compute Wilson score confidence interval for a proportion.
 * @param wins - Number of successes
 * @param total - Total number of trials
 * @param confidence - Confidence level (default 0.95)
 * @returns { lower, upper, center } bounds on the true proportion
 */
export function wilsonScoreInterval(
  wins: number,
  total: number,
  confidence: number = 0.95,
): WilsonInterval {
  if (total === 0) {
    return { lower: 0, upper: 0, center: 0 };
  }

  // z-score for the confidence level
  const z = zScore(confidence);
  const z2 = z * z;
  const p = wins / total;
  const n = total;

  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denominator;

  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    center,
  };
}

/**
 * Check if a win rate is statistically significant (CI lower bound > threshold).
 */
export function isWinRateSignificant(
  wins: number,
  total: number,
  threshold: number = 0.5,
  confidence: number = 0.95,
): boolean {
  if (total === 0) return false;
  const { lower } = wilsonScoreInterval(wins, total, confidence);
  return lower > threshold;
}

/**
 * z-score lookup for common confidence levels.
 */
function zScore(confidence: number): number {
  // Common values — avoids needing a full inverse normal CDF
  if (confidence >= 0.999) return 3.291;
  if (confidence >= 0.99) return 2.576;
  if (confidence >= 0.975) return 2.241;
  if (confidence >= 0.95) return 1.96;
  if (confidence >= 0.90) return 1.645;
  if (confidence >= 0.85) return 1.44;
  if (confidence >= 0.80) return 1.282;
  return 1.96; // default to 95%
}
