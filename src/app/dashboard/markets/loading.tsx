import { Skeleton } from "@/components/ui/skeleton";

export default function MarketsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-1 h-4 w-56" />
      </div>
      <Skeleton className="h-10 w-80 rounded-lg" />
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}
