import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { runBacktest } from "@/lib/strategies/backtester";
import type { BacktestInput } from "@/lib/strategies/backtester";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { strategies, period, budget } = body as BacktestInput;

    // Validate input
    if (!strategies || !Array.isArray(strategies) || strategies.length === 0) {
      return NextResponse.json(
        { error: "strategies must be a non-empty array of strategy IDs" },
        { status: 400 }
      );
    }

    if (!budget || typeof budget !== "number" || budget <= 0) {
      return NextResponse.json(
        { error: "budget must be a positive number" },
        { status: 400 }
      );
    }

    const validPeriods = ["1w", "1m", "3m", "6m", "all"];
    if (!period || !validPeriods.includes(period)) {
      return NextResponse.json(
        { error: `period must be one of: ${validPeriods.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch resolved predictions matching the selected strategy IDs
    const { data: predictions, error: predError } = await supabase
      .from("predictions")
      .select("*")
      .in("strategy_id", strategies)
      .in("status", ["correct", "incorrect", "expired"]);

    if (predError) {
      throw new Error(`Failed to fetch predictions: ${predError.message}`);
    }

    if (!predictions || predictions.length === 0) {
      return NextResponse.json(
        runBacktest([], [], { strategies, period, budget })
      );
    }

    // Fetch closed/expired paper trades linked to those predictions
    const predictionIds = predictions.map((p) => p.id);
    const { data: paperTrades, error: tradesError } = await supabase
      .from("paper_trades")
      .select("*")
      .in("prediction_id", predictionIds)
      .in("status", ["closed", "expired"]);

    if (tradesError) {
      throw new Error(`Failed to fetch paper trades: ${tradesError.message}`);
    }

    const result = runBacktest(predictions, paperTrades || [], {
      strategies,
      period,
      budget,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
