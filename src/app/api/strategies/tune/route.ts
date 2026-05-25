import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { tuneAll } from "@/lib/strategies/tuner";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startedAt = new Date().toISOString();
    const results = await tuneAll();
    const completedAt = new Date().toISOString();

    const changed = results.filter((r) => r.changed);

    const supabase = await createServerClient();
    await supabase.from("sync_log").insert({
      type: "strategy_tune",
      status: "success",
      records_processed: changed.length,
      started_at: startedAt,
      completed_at: completedAt,
    });

    return NextResponse.json({
      success: true,
      strategies_tuned: changed.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Log error to sync_log for operational visibility
    try {
      const supabase = await createServerClient();
      await supabase.from("sync_log").insert({
        type: "strategy_tune",
        status: "error",
        records_processed: 0,
        error_message: message,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    } catch {
      // Don't let logging failure mask the real error
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
