import { Skeleton } from "@/components/ui/skeleton";

export default function TradesLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-1 h-4 w-48" />
      </div>
      <div className="flex flex-wrap gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-32 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-10 w-64 rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
