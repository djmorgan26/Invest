"use client";

import { DEMO_COOKIE } from "./shared";

/**
 * Client-side demo detection. The demo cookie is set non-httpOnly so the
 * browser can read it. Used to no-op write/trade actions in demo mode.
 */
export function isDemoModeClient(): boolean {
  if (typeof document === "undefined") return false;
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "1" || process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    return true;
  }
  return document.cookie
    .split("; ")
    .some((c) => c.startsWith(`${DEMO_COOKIE}=1`));
}
