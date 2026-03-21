import { NextRequest, NextResponse } from "next/server";
import {
  getCircuitBreakerStatus,
  activateKillSwitch,
  deactivateKillSwitch,
} from "@/lib/strategies/circuit-breakers";

export const dynamic = "force-dynamic";

// GET /api/circuit-breakers — status of all circuit breakers
export async function GET() {
  try {
    const status = await getCircuitBreakerStatus();
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/circuit-breakers — toggle kill switch
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action, reason } = body;

    if (action === "activate") {
      await activateKillSwitch(reason || "Manual activation via API");
      return NextResponse.json({ success: true, kill_switch: "active" });
    } else if (action === "deactivate") {
      await deactivateKillSwitch();
      return NextResponse.json({ success: true, kill_switch: "inactive" });
    } else {
      return NextResponse.json({ error: "Invalid action. Use 'activate' or 'deactivate'" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
