"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  Brain,
  ArrowLeftRight,
  Settings,
  Zap,
  ClipboardCheck,
  DollarSign,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

const mainNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/markets", label: "Markets", icon: TrendingUp },
  { href: "/dashboard/predictions", label: "Predictions", icon: Brain },
  { href: "/dashboard/trades", label: "Trades", icon: ArrowLeftRight },
  { href: "/dashboard/strategies", label: "Strategies", icon: Zap },
  { href: "/dashboard/pnl", label: "P&L", icon: DollarSign },
  { href: "/dashboard/reviews", label: "Reviews", icon: ClipboardCheck },
];

const bottomNav = [
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-pinned");
    if (saved === "true") setPinned(true);
  }, []);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    localStorage.setItem("sidebar-pinned", String(next));
  };

  const expanded = pinned || hovered;

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-card transition-all duration-200 ease-out md:flex",
        expanded ? "w-60" : "w-16"
      )}
    >
      {/* Brand */}
      <div className="flex h-14 items-center gap-2 px-4">
        <TrendingUp className="h-5 w-5 shrink-0 text-success" />
        <span
          className={cn(
            "whitespace-nowrap text-sm font-semibold tracking-tight transition-opacity duration-200",
            expanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
          )}
        >
          Kalshi Edge
        </span>
      </div>

      <Separator />

      {/* Main nav */}
      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {mainNav.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-success" />
              )}
              <Icon className="h-4 w-4 shrink-0" />
              <span
                className={cn(
                  "whitespace-nowrap transition-opacity duration-200",
                  expanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom nav */}
      <div className="px-2 pb-3">
        <Separator className="mb-3" />
        {bottomNav.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-success" />
              )}
              <Icon className="h-4 w-4 shrink-0" />
              <span
                className={cn(
                  "whitespace-nowrap transition-opacity duration-200",
                  expanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* Pin toggle */}
        {expanded && (
          <button
            onClick={togglePin}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="h-4 w-4 shrink-0 text-center text-[10px]">
              {pinned ? "◀" : "▶"}
            </span>
            <span>{pinned ? "Collapse" : "Pin open"}</span>
          </button>
        )}
      </div>
    </aside>
  );
}
