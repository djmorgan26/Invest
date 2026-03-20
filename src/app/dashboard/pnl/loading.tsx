import { Skeleton } from "@/components/ui/skeleton";

export default function PnlLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>
      {/* Hero P&L */}
      <Skeleton className="h-16 w-48" />
      {/* Progress bar */}
      <Skeleton className="h-32 w-full rounded-lg" />
      {/* Tabs */}
      <Skeleton className="h-10 w-80 rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
