import { cn } from "@/lib/utils";

interface CategoryPillProps {
  category: string | null;
  className?: string;
}

export function CategoryPill({ category, className }: CategoryPillProps) {
  if (!category) return null;
  return (
    <span
      className={cn(
        "rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground",
        className
      )}
    >
      {category}
    </span>
  );
}
