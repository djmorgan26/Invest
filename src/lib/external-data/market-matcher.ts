/**
 * Auto-matches external market signals to Kalshi tickers
 * using keyword overlap (Jaccard similarity) for prediction markets,
 * and entity-based matching for sports, crypto, weather, and economics.
 *
 * Run periodically (every 6h) to keep external_market_mappings populated.
 */

import { createServerClient } from "@/lib/supabase/server";

const STOP_WORDS = new Set([
  "will", "the", "be", "by", "in", "on", "a", "an", "of", "to", "at", "for",
  "is", "it", "or", "and", "this", "that", "not", "from", "with", "has", "have",
  "do", "does", "did", "was", "were", "been", "being", "are", "am", "what",
  "which", "who", "whom", "how", "when", "where", "why", "if", "then", "than",
  "before", "after", "during", "above", "below", "up", "down", "yes", "no",
  "win", "over", "under", "above", "below", "price", "market",
]);

// Entity maps for category-based matching
const CRYPTO_ENTITIES: Record<string, string[]> = {
  bitcoin: ["btc", "bitcoin", "xbt"],
  ethereum: ["eth", "ethereum", "ether"],
  solana: ["sol", "solana"],
  dogecoin: ["doge", "dogecoin"],
  xrp: ["xrp", "ripple"],
  cardano: ["ada", "cardano"],
  polkadot: ["dot", "polkadot"],
  avalanche: ["avax", "avalanche"],
  chainlink: ["link", "chainlink"],
  polygon: ["matic", "polygon"],
};

const NBA_TEAMS: Record<string, string[]> = {
  lakers: ["lal", "lakers", "los angeles lakers"],
  celtics: ["bos", "celtics", "boston"],
  warriors: ["gsw", "warriors", "golden state"],
  bucks: ["mil", "bucks", "milwaukee"],
  nuggets: ["den", "nuggets", "denver"],
  suns: ["phx", "suns", "phoenix"],
  "76ers": ["phi", "76ers", "sixers", "philadelphia"],
  heat: ["mia", "heat", "miami"],
  knicks: ["nyk", "knicks", "new york knicks"],
  cavaliers: ["cle", "cavaliers", "cavs", "cleveland"],
  thunder: ["okc", "thunder", "oklahoma"],
  timberwolves: ["min", "timberwolves", "minnesota"],
  mavericks: ["dal", "mavericks", "dallas"],
  rockets: ["hou", "rockets", "houston"],
  grizzlies: ["mem", "grizzlies", "memphis"],
  pacers: ["ind", "pacers", "indiana"],
  kings: ["sac", "kings", "sacramento"],
  magic: ["orl", "magic", "orlando"],
  hawks: ["atl", "hawks", "atlanta"],
  pelicans: ["nop", "pelicans", "new orleans"],
  pistons: ["det", "pistons", "detroit"],
  raptors: ["tor", "raptors", "toronto"],
  spurs: ["sas", "spurs", "san antonio"],
  bulls: ["chi", "bulls", "chicago"],
  hornets: ["cha", "hornets", "charlotte"],
  blazers: ["por", "blazers", "portland", "trail blazers"],
  jazz: ["uta", "jazz", "utah"],
  wizards: ["was", "wizards", "washington"],
  nets: ["bkn", "nets", "brooklyn"],
  clippers: ["lac", "clippers"],
};

const WEATHER_CITIES = [
  "new york", "los angeles", "chicago", "houston", "phoenix",
  "philadelphia", "san antonio", "san diego", "dallas", "miami",
  "denver", "seattle", "washington", "boston", "atlanta",
  "nashville", "austin", "detroit", "minneapolis", "portland",
];

const ECON_INDICATORS: Record<string, string[]> = {
  cpi: ["cpi", "consumer price", "inflation"],
  gdp: ["gdp", "gross domestic"],
  unemployment: ["unemployment", "jobless", "nonfarm", "payrolls"],
  fed_rate: ["federal funds", "interest rate", "fed rate", "fomc"],
  pce: ["pce", "personal consumption"],
  retail: ["retail sales"],
  housing: ["housing starts", "home sales", "existing home"],
};

function extractKeywords(title: string): Set<string> {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9\s.%$]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = normalized.split(" ").filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return new Set(words);
}

// Normalize numbers for comparison: "$70K" → "70000", "70,000" → "70000"
function normalizeNumbers(title: string): string {
  return title
    .replace(/\$?([\d,]+(?:\.\d+)?)[kK]/g, (_, n) => String(parseFloat(n.replace(/,/g, "")) * 1000))
    .replace(/\$?([\d,]+(?:\.\d+)?)[mM]/g, (_, n) => String(parseFloat(n.replace(/,/g, "")) * 1000000))
    .replace(/[\$,]/g, "");
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): { score: number; shared: number } {
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return { score: union === 0 ? 0 : intersection / union, shared: intersection };
}

/**
 * Entity-based matching for non-prediction-market sources.
 * Returns a confidence score (0-1) or 0 if no match.
 */
