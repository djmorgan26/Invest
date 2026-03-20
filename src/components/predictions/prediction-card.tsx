import type { Prediction } from "@/lib/supabase/types";
import { formatPercent, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface PredictionCardProps {
  prediction: Prediction;
}

const statusStyles: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  correct: "bg-success/15 text-success",
  incorrect: "bg-destructive/15 text-destructive",
  expired: "bg-secondary text-muted-foreground",
};

export function PredictionCard({ prediction }: PredictionCardProps) {
  const edgePositive = prediction.edge > 0;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium">
              {prediction.ticker}
            </span>
            <span
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium",
                prediction.side === "yes"
                  ? "bg-success/15 text-success"
                  : "bg-destructive/15 text-destructive"
              )}
            >
              {prediction.side.toUpperCase()}
            </span>
            <span
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium",
                statusStyles[prediction.status] ?? statusStyles.expired
              )}
            >
              {prediction.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(prediction.created_at)}
          </p>
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Confidence</p>
          <p className="font-mono text-sm font-medium">
            {formatPercent(prediction.confidence)}
          </p>
          {/* Confidence bar */}
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${prediction.confidence * 100}%` }}
            />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Fair Value</p>
          <p className="font-mono text-sm font-medium">
            {(prediction.fair_value * 100).toFixed(0)}&cent;
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Edge</p>
          <p
            className={cn(
              "font-mono text-sm font-medium",
              edgePositive
                ? "text-success"
                : "text-destructive"
            )}
          >
            {edgePositive ? "+" : ""}
            {(prediction.edge * 100).toFixed(1)}&cent;
          </p>
        </div>
      </div>

      {/* Reasoning */}
      {prediction.reasoning && (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {prediction.reasoning}
        </p>
      )}
    </div>
  );
}
