import { createServerClient } from "@/lib/supabase/server";

interface Review {
  id: string;
  review_type: string;
  summary: string;
  recommendations: { action: string; priority: string; reasoning: string }[] | null;
  metrics: Record<string, unknown> | null;
  created_at: string;
}

export default async function ReviewsPage() {
  const supabase = createServerClient();

  const { data: reviews } = await supabase
    .from("reviews")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: learnings } = await supabase
    .from("strategy_learnings")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  const typedReviews = (reviews ?? []) as Review[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reviews & Learnings</h1>
        <p className="text-muted-foreground mt-1">
          AI-generated performance reviews and persistent strategy insights
        </p>
      </div>

      {/* Latest Review */}
      {typedReviews.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Latest Review</h2>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium">
                {typedReviews[0].review_type}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(typedReviews[0].created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {typedReviews[0].summary}
          </p>

          {typedReviews[0].recommendations && typedReviews[0].recommendations.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2">Recommendations</h3>
              <div className="space-y-2">
                {typedReviews[0].recommendations.map((rec, i) => (
                  <div key={i} className="rounded-lg border border-border bg-background p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                        rec.priority === "high" ? "bg-red-500/10 text-red-500" :
                        rec.priority === "medium" ? "bg-yellow-500/10 text-yellow-500" :
                        "bg-green-500/10 text-green-500"
                      }`}>
                        {rec.priority}
                      </span>
                      <span className="text-sm font-medium">{rec.action}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{rec.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {typedReviews[0].metrics && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(typedReviews[0].metrics).map(([key, value]) => (
                <div key={key} className="rounded-lg border border-border bg-background p-3">
                  <div className="text-xs text-muted-foreground">{key.replace(/_/g, " ")}</div>
                  <div className="text-sm font-semibold mt-0.5">{String(value)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Review History */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Review History</h2>
        {typedReviews.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
            <p>No reviews yet. Run <code className="text-xs bg-accent px-1.5 py-0.5 rounded">/project:review</code> to generate the first review.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {typedReviews.slice(1).map((review) => (
              <div key={review.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium">
                    {review.review_type}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(review.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {review.summary}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Strategy Learnings */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Recent Learnings</h2>
        {(!learnings || learnings.length === 0) ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
            <p>No learnings recorded yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {learnings.map((learning) => (
              <div key={learning.id} className="rounded-lg border border-border bg-card p-3 flex items-start gap-3">
                <span className={`shrink-0 mt-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                  learning.learning_type === "param_change" ? "bg-blue-500/10 text-blue-500" :
                  learning.learning_type === "category_insight" ? "bg-purple-500/10 text-purple-500" :
                  learning.learning_type === "regime_change" ? "bg-orange-500/10 text-orange-500" :
                  learning.learning_type === "strategy_idea" ? "bg-green-500/10 text-green-500" :
                  learning.learning_type === "market_pattern" ? "bg-cyan-500/10 text-cyan-500" :
                  learning.learning_type === "failure_analysis" ? "bg-red-500/10 text-red-500" :
                  "bg-accent text-accent-foreground"
                }`}>
                  {learning.learning_type}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{learning.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {learning.strategy_id}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(learning.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
