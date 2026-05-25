// Demo-mode constants safe to import from both client and server bundles.
// (Keep this file free of "next/headers" and other server-only imports.)

export const DEMO_COOKIE = "kalshi_demo";

export function demoForcedByEnv(): boolean {
  return (
    process.env.DEMO_MODE === "1" ||
    process.env.DEMO_MODE === "true" ||
    process.env.NEXT_PUBLIC_DEMO_MODE === "1" ||
    process.env.NEXT_PUBLIC_DEMO_MODE === "true"
  );
}
