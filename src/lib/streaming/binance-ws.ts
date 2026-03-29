/**
 * Binance WebSocket — Real-time crypto price ticks.
 *
 * Connects to Binance's public WebSocket streams for BTC and ETH.
 * Updates arrive within milliseconds of trades executing.
 *
 * The edge: Kalshi crypto markets (e.g., "Will BTC be above $X at close?")
 * reprice slowly compared to actual price movements on Binance.
 * When BTC spikes $500 in 30 seconds, Kalshi might not reprice for 1-2 minutes.
 */

import WebSocket from "ws";
import type { LiveCryptoPrice } from "./types";

const BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws";

// Symbols we care about for Kalshi crypto markets
const SYMBOLS = ["btcusdt", "ethusdt", "solusdt", "dogeusdt"];

export class BinanceStream {
  private ws: WebSocket | null = null;
  private listeners: ((price: LiveCryptoPrice) => void)[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldRun = false;

  onPrice(listener: (price: LiveCryptoPrice) => void): void {
    this.listeners.push(listener);
  }

  start(): void {
    this.shouldRun = true;
    this.connect();
  }

  stop(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log("[Binance WS] Stopped");
  }

  private connect(): void {
    if (!this.shouldRun) return;

    // Combined stream for multiple symbols
    const streams = SYMBOLS.map((s) => `${s}@trade`).join("/");
    const url = `${BINANCE_WS_BASE}/${streams}`;

    console.log("[Binance WS] Connecting...");
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log(`[Binance WS] Connected (${SYMBOLS.length} symbols)`);
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Combined stream wraps data in { stream, data } format
        const trade = msg.data || msg;

        if (!trade.s || !trade.p) return;

        const price: LiveCryptoPrice = {
          source: "binance",
          symbol: trade.s.toLowerCase(), // e.g., "btcusdt"
          price: parseFloat(trade.p),
          quantity: parseFloat(trade.q),
          timestamp: trade.T || Date.now(),
          buyer_maker: trade.m ?? false,
        };

        for (const listener of this.listeners) {
          try {
            listener(price);
          } catch (err) {
            console.error("[Binance WS] Listener error:", err);
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    this.ws.on("close", () => {
      console.log("[Binance WS] Disconnected");
      this.reconnect();
    });

    this.ws.on("error", (err) => {
      console.error("[Binance WS] Error:", err.message);
      this.ws?.close();
    });
  }

  private reconnect(): void {
    if (!this.shouldRun) return;
    console.log("[Binance WS] Reconnecting in 3s...");
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }
}
