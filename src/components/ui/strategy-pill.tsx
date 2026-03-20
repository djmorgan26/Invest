import { cn } from "@/lib/utils";

interface StrategyPillProps {
  name: string | null;
  className?: string;
}

export function StrategyPill({ name, className }: StrategyPillProps) {
  if (!name) return null;
  return (
    <span
      className={cn(
        "rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary",
        className
      )}
    >
      {name}
    </span>
  );
}
