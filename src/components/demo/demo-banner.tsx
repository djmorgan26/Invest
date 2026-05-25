import Link from "next/link";
import { FlaskConical } from "lucide-react";

/**
 * Persistent banner shown across the dashboard while in demo mode, making it
 * unmistakable that the figures are simulated paper trading, not live.
 */
export function DemoBanner() {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-success/30 bg-success/10 px-4 py-2 text-center text-xs font-medium text-success backdrop-blur">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      <span>
        Demo data — simulated paper trading, not live. No account, no real money.
      </span>
      <Link
        href="/"
        className="ml-1 hidden underline-offset-2 hover:underline sm:inline"
      >
        About this project
      </Link>
    </div>
  );
}
