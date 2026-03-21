/**
 * Prediction calibration system.
 *
 * Measures how well our confidence/fair_value estimates match actual outcomes.
 * - Buckets predictions by confidence level
 * - Computes actual win rate per bucket
 * - Calculates Brier score (lower = better calibrated)
 * - Identifies systematic biases per strategy
 */

import type { SimulatedTrade } from "./engine";

export interface CalibrationBucket {
  confidence_low: number;
  confidence_high: number;
  total: number;
  correct: number;
  actual_rate: number;
  brier_score: number;
  avg_pnl: number;
}

export interface CalibrationReport {
  strategy_id: string;
  overall_brier: number;
  overall_bias: number; // positive = overconfident, negative = underconfident
  buckets: CalibrationBucket[];
  recommendation: string;
}

/**
 * Analyze calibration for a set of backtest trades.
 * Groups by strategy and computes calibration metrics.
 */
export function analyzeCalibration(trades: SimulatedTrade[]): CalibrationReport[] {
  // Group by strategy
  const byStrategy = new Map<string, SimulatedTrade[]>();
  for (const t of trades) {
    if (!byStrategy.has(t.strategy_id)) byStrategy.set(t.strategy_id, []);
    byStrategy.get(t.strategy_id)!.push(t);
  }

  const reports: CalibrationReport[] = [];

  for (const [stratId, stratTrades] of byStrategy) {
    const buckets = computeBuckets(stratTrades);
    const overallBrier = computeOverallBrier(stratTrades);
    const overallBias = computeBias(stratTrades);

    let recommendation: string;
    if (Math.abs(overallBias) < 0.05 && overallBrier < 0.25) {
      recommendation = "Well-calibrated. Confidence estimates are reliable.";
    } else if (overallBias > 0.10) {
      recommendation = `Overconfident by ${(overallBias * 100).toFixed(0)}%. Reduce fair_value estimates or widen confidence intervals.`;
    } else if (overallBias < -0.10) {
      recommendation = `Underconfident by ${(Math.abs(overallBias) * 100).toFixed(0)}%. Strategy has more edge than estimated — consider sizing up.`;
    } else if (overallBrier > 0.30) {
      recommendation = "Poorly calibrated (Brier > 0.30). Probability estimates need work — consider using empirical base rates.";
    } else {
      recommendation = "Moderately calibrated. Some room for improvement.";
    }

    reports.push({
      strategy_id: stratId,
      overall_brier: Math.round(overallBrier * 10000) / 10000,
      overall_bias: Math.round(overallBias * 10000) / 10000,
      buckets,
      recommendation,
    });
  }

  return reports;
}

function computeBuckets(trades: SimulatedTrade[]): CalibrationBucket[] {
  // Bucket edges: 50-55%, 55-60%, ..., 85-90%, 90-100%
  const edges = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 1.00];
  const buckets: CalibrationBucket[] = [];

  for (let i = 0; i < edges.length - 1; i++) {
    const low = edges[i];
    const high = edges[i + 1];

    // Use fair_value as the probability estimate
    const inBucket = trades.filter((t) => {
      const prob = t.side === "yes" ? t.fair_value : 1 - t.fair_value;
      return prob >= low && prob < high;
    });

    if (inBucket.length === 0) continue;

    const correct = inBucket.filter((t) => t.result === "win").length;
    const actualRate = correct / inBucket.length;
    const avgPnl = inBucket.reduce((s, t) => s + t.pnl, 0) / inBucket.length;

    // Brier score for this bucket
    const brier =
      inBucket.reduce((s, t) => {
        const prob = t.side === "yes" ? t.fair_value : 1 - t.fair_value;
        const outcome = t.result === "win" ? 1 : 0;
        return s + (prob - outcome) ** 2;
      }, 0) / inBucket.length;

    buckets.push({
      confidence_low: low,
      confidence_high: high,
      total: inBucket.length,
      correct,
      actual_rate: Math.round(actualRate * 1000) / 1000,
      brier_score: Math.round(brier * 10000) / 10000,
      avg_pnl: Math.round(avgPnl * 100) / 100,
    });
  }

  return buckets;
}

function computeOverallBrier(trades: SimulatedTrade[]): number {
  if (trades.length === 0) return 0;
  const sum = trades.reduce((s, t) => {
    const prob = t.side === "yes" ? t.fair_value : 1 - t.fair_value;
    const outcome = t.result === "win" ? 1 : 0;
    return s + (prob - outcome) ** 2;
  }, 0);
  return sum / trades.length;
}

function computeBias(trades: SimulatedTrade[]): number {
  if (trades.length === 0) return 0;
  // Bias = avg(predicted probability) - avg(actual outcome)
  const avgPred =
    trades.reduce((s, t) => {
      return s + (t.side === "yes" ? t.fair_value : 1 - t.fair_value);
    }, 0) / trades.length;
  const avgOutcome =
    trades.filter((t) => t.result === "win").length / trades.length;
  return avgPred - avgOutcome;
}

/**
 * Format calibration report for display
 */
export function formatCalibrationReport(reports: CalibrationReport[]): string {
  const lines: string[] = [];
  lines.push("\n=== PREDICTION CALIBRATION ===\n");

  for (const report of reports) {
    lines.push(`Strategy: ${report.strategy_id}`);
    lines.push(`  Overall Brier Score: ${report.overall_brier} (lower is better, <0.25 is good)`);
    lines.push(`  Overall Bias: ${report.overall_bias > 0 ? "+" : ""}${(report.overall_bias * 100).toFixed(1)}% (${report.overall_bias > 0 ? "overconfident" : "underconfident"})`);
    lines.push(`  Recommendation: ${report.recommendation}`);

    if (report.buckets.length > 0) {
      lines.push("");
      lines.push("  Bucket       | Count | Correct | Actual% | Brier | Avg PnL");
      lines.push("  -------------|-------|---------|---------|-------|--------");
      for (const b of report.buckets) {
        lines.push(
          `  ${(b.confidence_low * 100).toFixed(0)}-${(b.confidence_high * 100).toFixed(0)}%`.padEnd(15) +
            `| ${String(b.total).padStart(5)} ` +
            `| ${String(b.correct).padStart(7)} ` +
            `| ${(b.actual_rate * 100).toFixed(1).padStart(6)}% ` +
            `| ${b.brier_score.toFixed(3).padStart(5)} ` +
            `| $${b.avg_pnl.toFixed(2)}`
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Store calibration results in DB
 */
export async function storeCalibration(
  reports: CalibrationReport[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<void> {
  for (const report of reports) {
    for (const bucket of report.buckets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("prediction_calibration").insert({
        strategy_id: report.strategy_id,
        confidence_bucket: (bucket.confidence_low + bucket.confidence_high) / 2,
        total_predictions: bucket.total,
        correct_predictions: bucket.correct,
        actual_rate: bucket.actual_rate,
        brier_score: bucket.brier_score,
      });
    }
  }
}
