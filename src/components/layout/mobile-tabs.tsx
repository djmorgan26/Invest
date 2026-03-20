"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  ArrowLeftRight,
  DollarSign,
  MoreHorizontal,
  Brain,
  Zap,
  ClipboardCheck,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useState } from "react";

const tabs = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/dashboard/markets", label: "Markets", icon: TrendingUp },
  { href: "/dashboard/trades", label: "Trades", icon: ArrowLeftRight },
  { href: "/dashboard/pnl", label: "P&L", icon: DollarSign },
];

const moreItems = [
  { href: "/dashboard/predictions", label: "Predictions", icon: Brain },
  { href: "/dashboard/strategies", label: "Strategies", icon: Zap },
  { href: "/dashboard/reviews", label: "Reviews", icon: ClipboardCheck },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function MobileTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const isMoreActive = moreItems.some((item) => isActive(item.href));

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card md:hidden">
      <nav className="flex items-center justify-around py-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-medium transition-colors",
                active ? "text-success" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              {tab.label}
            </Link>
          );
        })}

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            className={cn(
              "flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-medium transition-colors",
              isMoreActive ? "text-success" : "text-muted-foreground"
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-xl">
            <SheetHeader>
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <button
                    key={item.href}
                    onClick={() => {
                      setOpen(false);
                      router.push(item.href);
                    }}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </div>
  );
}
