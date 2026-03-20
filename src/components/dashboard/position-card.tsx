import Link from "next/link";
import { SideBadge } from "@/components/ui/side-badge";
import { CategoryPill } from "@/components/ui/category-pill";
import { PnlValue } from "@/components/ui/pnl-value";
import { formatCurrency } from "@/lib/utils";
import { parseTicker, daysUntilLabel } from "@/lib/ticker-utils";

interface PositionCardProps {
  ticker: string;
  title: string | null;
  side: "yes" | "no";
  entryPrice: number;
  currentPrice: number | null;
  quantity: number;
  unrealizedPnl: number | null;
  category: string | null;
  closeTime: string | null;
  cost: number;
  strategyName: string | null;
}

export function PositionCard({
  ticker,
  title,
  side,
  entryPrice,
  currentPrice,
  quantity,
  unrealizedPnl,
  category,
  closeTime,
  cost,
  strategyName,
}: PositionCardProps) {
  const parsed = parseTicker(ticker);
  const daysLabel = daysUntilLabel(closeTime);

  // Use market title if it looks meaningful (not just the ticker), else parsed summary
  const displayTitle =
    title && title !== ticker && !title.startsWith("KX")
      ? title
      : parsed.summary;

  return (
    <Link
      href={`/dashboard/markets/${ticker}`}
      className="group flex min-w-[280px] max-w-[320px] flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:bg-card-hover"
    >
      {/* Top: category + days left */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CategoryPill category={category} />
          {strategyName && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {strategyName}
            </span>
          )}
        </div>
        {daysLabel && (
          <span className="text-[10px] font-medium text-muted-foreground">
            {daysLabel}
          </span>
        )}
      </div>

      {/* Market question */}
      <div className="mt-2 flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug line-clamp-2">
          {displayTitle}
        </p>
        <SideBadge side={side} />
      </div>

      {/* Key metrics: clean 2-row layout */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Entry</span>
          <span className="font-mono font-medium">
            {(entryPrice * 100).toFixed(0)}&cent;
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Now</span>
          <span className="font-mono font-medium">
            {currentPrice != null
              ? `${(currentPrice * 100).toFixed(0)}\u00a2`
              : "N/A"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Cost</span>
          <span className="font-mono font-medium">
            {formatCurrency(cost)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Qty</span>
          <span className="font-mono font-medium">{quantity}</span>
        </div>
      </div>

      {/* P&L footer */}
      {unrealizedPnl != null && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Unrealized
          </span>
          <PnlValue value={unrealizedPnl} size="sm" format={formatCurrency} />
        </div>
      )}
    </Link>
  );
}
