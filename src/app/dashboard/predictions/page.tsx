import { createServerClient } from "@/lib/supabase/server";
import { PredictionCard } from "@/components/predictions/prediction-card";

export const dynamic = "force-dynamic";

export default async function PredictionsPage() {
  const supabase = createServerClient();

  const { data: predictions } = await supabase
    .from("predictions")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Predictions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          AI-generated market predictions and analysis
        </p>
      </div>

      {!predictions || predictions.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            No predictions yet. Run the prediction pipeline to generate market
            analysis.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {predictions.map((prediction) => (
            <PredictionCard key={prediction.id} prediction={prediction} />
          ))}
        </div>
      )}
    </div>
  );
}
