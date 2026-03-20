import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-12 w-64" />
      </div>
      {/* Chart */}
      <Skeleton className="h-48 w-full rounded-lg md:h-64" />
      {/* Quick stats */}
      <div className="flex flex-wrap gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-28 rounded-lg" />
        ))}
      </div>
      {/* Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
