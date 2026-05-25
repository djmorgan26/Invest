"use client";

import { useState } from "react";
import { isDemoModeClient } from "@/lib/demo/client";

export function SyncButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  async function handleSync() {
    // Demo mode is read-only: simulate a successful sync without calling the API.
    if (isDemoModeClient()) {
      setResult({
        success: true,
        message: "Demo mode — sync is simulated. No live data was fetched.",
      });
      return;
    }
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/markets/sync-manual", { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        setResult({ success: true, message: data.message ?? "Sync completed successfully." });
      } else {
        setResult({
          success: false,
          message: data.error ?? "Sync failed. Check server logs.",
        });
      }
    } catch (err) {
      setResult({
        success: false,
        message: "Network error. Could not reach the sync endpoint.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleSync}
        disabled={loading}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Syncing..." : "Sync Markets"}
      </button>

      {result && (
        <p
          className={`text-sm ${
            result.success
              ? "text-[color:var(--success)]"
              : "text-destructive"
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
