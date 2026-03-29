"use client";

import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  ScatterChart,
  Scatter,
  ZAxis,
  CartesianGrid,
} from "recharts";
import {
  chartTooltipStyle,
  chartAxisProps,
  chartColors,
  chartGridProps,
} from "@/lib/chart-theme";
import { cn } from "@/lib/utils";

interface Signal {
  source: string;
  signal_type: string;
  category: string;
  title: string;
  implied_probability: number | null;
  data: Record<string, unknown>;
  fetched_at: string;
}

interface ArbitrageChartProps {
  signals: Signal[];
}

// Group signals by similar titles to find cross-market comparisons
function findComparisons(signals: Signal[]): {
  title: string;
  entries: { source: string; probability: number }[];
  maxSpread: number;
}[] {
  // Get signals with implied probability from prediction market sources
  const predictionSignals = signals.filter(
    (s) =>
      s.implied_probability != null &&
      s.implied_probability > 0 &&
      s.implied_probability < 1 &&
      ["polymarket", "predictit", "odds_api"].includes(s.source)
  );

  // Group by similar titles (simple word matching)
  const groups = new Map<string, { source: string; probability: number; title: string }[]>();

  for (const s of predictionSignals) {
    // Normalize title for grouping
    const key = s.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    const shortKey = key.split(" ").slice(0, 5).join(" ");

    if (!groups.has(shortKey)) groups.set(shortKey, []);
    groups.get(shortKey)!.push({
      source: s.source,
      probability: s.implied_probability!,
      title: s.title,
    });
  }

  // Only keep groups with multiple sources (actual cross-market comparisons)
  const comparisons: { title: string; entries: { source: string; probability: number }[]; maxSpread: number }[] = [];

  for (const [, entries] of groups) {
    const sources = new Set(entries.map((e) => e.source));
    if (sources.size < 2) continue;

    // Take one entry per source
    const deduped: { source: string; probability: number }[] = [];
    for (const source of sources) {
      const entry = entries.find((e) => e.source === source);
      if (entry) deduped.push({ source: entry.source, probability: entry.probability });
    }

    const probs = deduped.map((e) => e.probability);
    const spread = Math.max(...probs) - Math.min(...probs);

    comparisons.push({
      title: entries[0].title.length > 50 ? entries[0].title.slice(0, 50) + "…" : entries[0].title,
      entries: deduped,
      maxSpread: spread,
    });
  }

  return comparisons.sort((a, b) => b.maxSpread - a.maxSpread).slice(0, 20);
}

type ViewMode = "scatter" | "bars" | "spreads";

