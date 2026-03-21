import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { scanAll, autoTrade } from "@/lib/strategies/engine";
import { getCircuitBreakerStatus } from "@/lib/strategies/circuit-breakers";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startedAt = new Date().toISOString();

    // Scan for opportunities
    const scanResult = await scanAll();

    // Auto-trade on opportunities
    const tradeResult = await autoTrade(scanResult.opportunities);

    const completedAt = new Date().toISOString();

    // Log to sync_log
    const supabase = createServerClient();
    await supabase.from("sync_log").insert({
      type: "strategy_scan",
      status: "success",
      records_processed: scanResult.opportunities.length,
      started_at: startedAt,
      completed_at: completedAt,
    });

    // Include circuit breaker status in scan response
    const breakerStatus = await getCircuitBreakerStatus();

    return NextResponse.json({
      success: true,
      scan: {
        opportunities_found: scanResult.opportunities.length,
        strategies_run: scanResult.strategiesRun,
        strategies_skipped: scanResult.strategiesSkipped,
        per_strategy: scanResult.perStrategy,
      },
      trades: {
        placed: tradeResult.trades_placed,
        predictions_written: tradeResult.predictions_written,
        skipped: tradeResult.skipped,
        details: tradeResult.details,
      },
      circuit_breakers: {
        all_clear: breakerStatus.all_clear,
        kill_switch: breakerStatus.kill_switch_active,
        daily_pnl: breakerStatus.daily_pnl,
        drawdown_pct: breakerStatus.drawdown_pct,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    try {
      const supabase = createServerClient();
      await supabase.from("sync_log").insert({
        type: "strategy_scan",
        status: "error",
        records_processed: 0,
        error_message: message,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    } catch {
      // silently fail logging
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
