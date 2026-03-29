#!/usr/bin/env npx tsx
import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Fetch external data from all configured connectors and store in Supabase.
 *
 * Usage:
 *   npx tsx src/scripts/fetch-external-data.ts                    # All connectors
 *   npx tsx src/scripts/fetch-external-data.ts --free-only        # Only free (no API key needed)
 *   npx tsx src/scripts/fetch-external-data.ts --sources polymarket,espn  # Specific sources
 *   npx tsx src/scripts/fetch-external-data.ts --divergences      # Also check cross-market divergences
 */

import { fetchAndStoreAllSignals, findCrossMarketDivergences } from "@/lib/external-data/aggregator";

async function main() {
  const args = process.argv.slice(2);
  const freeOnly = args.includes("--free-only");
  const checkDivergences = args.includes("--divergences");

  let sources: string[] | undefined;
  const sourcesIdx = args.indexOf("--sources");
  if (sourcesIdx !== -1 && args[sourcesIdx + 1]) {
    sources = args[sourcesIdx + 1].split(",");
  }

  console.log("=== External Data Fetch ===");
  console.log(`Mode: ${freeOnly ? "Free connectors only" : "All connectors"}`);
  if (sources) console.log(`Sources: ${sources.join(", ")}`);
  console.log("");

  const start = Date.now();
  const result = await fetchAndStoreAllSignals({ freeOnly, sources });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n=== Results (${elapsed}s) ===`);
  console.log(`Total signals stored: ${result.total}`);
  console.log("\nBy source:");
  for (const [source, count] of Object.entries(result.bySource)) {
    console.log(`  ${source}: ${count}`);
  }

  if (result.errors.length > 0) {
    console.log("\nErrors:");
    for (const err of result.errors) {
      console.log(`  ⚠ ${err}`);
    }
  }

  if (checkDivergences) {
    console.log("\n=== Cross-Market Divergences ===");
    const divs = await findCrossMarketDivergences({ minDivergenceCents: 5 });
    if (divs.length === 0) {
      console.log("No divergences found (need external_market_mappings to be populated)");
    } else {
      for (const d of divs) {
        console.log(
          `  ${d.ticker}: Kalshi ${d.kalshi_price}¢ vs ${d.external_source} ${d.external_price}¢ (${d.divergence_cents}¢ gap)`
        );
      }
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
