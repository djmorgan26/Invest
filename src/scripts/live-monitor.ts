#!/usr/bin/env npx tsx
import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Live Speed Edge Monitor
 *
 * Runs all streaming data sources and watches for Kalshi markets that
 * haven't repriced after real-world events. This is the speed edge.
 *
 * Usage:
 *   npx tsx src/scripts/live-monitor.ts                    # All streams
 *   npx tsx src/scripts/live-monitor.ts --sports-only      # ESPN only
 *   npx tsx src/scripts/live-monitor.ts --crypto-only      # Binance only
 *   npx tsx src/scripts/live-monitor.ts --poll-interval 5  # 5 sec ESPN polls
 *
 * When it finds a stale opportunity, it prints an alert with:
 *   - What triggered it (score change, crypto move)
 *   - The Kalshi market that's stale
 *   - Estimated edge in cents
 *   - Suggested side (YES/NO)
 *   - How long the opportunity window is
 */

import { EspnPoller } from "@/lib/streaming/espn-poller";
import { BinanceStream } from "@/lib/streaming/binance-ws";
import { KalshiStream } from "@/lib/streaming/kalshi-ws";
import {
  recordKalshiUpdate,
  checkScoreChange,
  checkCryptoMove,
  cleanup,
} from "@/lib/streaming/stale-detector";
import type { LiveCryptoPrice, StaleOpportunity } from "@/lib/streaming/types";

const args = process.argv.slice(2);
const sportsOnly = args.includes("--sports-only");
const cryptoOnly = args.includes("--crypto-only");
const pollIntervalArg = args.indexOf("--poll-interval");
const pollInterval = pollIntervalArg !== -1 && args[pollIntervalArg + 1]
  ? parseInt(args[pollIntervalArg + 1]) * 1000
  : 10_000;

// Track recent crypto prices for momentum detection
const cryptoPriceHistory = new Map<string, { price: number; timestamp: number }[]>();
const MAX_HISTORY = 300; // 5 min at ~1/sec

let totalOpportunities = 0;
let totalEdgeCents = 0;

function printOpportunity(opp: StaleOpportunity): void {
  totalOpportunities++;
  totalEdgeCents += opp.edge_cents;

  const stalenessSec = Math.round(opp.staleness_ms / 1000);
  const windowSec = Math.round((opp.expires_at - Date.now()) / 1000);

  console.log("");
  console.log("=".repeat(70));
  console.log(`🚨 STALE OPPORTUNITY #${totalOpportunities}`);
  console.log("=".repeat(70));
  console.log(`  Market:    ${opp.market_title}`);
  console.log(`  Ticker:    ${opp.ticker}`);
  console.log(`  Category:  ${opp.category}`);
  console.log(`  Trigger:   [${opp.trigger_source.toUpperCase()}] ${opp.trigger_event}`);
  console.log(`  Detail:    ${opp.trigger_detail}`);
  console.log("");
  console.log(`  Kalshi:    ${opp.kalshi_price}¢ (stale for ${stalenessSec}s)`);
  console.log(`  Fair Value: ${opp.estimated_fair_value}¢`);
  console.log(`  Edge:      ${opp.edge_cents}¢`);
  console.log(`  Side:      ${opp.side.toUpperCase()}`);
  console.log(`  Confidence: ${(opp.confidence * 100).toFixed(0)}%`);
  console.log(`  Window:    ${windowSec}s remaining`);
  console.log("=".repeat(70));
  console.log("");
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     LIVE SPEED EDGE MONITOR              ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("");

  const streams: string[] = [];

  // Start ESPN poller (sports)
  if (!cryptoOnly) {
    const espn = new EspnPoller(pollInterval);
    espn.onScore(async (score, changed) => {
      if (changed) {
        console.log(
          `⚡ [ESPN] Score change: ${score.away_team} ${score.away_score} @ ${score.home_team} ${score.home_score} (${score.league} ${score.status_desc})`
        );

        const opps = await checkScoreChange(score);
        for (const opp of opps) {
          printOpportunity(opp);
        }
      }
    });
    espn.start();
    streams.push(`ESPN (${pollInterval / 1000}s polls)`);
  }

  // Start Binance WebSocket (crypto)
  if (!sportsOnly) {
    try {
      const binance = new BinanceStream();
      let lastPrint = 0;

      binance.onPrice(async (price: LiveCryptoPrice) => {
        // Track price history
        const key = price.symbol;
        if (!cryptoPriceHistory.has(key)) cryptoPriceHistory.set(key, []);
        const history = cryptoPriceHistory.get(key)!;
        history.push({ price: price.price, timestamp: price.timestamp });

        // Trim history
        while (history.length > MAX_HISTORY) history.shift();

        // Print periodic price updates
        if (Date.now() - lastPrint > 30_000) {
          const btc = cryptoPriceHistory.get("btcusdt");
          const eth = cryptoPriceHistory.get("ethusdt");
          if (btc?.length) console.log(`📊 BTC: $${btc[btc.length - 1].price.toLocaleString()}`);
          if (eth?.length) console.log(`📊 ETH: $${eth[eth.length - 1].price.toLocaleString()}`);
          lastPrint = Date.now();
        }

        // Check for stale opportunities on significant moves
        if (history.length > 10) {
          const opps = await checkCryptoMove(price, history);
          for (const opp of opps) {
            printOpportunity(opp);
          }
        }
      });
      binance.start();
      streams.push("Binance WebSocket (BTC, ETH, SOL, DOGE)");
    } catch {
      console.warn("⚠ Binance WebSocket not available (ws package may not be installed)");
      console.warn("  Install with: npm install ws @types/ws");
    }
  }

  // Start Kalshi WebSocket (to track when markets DO reprice)
  try {
    const kalshi = new KalshiStream();
    kalshi.onOrderbook((update) => {
      recordKalshiUpdate(update.ticker, update.yes_bid);
    });
    kalshi.onTrade((trade) => {
      recordKalshiUpdate(trade.ticker, trade.price);
    });
    // We'll subscribe to specific tickers as opportunities arise
    // For now start with empty — the detector queries DB directly
    kalshi.start([]);
    streams.push("Kalshi WebSocket (orderbook + trades)");
  } catch {
    console.warn("⚠ Kalshi WebSocket not connected (check API keys)");
  }

  // Periodic cleanup
  setInterval(cleanup, 60_000);

  console.log("Active streams:");
  for (const s of streams) {
    console.log(`  ✓ ${s}`);
  }
  console.log("");
  console.log("Watching for stale Kalshi markets...");
  console.log("Press Ctrl+C to stop.");
  console.log("");

  // Keep process alive
  process.on("SIGINT", () => {
    console.log("\n\n--- Session Summary ---");
    console.log(`Opportunities detected: ${totalOpportunities}`);
    console.log(`Total edge found: ${totalEdgeCents}¢`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
