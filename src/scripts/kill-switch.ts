#!/usr/bin/env npx tsx
/**
 * Kill Switch CLI
 *
 * Usage:
 *   npx tsx src/scripts/kill-switch.ts on "reason for halting"
 *   npx tsx src/scripts/kill-switch.ts off
 *   npx tsx src/scripts/kill-switch.ts status
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import {
  activateKillSwitch,
  deactivateKillSwitch,
  getCircuitBreakerStatus,
} from "@/lib/strategies/circuit-breakers";

async function main() {
  const action = process.argv[2];

  if (!action || !["on", "off", "status"].includes(action)) {
    console.log("Usage:");
    console.log("  npx tsx src/scripts/kill-switch.ts on \"reason\"   — Halt all trading");
    console.log("  npx tsx src/scripts/kill-switch.ts off            — Resume trading");
    console.log("  npx tsx src/scripts/kill-switch.ts status         — Show circuit breaker status");
    process.exit(1);
  }

  if (action === "on") {
    const reason = process.argv[3] || "Manual kill switch activation";
    await activateKillSwitch(reason);
    console.log(`\n🛑 KILL SWITCH ACTIVATED`);
    console.log(`   Reason: ${reason}`);
    console.log(`   All trading is now halted.\n`);
    return;
  }

  if (action === "off") {
    await deactivateKillSwitch();
    console.log(`\n✅ KILL SWITCH DEACTIVATED`);
    console.log(`   Trading resumed.\n`);
    return;
  }

  if (action === "status") {
    const status = await getCircuitBreakerStatus();

    console.log("\n=== CIRCUIT BREAKER STATUS ===\n");

    // Kill switch
    console.log(`Kill Switch:      ${status.kill_switch_active ? "🛑 ACTIVE" : "✅ Off"}`);

    // Daily loss
    console.log(`Daily P&L:        $${status.daily_pnl.toFixed(2)} (limit: $${status.daily_loss_limit}) ${status.daily_loss_breached ? "🛑 BREACHED" : "✅"}`);

    // Drawdown
    console.log(`Drawdown:         ${(status.drawdown_pct * 100).toFixed(1)}% (limit: ${(status.drawdown_threshold * 100)}%) ${status.drawdown_breached ? "🛑 BREACHED" : "✅"}`);
    console.log(`Portfolio:        $${status.current_portfolio_value.toFixed(2)} (peak: $${status.peak_portfolio_value.toFixed(2)})`);

    // Category concentration
    console.log(`\nCategory Exposure (max ${status.category_limit} per category):`);
    const cats = Object.entries(status.category_counts);
    if (cats.length === 0) {
      console.log("  No open trades");
    } else {
      for (const [cat, count] of cats.sort((a, b) => b[1] - a[1])) {
        const warn = count >= status.category_limit ? " 🛑 AT LIMIT" : "";
        console.log(`  ${cat}: ${count}${warn}`);
      }
    }

    // Consecutive losses
    console.log(`\nConsecutive Losses (limit: ${status.consecutive_loss_limit}):`);
    const losses = Object.entries(status.consecutive_losses);
    if (losses.length === 0) {
      console.log("  No strategy data");
    } else {
      for (const [strat, count] of losses.sort((a, b) => b[1] - a[1])) {
        const warn = count >= status.consecutive_loss_limit ? " 🛑 AT LIMIT" : "";
        console.log(`  ${strat}: ${count}${warn}`);
      }
    }

    console.log(`\nOverall: ${status.all_clear ? "✅ ALL CLEAR — trading allowed" : "🛑 TRADING BLOCKED"}\n`);
    return;
  }
}

main().catch(console.error);
