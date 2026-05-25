import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/demo/shared";

export const dynamic = "force-dynamic";

/**
 * Demo entry point. Visiting /demo enables no-login demo mode by setting a
 * cookie, then redirects to the dashboard. The dashboard then renders the full
 * UI from local fixtures — no Supabase, no auth, no live API.
 */
export async function GET(request: Request) {
  const url = new URL("/dashboard", request.url);
  const res = NextResponse.redirect(url);
  res.cookies.set(DEMO_COOKIE, "1", {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 1 week
  });
  return res;
}