function entityMatch(kalshiTitle: string, externalSignal: { source: string; title: string; data?: Record<string, unknown> }): number {
  const kLower = kalshiTitle.toLowerCase();
  const eLower = externalSignal.title.toLowerCase();

  // Crypto matching: find crypto entity mentions in both titles
  if (externalSignal.source === "coingecko") {
    for (const [, aliases] of Object.entries(CRYPTO_ENTITIES)) {
      const inKalshi = aliases.some((a) => kLower.includes(a));
      const inExternal = aliases.some((a) => eLower.includes(a));
      if (inKalshi && inExternal) return 0.7;
    }
    return 0;
  }

  // Sports matching: find team name mentions
  if (externalSignal.source === "espn" || externalSignal.source === "odds_api") {
    for (const [, aliases] of Object.entries(NBA_TEAMS)) {
      const inKalshi = aliases.some((a) => kLower.includes(a));
      const inExternal = aliases.some((a) => eLower.includes(a));
      if (inKalshi && inExternal) return 0.6;
    }
    return 0;
  }

  // Weather matching: city names
  if (externalSignal.source === "open_meteo" || externalSignal.source === "nws") {
    for (const city of WEATHER_CITIES) {
      if (kLower.includes(city) && eLower.includes(city)) return 0.6;
    }
    return 0;
  }

  // Economics matching: indicator keywords
  if (externalSignal.source === "fred") {
    for (const [, keywords] of Object.entries(ECON_INDICATORS)) {
      const inKalshi = keywords.some((k) => kLower.includes(k));
      const inExternal = keywords.some((k) => eLower.includes(k));
      if (inKalshi && inExternal) return 0.65;
    }
    return 0;
  }

  return 0;
}

export async function refreshMarketMappings(): Promise<{
  created: number;
  updated: number;
  total_checked: number;
}> {
  const supabase = await createServerClient();
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;

  // Fetch active Kalshi markets
  const { data: kalshiMarkets } = await supabase
    .from("markets")
    .select("ticker, title, event_ticker")
    .in("status", ["open", "active"])
    .gt("close_time", now)
    .gt("last_price", 0)
    .limit(3000);

  if (!kalshiMarkets?.length) {
    return { created: 0, updated: 0, total_checked: 0 };
  }

  // Fetch latest external signals from ALL sources (not just prediction markets)
  const { data: externalSignals } = await supabase
    .from("external_signals")
    .select("source, external_id, title, implied_probability, data")
    .in("source", ["polymarket", "predictit", "espn", "odds_api", "coingecko", "open_meteo", "nws", "fred"])
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("fetched_at", { ascending: false })
    .limit(1000);

  if (!externalSignals?.length) {
    return { created: 0, updated: 0, total_checked: kalshiMarkets.length };
  }

  // Dedup external signals by source+external_id (keep most recent)
  const seenExternal = new Set<string>();
  const uniqueExternal = externalSignals.filter((s) => {
    const key = `${s.source}:${s.external_id}`;
    if (seenExternal.has(key)) return false;
    seenExternal.add(key);
    return true;
  });

  // Pre-compute keywords for all Kalshi markets (with number normalization)
  const kalshiKeywords = kalshiMarkets.map((m) => ({
    ticker: m.ticker,
    title: m.title,
    keywords: extractKeywords(normalizeNumbers(m.title)),
  }));

  // Build inverted index for fast keyword lookup
  const invertedIndex = new Map<string, number[]>();
  for (let i = 0; i < kalshiKeywords.length; i++) {
    for (const word of kalshiKeywords[i].keywords) {
      if (!invertedIndex.has(word)) invertedIndex.set(word, []);
      invertedIndex.get(word)!.push(i);
    }
  }

  const mappings: {
    kalshi_ticker: string;
    source: string;
    external_id: string;
    external_title: string;
    match_confidence: number;
  }[] = [];

  const predictionMarketSources = new Set(["polymarket", "predictit"]);

  for (const ext of uniqueExternal) {
    if (!ext.title || !ext.external_id) continue;

    let bestIdx = -1;
    let bestScore = 0;

    if (predictionMarketSources.has(ext.source)) {
      // Keyword-based matching for prediction market sources
      const extKeywords = extractKeywords(normalizeNumbers(ext.title));

      const candidateScores = new Map<number, number>();
      for (const word of extKeywords) {
        const indices = invertedIndex.get(word);
        if (!indices) continue;
        for (const idx of indices) {
          candidateScores.set(idx, (candidateScores.get(idx) ?? 0) + 1);
        }
      }

      for (const [idx, sharedCount] of candidateScores) {
        if (sharedCount < 2) continue;
        const { score, shared } = jaccardSimilarity(extKeywords, kalshiKeywords[idx].keywords);
        if (score > bestScore && shared >= 2) {
          bestScore = score;
          bestIdx = idx;
        }
      }

      // Lowered threshold from 0.4 to 0.3 to capture more cross-market matches
      if (bestIdx < 0 || bestScore < 0.3) continue;
    } else {
      // Entity-based matching for non-prediction sources
      for (let i = 0; i < kalshiKeywords.length; i++) {
        const confidence = entityMatch(kalshiKeywords[i].title, ext);
        if (confidence > bestScore) {
          bestScore = confidence;
          bestIdx = i;
        }
      }
      if (bestIdx < 0 || bestScore < 0.5) continue;
    }

    mappings.push({
      kalshi_ticker: kalshiKeywords[bestIdx].ticker,
      source: ext.source,
      external_id: ext.external_id,
      external_title: ext.title,
      match_confidence: Math.round(bestScore * 100) / 100,
    });
  }

  // Upsert mappings in batches of 100
  const batchSize = 100;
  for (let i = 0; i < mappings.length; i += batchSize) {
    const batch = mappings.slice(i, i + batchSize);
    const { error } = await supabase
      .from("external_market_mappings")
      .upsert(batch, {
        onConflict: "kalshi_ticker,source,external_id",
      });

    if (error) {
      console.error(`[Matcher] Batch upsert error:`, error.message);
    } else {
      created += batch.length;
    }
  }

  console.log(`[Matcher] Checked ${kalshiMarkets.length} Kalshi markets against ${uniqueExternal.length} external signals`);
  console.log(`[Matcher] Created/updated ${created} mappings`);

  return { created, updated, total_checked: kalshiMarkets.length };
}
