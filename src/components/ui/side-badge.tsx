import { cn } from "@/lib/utils";

interface SideBadgeProps {
  side: "yes" | "no";
  className?: string;
}

export function SideBadge({ side, className }: SideBadgeProps) {
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-xs font-medium",
        side === "yes"
          ? "bg-success/15 text-success"
          : "bg-destructive/15 text-destructive",
        className
      )}
    >
      {side.toUpperCase()}
    </span>
  );
}
