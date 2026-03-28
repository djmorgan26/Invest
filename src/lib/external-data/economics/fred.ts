import type { DataConnector, ExternalSignal, FredObservation } from "../types";

const FRED_BASE = "https://api.stlouisfed.org/fred";

// Key economic series that map to Kalshi markets
const FRED_SERIES = [
  { id: "CPIAUCSL", title: "CPI (All Urban Consumers)", category: "inflation" },
  { id: "CPILFESL", title: "Core CPI (Less Food and Energy)", category: "inflation" },
  { id: "UNRATE", title: "Unemployment Rate", category: "employment" },
  { id: "PAYEMS", title: "Nonfarm Payrolls", category: "employment" },
  { id: "GDP", title: "GDP (Quarterly)", category: "gdp" },
  { id: "GDPC1", title: "Real GDP", category: "gdp" },
  { id: "FEDFUNDS", title: "Federal Funds Rate", category: "interest_rates" },
  { id: "DFF", title: "Effective Federal Funds Rate (Daily)", category: "interest_rates" },
  { id: "T10Y2Y", title: "10Y-2Y Treasury Spread", category: "interest_rates" },
  { id: "MORTGAGE30US", title: "30-Year Mortgage Rate", category: "housing" },
  { id: "HOUST", title: "Housing Starts", category: "housing" },
  { id: "RSXFS", title: "Retail Sales (ex Food Services)", category: "consumer" },
  { id: "UMCSENT", title: "Consumer Sentiment (U of Michigan)", category: "consumer" },
  { id: "DCOILWTICO", title: "WTI Crude Oil Price", category: "commodities" },
  { id: "GASREGW", title: "Regular Gas Price (Weekly)", category: "commodities" },
];

export const fred: DataConnector = {
  source: "fred",

  async fetchSignals(): Promise<ExternalSignal[]> {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) {
      console.warn("[FRED] FRED_API_KEY not set, skipping");
      return [];
    }

    const signals: ExternalSignal[] = [];
    const now = new Date().toISOString();

    // Fetch latest observations for each series
    const fetches = FRED_SERIES.map(async (series) => {
      try {
        const url = `${FRED_BASE}/series/observations?series_id=${series.id}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=12`;
        const res = await fetch(url);
        if (!res.ok) return;

        const data: { observations: FredObservation[] } = await res.json();
        const observations = data.observations.filter((o) => o.value !== ".");

        if (observations.length === 0) return;

        const latest = observations[0];
        const latestValue = parseFloat(latest.value);

        // Calculate change from prior reading
        const prior = observations.length > 1 ? parseFloat(observations[1].value) : null;
        const change = prior != null ? latestValue - prior : null;
        const changePct = prior != null && prior !== 0 ? ((latestValue - prior) / prior) * 100 : null;

        // Build historical values for trend analysis
        const history = observations.slice(0, 12).map((o) => ({
          date: o.date,
          value: parseFloat(o.value),
        }));

        signals.push({
          source: "fred",
          signal_type: "economic_indicator",
          external_id: series.id,
          category: "economics",
          title: `${series.title}: ${latestValue}`,
          data: {
            series_id: series.id,
            series_title: series.title,
            sub_category: series.category,
            latest_value: latestValue,
            latest_date: latest.date,
            prior_value: prior,
            change,
            change_pct: changePct != null ? Math.round(changePct * 100) / 100 : null,
            history,
          },
          fetched_at: now,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour (econ data doesn't change fast)
        });
      } catch (err) {
        console.error(`[FRED] Error fetching ${series.id}:`, err);
      }
    });

    await Promise.all(fetches);
    console.log(`[FRED] Fetched ${signals.length} signals`);
    return signals;
  },
};
