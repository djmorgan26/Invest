import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { sendOpportunityAlert } from "@/lib/notifications";

export const maxDuration = 60;

/**
 * Cron-triggered opportunity checker.
 * Compares latest external signals against Kalshi prices to find stale markets.
 * Sends email alerts when divergences exceed threshold.
 *
 * Checks: cross-market prediction, crypto, weather, sports, economics/financials.
 * Runs every 5 minutes via cron as a complement to the live monitor.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const now = new Date().toISOString();
  const alerts: { ticker: string; edge: number; side: string; category: string }[] = [];

  // --- Check if email alerts are enabled (UI toggle) ---
  const { data: alertSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "email_alerts_enabled")
    .single();

  const emailsEnabled = alertSetting?.value === true;

  // --- Dedup: load recent alerts to avoid spamming the same ticker ---
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: recentAlerts } = await supabase
    .from("alert_history")
    .select("ticker")
    .gt("sent_at", sixHoursAgo);

  const recentSet = new Set((recentAlerts ?? []).map((a) => a.ticker));

  // Daily budget guard (Resend free tier = 100/day)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount } = await supabase
    .from("alert_history")
    .select("*", { count: "exact", head: true })
    .gt("sent_at", oneDayAgo);

  const dailyBudget = 80;
  let sentToday = dailyCount ?? 0;
  let emailsSkipped = 0;

  async function trySendAlert(params: Parameters<typeof sendOpportunityAlert>[0]): Promise<boolean> {
    // Always record to alert_history for tracking, even if emails are off
    alerts.push({ ticker: params.ticker, edge: params.edge_cents, side: params.side, category: params.category });
    await supabase.from("alert_history").insert({
      ticker: params.ticker,
      category: params.category,
      edge_cents: params.edge_cents,
      side: params.side,
    });

    // Skip sending email if disabled or dedup/budget hit
    if (!emailsEnabled) {
      emailsSkipped++;
      return false;
    }
    if (recentSet.has(params.ticker)) {
      console.log(`[Alert] Skipping ${params.ticker} — already alerted in last 6h`);
      return false;
    }
    if (sentToday >= dailyBudget) {
      console.log(`[Alert] Daily budget exhausted (${sentToday}/${dailyBudget})`);
      return false;
    }

    const sent = await sendOpportunityAlert(params);
    if (sent) {
      recentSet.add(params.ticker);
      sentToday++;
    }
    return sent;
  }

  // =========================================================================
  // 1. Cross-market prediction divergences (Polymarket/PredictIt vs Kalshi)
  // =========================================================================
  const { data: mappings } = await supabase
    .from("external_market_mappings")
    .select("*");

  if (mappings && mappings.length > 0) {
    for (const mapping of mappings) {
      const { data: market } = await supabase
        .from("markets")
        .select("ticker, title, last_price, yes_bid, yes_ask, updated_at")
        .eq("ticker", mapping.kalshi_ticker)
        .in("status", ["open", "active"])
        .single();

      if (!market?.last_price) continue;

      const { data: signals } = await supabase
        .from("external_signals")
        .select("implied_probability, source, title, data, fetched_at")
        .eq("source", mapping.source)
        .eq("external_id", mapping.external_id)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("fetched_at", { ascending: false })
        .limit(1);

      const signal = signals?.[0];
      if (!signal?.implied_probability) continue;

      const kalshiCents = market.last_price;
      const externalCents = Math.round(signal.implied_probability * 100);
      const divergence = Math.abs(kalshiCents - externalCents);

      if (divergence >= 8) {
        const side = externalCents > kalshiCents ? "yes" : "no";

        await trySendAlert({
          ticker: market.ticker,
          market_title: market.title,
          category: "cross-market",
          trigger_source: mapping.source,
          trigger_event: `${mapping.source} price: ${externalCents}¢ vs Kalshi: ${kalshiCents}¢`,
          trigger_detail: `Cross-market divergence of ${divergence}¢ detected on mapped market`,
          kalshi_price: kalshiCents,
          estimated_fair_value: externalCents,
          edge_cents: divergence,
          side,
          confidence: Math.min(divergence / 20, 0.9),
          staleness_seconds: Math.round((Date.now() - new Date(market.updated_at).getTime()) / 1000),
          window_seconds: 300,
        });
      }
    }
  }

  // =========================================================================
  // 2. Crypto price divergences (CoinGecko vs Kalshi crypto markets)
  // =========================================================================
  const { data: cryptoSignals } = await supabase
    .from("external_signals")
    .select("*")
    .eq("source", "coingecko")
    .eq("signal_type", "price")
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("fetched_at", { ascending: false })
    .limit(10);

  if (cryptoSignals) {
    for (const signal of cryptoSignals) {
      const data = signal.data as { symbol?: string; price_usd?: number; change_24h_pct?: number; change_1h_pct?: number };
      const coinSymbol = data.symbol?.toUpperCase();
      if (!coinSymbol) continue;

      const change24h = data.change_24h_pct ?? 0;
      const change1h = data.change_1h_pct ?? 0;

      // Trigger on 1.5% 24h move OR 2% 1h move (lowered from 3% 24h only)
      if (Math.abs(change24h) < 1.5 && Math.abs(change1h) < 2) continue;

      // Find Kalshi markets — filter out settled/expired
      const { data: markets } = await supabase
        .from("markets")
        .select("ticker, title, last_price, updated_at")
        .in("status", ["open", "active"])
        .gt("last_price", 0)
        .gt("close_time", now)
        .ilike("title", `%${coinSymbol}%`)
        .limit(20);

      if (!markets) continue;

      for (const market of markets) {
        const updatedAgo = Date.now() - new Date(market.updated_at).getTime();
        if (updatedAgo < 5 * 60 * 1000) continue;

        const title = market.title.toLowerCase();
        const isAbove = title.includes("above") || title.includes("over");
        const isBelow = title.includes("below") || title.includes("under");
        if (!isAbove && !isBelow) continue;

        // Use the larger of the two move signals
        const movePct = Math.abs(change1h) >= 2 ? change1h : change24h;
        const direction = movePct > 0 ? "up" : "down";
        const side = (isAbove && direction === "up") || (isBelow && direction === "down") ? "yes" : "no";
        const edgeEstimate = Math.round(Math.min(Math.abs(movePct) * 3, 20));

        if (edgeEstimate < 5) continue;

        const moveLabel = Math.abs(change1h) >= 2
          ? `${change1h.toFixed(1)}% in 1h`
          : `${change24h.toFixed(1)}% in 24h`;

        await trySendAlert({
          ticker: market.ticker,
          market_title: market.title,
          category: "crypto",
          trigger_source: "coingecko",
          trigger_event: `${coinSymbol} ${direction} ${moveLabel} ($${data.price_usd?.toLocaleString()})`,
          trigger_detail: `${coinSymbol} moved ${moveLabel} but this market hasn't updated in ${Math.round(updatedAgo / 60000)}min`,
          kalshi_price: market.last_price!,
          estimated_fair_value: side === "yes"
            ? Math.min(market.last_price! + edgeEstimate, 95)
            : Math.max(market.last_price! - edgeEstimate, 5),
          edge_cents: edgeEstimate,
          side,
          confidence: Math.min(Math.abs(movePct) / 10, 0.8),
          staleness_seconds: Math.round(updatedAgo / 1000),
          window_seconds: 300,
        });
      }
    }
  }

  // =========================================================================
  // 3. Weather divergences (NWS/Open-Meteo forecasts vs Kalshi weather markets)
  // =========================================================================
  const cityMap: Record<string, string[]> = {
    "new york": ["NYC", "KXHIGHTNYC", "KXHIGHNYC", "KXTEMPNYC"],
    "los angeles": ["LAX", "KXHIGHTLAX", "KXHIGHLAX"],
    "chicago": ["CHI", "KXHIGHTCHI", "KXHIGHCHI"],
    "houston": ["HOU", "KXHIGHTHOU", "KXHIGHHOU"],
    "phoenix": ["PHX", "KXHIGHTPHX", "KXHIGHPHX"],
    "miami": ["MIA", "KXHIGHTMIA", "KXHIGHMIA"],
    "dallas": ["DAL", "KXHIGHTDAL", "KXHIGHDAL"],
    "denver": ["DEN", "KXHIGHTDEN", "KXHIGHDEN"],
    "washington": ["DCA", "KXHIGHTDCA", "KXHIGHDCA"],
    "atlanta": ["ATL", "KXHIGHTATL", "KXHIGHATL"],
    "austin": ["AUS", "KXHIGHTAUS", "KXHIGHAUS"],
    "boston": ["BOS", "KXHIGHTBOS", "KXHIGHBOS"],
  };

  // Get weather forecasts
  const { data: weatherSignals } = await supabase
    .from("external_signals")
    .select("*")
    .in("source", ["nws", "open_meteo"])
    .eq("signal_type", "forecast")
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("fetched_at", { ascending: false })
    .limit(100);

  // Get active weather markets via event category
  const { data: weatherEvents } = await supabase
    .from("events")
    .select("event_ticker")
    .eq("category", "Climate and Weather");

  if (weatherSignals?.length && weatherEvents?.length) {
    const weatherEventTickers = weatherEvents.map((e) => e.event_ticker);

    const { data: weatherMarkets } = await supabase
      .from("markets")
      .select("ticker, title, last_price, event_ticker, close_time, updated_at")
      .in("status", ["open", "active"])
      .gt("last_price", 0)
      .gt("close_time", now)
      .in("event_ticker", weatherEventTickers.slice(0, 100))
      .limit(200);

    if (weatherMarkets) {
      // Build forecast lookup: city → { temp_high, temp_low, date }
      const forecasts = new Map<string, { temp_high?: number; temp_low?: number; date?: string }[]>();

      for (const signal of weatherSignals) {
        const d = signal.data as {
          city?: string;
          temp_high_f?: number;
          temp_low_f?: number;
          temperature?: number;
          date?: string;
          start_time?: string;
          is_daytime?: boolean;
        };
        const city = d.city?.toLowerCase();
        if (!city) continue;

        const entry = {
          temp_high: d.temp_high_f ?? (d.is_daytime ? d.temperature : undefined),
          temp_low: d.temp_low_f ?? (!d.is_daytime ? d.temperature : undefined),
          date: d.date ?? d.start_time?.substring(0, 10),
        };

        if (!forecasts.has(city)) forecasts.set(city, []);
        forecasts.get(city)!.push(entry);
      }

      for (const market of weatherMarkets) {
        const title = market.title;
        const tickerUpper = market.ticker.toUpperCase();

        // Identify city from ticker prefix
        let matchedCity: string | undefined;
        for (const [city, prefixes] of Object.entries(cityMap)) {
          if (prefixes.some((p) => tickerUpper.includes(p))) {
            matchedCity = city;
            break;
          }
        }
        if (!matchedCity) continue;

        const cityForecasts = forecasts.get(matchedCity);
        if (!cityForecasts?.length) continue;

        // Parse threshold from title: "maximum temperature be <58°" or "64-65°" or ">72°"
        const thresholdMatch = title.match(/(?:<|>|≥|≤)\s*(\d+(?:\.\d+)?)\s*°/);
        const rangeMatch = title.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*°/);

        // Get the best forecast temp for this market
        const bestForecast = cityForecasts.find((f) => f.temp_high != null);
        const forecastTemp = bestForecast?.temp_high;
        if (forecastTemp == null) continue;

        let fairValue: number | undefined;

        if (thresholdMatch) {
          const threshold = parseFloat(thresholdMatch[1]);
          const isBelow = title.includes("<") || title.toLowerCase().includes("below");

          // How far is forecast from threshold?
          const diff = forecastTemp - threshold;
          if (isBelow) {
            // Market: "will temp be <X?" → higher forecast = less likely
            fairValue = diff < -5 ? 90 : diff < -2 ? 75 : diff < 0 ? 55 : diff < 2 ? 35 : diff < 5 ? 15 : 5;
          } else {
            // Market: "will temp be >X?" → higher forecast = more likely
            fairValue = diff > 5 ? 90 : diff > 2 ? 75 : diff > 0 ? 55 : diff > -2 ? 35 : diff > -5 ? 15 : 5;
          }
        } else if (rangeMatch) {
          const low = parseFloat(rangeMatch[1]);
          const high = parseFloat(rangeMatch[2]);
          const mid = (low + high) / 2;
          const diff = Math.abs(forecastTemp - mid);
          const rangeWidth = high - low;

          // Closer to range center = higher probability
          if (diff <= rangeWidth / 2) {
            fairValue = 60;
          } else if (diff <= rangeWidth) {
            fairValue = 35;
          } else if (diff <= rangeWidth * 2) {
            fairValue = 15;
          } else {
            fairValue = 5;
          }
        }

        if (fairValue == null) continue;

        const edge = Math.abs(fairValue - market.last_price!);
        if (edge < 10) continue;

        const side = fairValue > market.last_price! ? "yes" : "no";

        await trySendAlert({
          ticker: market.ticker,
          market_title: market.title,
          category: "weather",
          trigger_source: "nws/open-meteo",
          trigger_event: `${matchedCity} forecast: ${forecastTemp}°F`,
          trigger_detail: `Forecast ${forecastTemp}°F vs market priced at ${market.last_price}¢ (fair value est: ${fairValue}¢)`,
          kalshi_price: market.last_price!,
          estimated_fair_value: fairValue,
          edge_cents: edge,
          side,
          confidence: Math.min(edge / 25, 0.85),
          staleness_seconds: Math.round((Date.now() - new Date(market.updated_at).getTime()) / 1000),
          window_seconds: 600,
        });
      }
    }
  }

  // =========================================================================
  // 4. Sports odds divergences (Odds API / ESPN vs Kalshi sports markets)
  // =========================================================================
  const { data: sportsEvents } = await supabase
    .from("events")
    .select("event_ticker")
    .eq("category", "Sports");

  if (sportsEvents?.length) {
    const sportsEventTickers = sportsEvents.map((e) => e.event_ticker);

    const { data: sportsMarkets } = await supabase
      .from("markets")
      .select("ticker, title, last_price, event_ticker, close_time, updated_at")
      .in("status", ["open", "active"])
      .gt("last_price", 0)
      .gt("close_time", now)
      .in("event_ticker", sportsEventTickers.slice(0, 100))
      .limit(200);

    // Get odds signals with implied probability
    const { data: oddsSignals } = await supabase
      .from("external_signals")
      .select("*")
      .eq("source", "odds_api")
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("fetched_at", { ascending: false })
      .limit(50);

    if (sportsMarkets?.length && oddsSignals?.length) {
      for (const signal of oddsSignals) {
        const d = signal.data as {
          home_team?: string;
          away_team?: string;
          consensus_implied_prob?: Record<string, number>;
        };
        if (!d.home_team || !d.away_team || !d.consensus_implied_prob) continue;

        // Find Kalshi markets that mention either team
        const homeKey = d.home_team.toLowerCase();
        const awayKey = d.away_team.toLowerCase();

        for (const market of sportsMarkets) {
          const titleLower = market.title.toLowerCase();

          // Check if market mentions one of the teams
          let matchedTeam: string | undefined;
          let teamProb: number | undefined;

          for (const [team, prob] of Object.entries(d.consensus_implied_prob)) {
            if (titleLower.includes(team.toLowerCase())) {
              matchedTeam = team;
              teamProb = prob;
              break;
            }
          }

          // Also try partial matching (e.g., "Thunder" matches "Oklahoma City Thunder")
          if (!matchedTeam) {
            if (titleLower.includes(homeKey) || homeKey.split(" ").some((w) => w.length > 3 && titleLower.includes(w))) {
              matchedTeam = d.home_team;
              teamProb = d.consensus_implied_prob[d.home_team];
            } else if (titleLower.includes(awayKey) || awayKey.split(" ").some((w) => w.length > 3 && titleLower.includes(w))) {
              matchedTeam = d.away_team;
              teamProb = d.consensus_implied_prob[d.away_team];
            }
          }

          if (!matchedTeam || teamProb == null) continue;

          const externalCents = Math.round(teamProb * 100);
          const divergence = Math.abs(externalCents - market.last_price!);

          if (divergence < 8) continue;

          const side = externalCents > market.last_price! ? "yes" : "no";

          await trySendAlert({
            ticker: market.ticker,
            market_title: market.title,
            category: "sports",
            trigger_source: "odds_api",
            trigger_event: `${d.home_team} vs ${d.away_team} — ${matchedTeam} consensus: ${externalCents}¢`,
            trigger_detail: `Sportsbook consensus ${externalCents}¢ vs Kalshi ${market.last_price}¢ (${divergence}¢ gap)`,
            kalshi_price: market.last_price!,
            estimated_fair_value: externalCents,
            edge_cents: divergence,
            side,
            confidence: Math.min(divergence / 20, 0.85),
            staleness_seconds: Math.round((Date.now() - new Date(market.updated_at).getTime()) / 1000),
            window_seconds: 300,
          });
        }
      }
    }

    // Also check ESPN for completed games where Kalshi market is still priced mid-range
    const { data: espnSignals } = await supabase
      .from("external_signals")
      .select("*")
      .eq("source", "espn")
      .eq("signal_type", "score")
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("fetched_at", { ascending: false })
      .limit(50);

    if (espnSignals?.length && sportsMarkets?.length) {
      for (const signal of espnSignals) {
        const d = signal.data as {
          completed?: boolean;
          home_team?: string;
          away_team?: string;
          home_score?: number;
          away_score?: number;
        };
        if (!d.completed || d.home_score == null || d.away_score == null) continue;

        const winner = d.home_score > d.away_score ? d.home_team : d.away_team;
        const loser = d.home_score > d.away_score ? d.away_team : d.home_team;

        for (const market of sportsMarkets) {
          const titleLower = market.title.toLowerCase();
          const winnerLower = winner?.toLowerCase() ?? "";
          const loserLower = loser?.toLowerCase() ?? "";

          // Does this market reference the winner or loser?
          const mentionsWinner = winnerLower && titleLower.includes(winnerLower);
          const mentionsLoser = loserLower && titleLower.includes(loserLower);

          if (!mentionsWinner && !mentionsLoser) continue;

          // Game is over — winner's market should be ~100, loser's ~0
          const fairValue = mentionsWinner ? 95 : 5;
          const edge = Math.abs(fairValue - market.last_price!);

          if (edge < 10) continue;

          const side = fairValue > market.last_price! ? "yes" : "no";

          await trySendAlert({
            ticker: market.ticker,
            market_title: market.title,
            category: "sports",
            trigger_source: "espn",
            trigger_event: `Game over: ${d.home_team} ${d.home_score} - ${d.away_team} ${d.away_score}`,
            trigger_detail: `Game completed but market still priced at ${market.last_price}¢ (should be ~${fairValue}¢)`,
            kalshi_price: market.last_price!,
            estimated_fair_value: fairValue,
            edge_cents: edge,
            side,
            confidence: 0.95,
            staleness_seconds: Math.round((Date.now() - new Date(market.updated_at).getTime()) / 1000),
            window_seconds: 120,
          });
        }
      }
    }
  }

  // =========================================================================
  // 5. Economics & Financials (FRED + CoinGecko vs Kalshi markets)
  // =========================================================================
  const { data: econEvents } = await supabase
    .from("events")
    .select("event_ticker, title, category")
    .in("category", ["Economics", "Financials"]);

  if (econEvents?.length) {
    const econEventTickers = econEvents.map((e) => e.event_ticker);

    const { data: econMarkets } = await supabase
      .from("markets")
      .select("ticker, title, last_price, event_ticker, close_time, updated_at")
      .in("status", ["open", "active"])
      .gt("last_price", 0)
      .gt("close_time", now)
      .in("event_ticker", econEventTickers.slice(0, 50))
      .limit(100);

    const { data: fredSignals } = await supabase
      .from("external_signals")
      .select("*")
      .eq("source", "fred")
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("fetched_at", { ascending: false })
      .limit(20);

    if (econMarkets?.length && fredSignals?.length) {
      // Map FRED series to keywords that appear in Kalshi market titles
      const seriesKeywords: Record<string, string[]> = {
        CPIAUCSL: ["cpi", "inflation"],
        UNRATE: ["unemployment"],
        PAYEMS: ["nonfarm", "payroll", "jobs"],
        GDP: ["gdp"],
        FEDFUNDS: ["fed funds", "federal funds", "interest rate"],
        DFF: ["fed funds", "federal funds"],
        T10Y2Y: ["yield curve", "spread"],
        MORTGAGE30US: ["mortgage"],
        HOUST: ["housing starts"],
        RSAFS: ["retail sales"],
        UMCSENT: ["consumer sentiment"],
        DCOILWTICO: ["oil", "wti", "crude"],
        GASREGW: ["gas price", "gasoline"],
      };

      for (const signal of fredSignals) {
        const d = signal.data as {
          series_id?: string;
          latest_value?: number;
          prior_value?: number;
          change_pct?: number;
        };
        if (!d.series_id || d.latest_value == null) continue;

        const keywords = seriesKeywords[d.series_id];
        if (!keywords) continue;

        for (const market of econMarkets) {
          const titleLower = market.title.toLowerCase();

          // Check if market title matches any keyword for this series
          const matches = keywords.some((kw) => titleLower.includes(kw));
          if (!matches) continue;

          // Try to extract a threshold from the market title
          const thresholdMatch = market.title.match(/(above|below|over|under|more than|less than|at least|≥|≤|>|<)\s*\$?([\d,.]+)/i);
          if (!thresholdMatch) continue;

          const isAbove = /above|over|more|at least|≥|>/i.test(thresholdMatch[1]);
          const threshold = parseFloat(thresholdMatch[2].replace(/,/g, ""));

          const diff = d.latest_value - threshold;
          const pctDiff = Math.abs(diff / threshold) * 100;

          // Estimate fair value based on how far actual is from threshold
          let fairValue: number;
          if (isAbove) {
            fairValue = diff > pctDiff * 0.5 ? 85 : diff > 0 ? 65 : diff > -pctDiff * 0.5 ? 35 : 15;
          } else {
            fairValue = diff < -pctDiff * 0.5 ? 85 : diff < 0 ? 65 : diff < pctDiff * 0.5 ? 35 : 15;
          }

          const edge = Math.abs(fairValue - market.last_price!);
          if (edge < 8) continue;

          const side = fairValue > market.last_price! ? "yes" : "no";

          await trySendAlert({
            ticker: market.ticker,
            market_title: market.title,
            category: "economics",
            trigger_source: "fred",
            trigger_event: `${d.series_id}: ${d.latest_value} (${d.change_pct?.toFixed(1)}% change)`,
            trigger_detail: `FRED ${d.series_id} at ${d.latest_value} vs threshold ${threshold} — fair value est: ${fairValue}¢`,
            kalshi_price: market.last_price!,
            estimated_fair_value: fairValue,
            edge_cents: edge,
            side,
            confidence: Math.min(edge / 25, 0.8),
            staleness_seconds: Math.round((Date.now() - new Date(market.updated_at).getTime()) / 1000),
            window_seconds: 600,
          });
        }
      }
    }
  }

  // =========================================================================
  // Cleanup: prune alert_history older than 7 days
  // =========================================================================
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("alert_history").delete().lt("sent_at", sevenDaysAgo);

  return NextResponse.json({
    success: true,
    opportunities_found: alerts.length,
    emails_sent: emailsEnabled ? alerts.length - emailsSkipped : 0,
    emails_enabled: emailsEnabled,
    emails_skipped: emailsSkipped,
    daily_budget_used: sentToday,
    alerts,
  });
}
