import { createClient } from "@supabase/supabase-js";
import { isDemoMode } from "@/lib/demo/config";
import { createMockSupabaseClient } from "@/lib/demo/mock-client";

/**
 * Server-side Supabase client.
 *
 * In demo mode (set by visiting /demo, or via the DEMO_MODE env var) this
 * returns a mock client backed by local fixtures — no network call is made,
 * so the dashboard works with the database paused and no env keys set.
 *
 * Returns a Promise because demo detection reads the request cookies, which is
 * async in Next.js. All callers `await` this.
 */
export async function createServerClient() {
  if (await isDemoMode()) {
    return createMockSupabaseClient() as unknown as ReturnType<typeof createClient>;
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://demo.invalid",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "demo-key"
  );
}
