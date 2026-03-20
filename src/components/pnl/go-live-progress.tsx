import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface GoLiveMetric {
  label: string;
  value: string;
  threshold: string;
  met: boolean;
}

interface GoLiveProgressProps {
  metrics: GoLiveMetric[];
  metCount: number;
}

export function GoLiveProgress({ metrics, metCount }: GoLiveProgressProps) {
  const total = metrics.length;
  const pct = total > 0 ? Math.round((metCount / total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Go-Live Readiness</span>
          <span className="rounded-full bg-secondary px-3 py-1 text-sm font-mono font-medium">
            {metCount}/{total} met
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-success transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-right">{pct}% complete</p>
        </div>

        {/* Checklist */}
        <ul className="space-y-2">
          {metrics.map((m) => (
            <li key={m.label} className="flex items-center gap-3 text-sm">
              {m.met ? (
                <CheckCircle2 className="size-4 shrink-0 text-success" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className={m.met ? "text-foreground" : "text-muted-foreground"}>
                {m.label}
              </span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {m.value}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                / {m.threshold}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
