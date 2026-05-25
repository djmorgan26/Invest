// =============================================================================
// Demo mode configuration (server-only)
// -----------------------------------------------------------------------------
// No-login demo mode lets recruiters explore the full dashboard UI without
// signing in and WITHOUT any live backend. When demo mode is active:
//   - All Supabase reads are served from local fixtures (see ./fixtures.ts).
//   - All Supabase/external/WebSocket calls are short-circuited so nothing
//     fires (works even with the database paused and no env keys set).
//   - All write/trade actions are no-ops.
//
// Demo mode is enabled by visiting /demo, which sets a cookie and redirects to
// the dashboard. It can also be forced for an entire deployment with the
// DEMO_MODE=1 (or NEXT_PUBLIC_DEMO_MODE=1) environment variable.
//
// This module imports "next/headers" and must only be used server-side.
// Client code should use ./client.ts instead. Shared constants live in
// ./shared.ts.
// =============================================================================

import { cookies } from "next/headers";
import { DEMO_COOKIE, demoForcedByEnv } from "./shared";

export { DEMO_COOKIE, demoForcedByEnv } from "./shared";

/**
 * Server-side demo detection. Reads the demo cookie (set by /demo) or the
 * DEMO_MODE env var. Safe to call from Server Components and Route Handlers.
 */
export async function isDemoMode(): Promise<boolean> {
  if (demoForcedByEnv()) return true;
  try {
    const store = await cookies();
    return store.get(DEMO_COOKIE)?.value === "1";
  } catch {
    // cookies() is unavailable outside a request scope (e.g. during build).
    return false;
  }
}
