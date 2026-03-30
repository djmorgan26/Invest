import { NextResponse } from "next/server";
import { fetchAndStoreAllSignals, findCrossMarketDivergences } from "@/lib/external-data/aggregator";
import { refreshMarketMappings } from "@/lib/external-data/market-matcher";

export const maxDuration = 120;

export async function POST(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await fetchAndStoreAllSignals();
    const divergences = await findCrossMarketDivergences({ minDivergenceCents: 5 });

    // Refresh cross-market mappings after fetching new signals
    let mappings = { created: 0, updated: 0, total_checked: 0 };
    try {
      mappings = await refreshMarketMappings();
    } catch (mapErr) {
      console.error("[external-data/fetch] Mapping refresh failed:", mapErr);
    }

    return NextResponse.json({
      success: true,
      signals_stored: result.total,
      by_source: result.bySource,
      errors: result.errors,
      divergences: divergences.slice(0, 20),
      mappings,
    });
  } catch (err) {
    console.error("[external-data/fetch] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
