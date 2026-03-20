import { cn } from "@/lib/utils";

interface StatusDotProps {
  active: boolean;
  label?: string;
  className?: string;
}

export function StatusDot({ active, label, className }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={cn(
          "relative inline-block h-2 w-2 rounded-full",
          active ? "bg-success" : "bg-muted-foreground/50"
        )}
      >
        {active && (
          <span className="absolute inset-0 animate-ping rounded-full bg-success/50" />
        )}
      </span>
      {label && (
        <span
          className={cn(
            "text-xs font-medium",
            active ? "text-success" : "text-muted-foreground"
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
