/**
 * Auto-matches Polymarket/PredictIt markets to Kalshi tickers
 * by keyword overlap (Jaccard similarity).
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
]);

function extractKeywords(title: string): Set<string> {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9\s.%$]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = normalized.split(" ").filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): { score: number; shared: number } {
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return { score: union === 0 ? 0 : intersection / union, shared: intersection };
}

export async function refreshMarketMappings(): Promise<{
  created: number;
  updated: number;
  total_checked: number;
}> {
  const supabase = createServerClient();
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
    .limit(2000);

  if (!kalshiMarkets?.length) {
    return { created: 0, updated: 0, total_checked: 0 };
  }

  // Fetch latest Polymarket and PredictIt signals
  const { data: externalSignals } = await supabase
    .from("external_signals")
    .select("source, external_id, title, implied_probability")
    .in("source", ["polymarket", "predictit"])
    .not("implied_probability", "is", null)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("fetched_at", { ascending: false })
    .limit(500);

  if (!externalSignals?.length) {
    return { created: 0, updated: 0, total_checked: kalshiMarkets.length };
  }

  // Dedup external signals by external_id (keep most recent)
  const seenExternal = new Set<string>();
  const uniqueExternal = externalSignals.filter((s) => {
    const key = `${s.source}:${s.external_id}`;
    if (seenExternal.has(key)) return false;
    seenExternal.add(key);
    return true;
  });

  // Pre-compute keywords for all Kalshi markets
  const kalshiKeywords = kalshiMarkets.map((m) => ({
    ticker: m.ticker,
    title: m.title,
    keywords: extractKeywords(m.title),
  }));

  // Build inverted index for fast lookup
  const invertedIndex = new Map<string, number[]>();
  for (let i = 0; i < kalshiKeywords.length; i++) {
    for (const word of kalshiKeywords[i].keywords) {
      if (!invertedIndex.has(word)) invertedIndex.set(word, []);
      invertedIndex.get(word)!.push(i);
    }
  }

  // Match each external signal to best Kalshi market
  const mappings: {
    kalshi_ticker: string;
    source: string;
    external_id: string;
    external_title: string;
    match_confidence: number;
  }[] = [];

  for (const ext of uniqueExternal) {
    if (!ext.title || !ext.external_id) continue;

    const extKeywords = extractKeywords(ext.title);

    // Find candidate Kalshi markets via inverted index
    const candidateScores = new Map<number, number>();
    for (const word of extKeywords) {
      const indices = invertedIndex.get(word);
      if (!indices) continue;
      for (const idx of indices) {
        candidateScores.set(idx, (candidateScores.get(idx) ?? 0) + 1);
      }
    }

    // Only check candidates with at least 2 shared words
    let bestIdx = -1;
    let bestScore = 0;
    let bestShared = 0;

    for (const [idx, sharedCount] of candidateScores) {
      if (sharedCount < 2) continue;

      const { score, shared } = jaccardSimilarity(extKeywords, kalshiKeywords[idx].keywords);
      if (score > bestScore && shared >= 3) {
        bestScore = score;
        bestIdx = idx;
        bestShared = shared;
      }
    }

    if (bestIdx >= 0 && bestScore >= 0.4) {
      mappings.push({
        kalshi_ticker: kalshiKeywords[bestIdx].ticker,
        source: ext.source,
        external_id: ext.external_id,
        external_title: ext.title,
        match_confidence: Math.round(bestScore * 100) / 100,
      });
    }
  }

  // Upsert mappings
  for (const mapping of mappings) {
    const { error } = await supabase
      .from("external_market_mappings")
      .upsert(mapping, {
        onConflict: "kalshi_ticker,source,external_id",
      });

    if (error) {
      console.error(`[Matcher] Upsert error for ${mapping.kalshi_ticker}:`, error.message);
    } else {
      created++;
    }
  }

  console.log(`[Matcher] Checked ${kalshiMarkets.length} Kalshi markets against ${uniqueExternal.length} external signals`);
  console.log(`[Matcher] Created/updated ${created} mappings`);

  return { created, updated, total_checked: kalshiMarkets.length };
}
