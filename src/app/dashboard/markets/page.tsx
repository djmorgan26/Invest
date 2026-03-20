import { createServerClient } from "@/lib/supabase/server";
import { MarketTable } from "@/components/markets/market-table";

export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  const supabase = createServerClient();

  const { data: markets } = await supabase
    .from("markets")
    .select("*")
    .order("volume", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse and search all tracked Kalshi markets
        </p>
      </div>

      <MarketTable markets={markets ?? []} />
    </div>
  );
}
