import { createServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

interface Review {
  id: string;
  review_type: string;
  summary: string;
  recommendations:
    | { action: string; priority: string; reasoning: string }[]
    | null;
  metrics: Record<string, unknown> | null;
  created_at: string;
}

export default async function ReviewsPage() {
  const supabase = await createServerClient();

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
        <h1 className="text-2xl font-semibold tracking-tight">
          Reviews & Learnings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          AI-generated performance reviews and persistent strategy insights
        </p>
      </div>

      {/* Latest Review */}
      {typedReviews.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Latest Review</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{typedReviews[0].review_type}</Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(typedReviews[0].created_at).toLocaleDateString()}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {typedReviews[0].summary}
            </p>

            {typedReviews[0].recommendations &&
              typedReviews[0].recommendations.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">
                    Recommendations
                  </h3>
                  <div className="space-y-2">
                    {typedReviews[0].recommendations.map((rec, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-border bg-background p-3"
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <PriorityBadge priority={rec.priority} />
                          <span className="text-sm font-medium">
                            {rec.action}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {rec.reasoning}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {typedReviews[0].metrics && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(typedReviews[0].metrics).map(
                  ([key, value]) => (
                    <div
                      key={key}
                      className="rounded-lg bg-secondary/50 p-3"
                    >
                      <div className="text-xs text-muted-foreground">
                        {key.replace(/_/g, " ")}
                      </div>
                      <div className="mt-0.5 text-sm font-semibold">
                        {String(value)}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Review History */}
      <section>
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">
          Review History
        </h2>
        {typedReviews.length === 0 ? (
          <EmptyState message='No reviews yet. Run /project:review to generate the first review.' />
        ) : (
          <div className="space-y-3">
            {typedReviews.slice(1).map((review) => (
              <Card key={review.id}>
                <CardContent className="pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <Badge variant="secondary">{review.review_type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(review.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="line-clamp-3 text-sm text-muted-foreground">
                    {review.summary}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Strategy Learnings */}
      <section>
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">
          Recent Learnings
        </h2>
        {!learnings || learnings.length === 0 ? (
          <EmptyState message="No learnings recorded yet." />
        ) : (
          <div className="space-y-2">
            {learnings.map((learning) => (
              <div
                key={learning.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
              >
                <LearningBadge type={learning.learning_type} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{learning.description}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
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
      </section>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const variant =
    priority === "high"
      ? "destructive"
      : priority === "medium"
        ? "secondary"
        : "outline";
  return (
    <Badge variant={variant as "destructive" | "secondary" | "outline"}>
      {priority}
    </Badge>
  );
}

function LearningBadge({ type }: { type: string }) {
  const colorMap: Record<string, string> = {
    param_change: "bg-chart-4/15 text-chart-4",
    category_insight: "bg-purple-500/10 text-purple-400",
    regime_change: "bg-warning/15 text-warning",
    strategy_idea: "bg-success/15 text-success",
    market_pattern: "bg-cyan-500/10 text-cyan-400",
    failure_analysis: "bg-destructive/15 text-destructive",
  };

  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        colorMap[type] ?? "bg-secondary text-muted-foreground"
      }`}
    >
      {type}
    </span>
  );
}
