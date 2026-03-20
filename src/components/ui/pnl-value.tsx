import { cn } from "@/lib/utils";

interface PnlValueProps {
  value: number;
  size?: "sm" | "md" | "lg" | "xl";
  showSign?: boolean;
  className?: string;
  format?: (v: number) => string;
}

const sizeClasses = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-2xl",
  xl: "text-5xl",
};

export function PnlValue({
  value,
  size = "md",
  showSign = true,
  className,
  format,
}: PnlValueProps) {
  const formatted = format
    ? format(value)
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value);

  const sign = showSign && value > 0 ? "+" : "";

  return (
    <span
      className={cn(
        "font-mono font-medium",
        sizeClasses[size],
        value > 0 && "text-success",
        value < 0 && "text-destructive",
        value === 0 && "text-muted-foreground",
        className
      )}
    >
      {sign}
      {formatted}
    </span>
  );
}
