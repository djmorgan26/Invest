"use client";

import { useState } from "react";

export function AlertToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "email_alerts_enabled", value: !enabled }),
      });
      if (res.ok) {
        setEnabled(!enabled);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`
        relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full
        border-2 border-transparent transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
        disabled:cursor-not-allowed disabled:opacity-50
        ${enabled ? "bg-green-600" : "bg-zinc-700"}
      `}
    >
      <span
        className={`
          pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform
          ${enabled ? "translate-x-5" : "translate-x-0.5"}
        `}
      />
    </button>
  );
}
