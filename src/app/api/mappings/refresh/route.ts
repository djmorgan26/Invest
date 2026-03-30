import { NextResponse } from "next/server";
import { refreshMarketMappings } from "@/lib/external-data/market-matcher";

export const maxDuration = 60;

/**
 * Refresh external market mappings (Polymarket/PredictIt ↔ Kalshi).
 * Runs every 6 hours via cron to keep cross-market divergence detection working.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await refreshMarketMappings();

  return NextResponse.json({
    success: true,
    ...result,
  });
}