export function ArbitrageChart({ signals }: ArbitrageChartProps) {
  const [view, setView] = useState<ViewMode>("spreads");

  const comparisons = useMemo(() => findComparisons(signals), [signals]);

  // Build scatter data: each prediction market signal as a point
  const scatterData = useMemo(() => {
    return signals
      .filter(
        (s) =>
          s.implied_probability != null &&
          s.implied_probability > 0 &&
          s.implied_probability < 1
      )
      .map((s) => ({
        x: Math.round(s.implied_probability! * 100),
        y: s.source,
        z: 1,
        title: s.title,
        source: s.source,
        category: s.category,
      }));
  }, [signals]);

  // Category distribution for the bar chart
  const categoryData = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {};
    for (const s of signals) {
      if (!counts[s.category]) counts[s.category] = {};
      counts[s.category][s.source] = (counts[s.category][s.source] || 0) + 1;
    }
    return Object.entries(counts).map(([category, sources]) => ({
      category,
      total: Object.values(sources).reduce((a, b) => a + b, 0),
      ...sources,
    }));
  }, [signals]);

  // Spread data for the divergence chart
  const spreadData = useMemo(() => {
    if (comparisons.length === 0) {
      // Fallback: show probability distribution across sources
      const sourceProbs: Record<string, number[]> = {};
      for (const s of signals) {
        if (s.implied_probability != null && s.implied_probability > 0 && s.implied_probability < 1) {
          if (!sourceProbs[s.source]) sourceProbs[s.source] = [];
          sourceProbs[s.source].push(s.implied_probability);
        }
      }
      return Object.entries(sourceProbs).map(([source, probs]) => ({
        source,
        avg: Math.round((probs.reduce((a, b) => a + b, 0) / probs.length) * 100),
        count: probs.length,
        min: Math.round(Math.min(...probs) * 100),
        max: Math.round(Math.max(...probs) * 100),
      }));
    }
    return [];
  }, [comparisons, signals]);

  return (
    <div>
      {/* View toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="inline-flex rounded-lg bg-secondary/50 p-1 gap-1">
          {(["spreads", "bars", "scatter"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              {v === "spreads" ? "Divergences" : v === "bars" ? "By Category" : "Scatter"}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 md:h-80 w-full">
        {view === "spreads" && (
          <>
            {comparisons.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={comparisons.map((c) => ({
                    name: c.title.length > 30 ? c.title.slice(0, 30) + "…" : c.title,
                    spread: Math.round(c.maxSpread * 100),
                    fullTitle: c.title,
                    sources: c.entries.map((e) => `${e.source}: ${(e.probability * 100).toFixed(0)}%`).join(" | "),
                  }))}
                  layout="vertical"
                  margin={{ left: 10, right: 20, top: 5, bottom: 5 }}
                >
                  <CartesianGrid {...chartGridProps} horizontal={false} />
                  <XAxis
                    type="number"
                    {...chartAxisProps}
                    tickFormatter={(v: number) => `${v}¢`}
                    domain={[0, "auto"]}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    {...chartAxisProps}
                    width={180}
                    tick={{ fontSize: 10, fill: chartColors.axisText }}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={{ color: chartColors.tooltipLabel }}
                    formatter={(value: number, _: string, payload: { payload: { sources: string } }) => [
                      `${value}¢ spread — ${payload.payload.sources}`,
                      "Divergence",
                    ]}
                  />
                  <ReferenceLine x={5} stroke={chartColors.warning} strokeDasharray="3 3" />
                  <Bar dataKey="spread" radius={[0, 4, 4, 0]}>
                    {comparisons.map((c, i) => (
                      <Cell
                        key={i}
                        fill={c.maxSpread >= 0.05 ? chartColors.success : chartColors.pending}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : spreadData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spreadData}>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis dataKey="source" {...chartAxisProps} />
                  <YAxis {...chartAxisProps} tickFormatter={(v: number) => `${v}`} />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={{ color: chartColors.tooltipLabel }}
                    formatter={(value: number) => [`${value} signals`, "Count"]}
                  />
                  <Bar dataKey="count" fill={chartColors.success} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-border bg-card">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    No cross-market divergences detected yet.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Run the fetch script to populate signals, then divergences will appear.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {view === "bars" && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categoryData}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="category" {...chartAxisProps} />
              <YAxis {...chartAxisProps} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelStyle={{ color: chartColors.tooltipLabel }}
              />
              <Bar dataKey="total" fill={chartColors.success} radius={[4, 4, 0, 0]}>
                {categoryData.map((entry, i) => {
                  const colors = [
                    "#8b5cf6", "#3b82f6", "#ef4444", "#f97316",
                    "#06b6d4", "#84cc16", "#0ea5e9", "#14b8a6",
                  ];
                  return <Cell key={i} fill={colors[i % colors.length]} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {view === "scatter" && (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 80 }}>
              <CartesianGrid {...chartGridProps} />
              <XAxis
                type="number"
                dataKey="x"
                {...chartAxisProps}
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                name="Implied Prob"
              />
              <YAxis
                type="category"
                dataKey="y"
                {...chartAxisProps}
                allowDuplicatedCategory={false}
                name="Source"
              />
              <ZAxis dataKey="z" range={[40, 120]} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelStyle={{ color: chartColors.tooltipLabel }}
                formatter={(value: unknown, name: string) => {
                  if (name === "Implied Prob") return [`${value}%`, name];
                  return [value, name];
                }}
              />
              <Scatter data={scatterData} fill={chartColors.success}>
                {scatterData.map((entry, i) => {
                  const sourceColors: Record<string, string> = {
                    polymarket: "#8b5cf6",
                    predictit: "#3b82f6",
                    odds_api: "#f97316",
                    espn: "#ef4444",
                    coingecko: "#84cc16",
                    fred: "#06b6d4",
                    open_meteo: "#0ea5e9",
                    nws: "#14b8a6",
                  };
                  return <Cell key={i} fill={sourceColors[entry.source] ?? "#71717a"} />;
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
