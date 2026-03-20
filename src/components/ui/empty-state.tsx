import { cn } from "@/lib/utils";

interface EmptyStateProps {
  message: string;
  className?: string;
}

export function EmptyState({ message, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg border border-border bg-card px-6 py-12",
        className
      )}
    >
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
