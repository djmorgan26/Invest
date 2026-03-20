import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  change?: {
    value: string;
    positive: boolean;
  };
  className?: string;
}

export function StatCard({ title, value, change, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-6",
        className
      )}
    >
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-2 text-2xl font-semibold font-mono tracking-tight">
        {value}
      </p>
      {change && (
        <p
          className={cn(
            "mt-1 text-sm font-mono",
            change.positive
              ? "text-[color:var(--success)]"
              : "text-destructive"
          )}
        >
          {change.positive ? "+" : ""}
          {change.value}
        </p>
      )}
    </div>
  );
}
