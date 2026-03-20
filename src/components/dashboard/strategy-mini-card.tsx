import { StatusDot } from "@/components/ui/status-dot";
import { PnlValue } from "@/components/ui/pnl-value";
import { formatCurrency, formatPercent } from "@/lib/utils";

interface StrategyMiniCardProps {
  name: string;
  enabled: boolean;
  trades: number;
  winRate: number | null;
  pnl: number;
}

export function StrategyMiniCard({
  name,
  enabled,
  trades,
  winRate,
  pnl,
}: StrategyMiniCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-card-hover">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{name}</h3>
        <StatusDot active={enabled} />
      </div>

      <div className="mt-3 flex items-end justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {trades} trades
          </p>
          {winRate !== null && (
            <p className="font-mono text-xs text-muted-foreground">
              {formatPercent(winRate)} win
            </p>
          )}
        </div>
        {trades > 0 && (
          <PnlValue value={pnl} size="sm" format={formatCurrency} />
        )}
      </div>
    </div>
  );
}
