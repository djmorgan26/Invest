/**
 * Kalshi WebSocket — Real-time orderbook and trade streaming.
 *
 * Subscribes to Kalshi's WebSocket API for:
 * - orderbook_delta: Live bid/ask changes
 * - ticker: Price updates
 * - trade: Executed trades
 *
 * This tells us when Kalshi markets ARE repricing, so we can
 * measure the lag between external events and Kalshi's response.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import WebSocket from "ws";
import type { KalshiOrderbookUpdate } from "./types";

const DEMO_WS = "wss://demo-api.kalshi.co/trade-api/ws/v2";
const PROD_WS = "wss://api.elections.kalshi.com/trade-api/ws/v2";

function loadKalshiConfig() {
  const isDemo = (process.env.KALSHI_API_BASE_URL || "").includes("demo");

  const keyId = isDemo
    ? process.env.KALSHI_API_KEY_ID_DEMO!
    : process.env.KALSHI_API_KEY_ID!;

  let privateKeyPem: string;
  const envPem = isDemo
    ? process.env.KALSHI_PRIVATE_KEY_DEMO
    : process.env.KALSHI_PRIVATE_KEY;

  if (envPem) {
    privateKeyPem = envPem.replace(/\\n/g, "\n");
  } else {
    const keyPath = isDemo
      ? process.env.KALSHI_API_PRIVATE_KEY_PATH_DEMO || "./kalshi/private_key_demo.pem"
      : process.env.KALSHI_API_PRIVATE_KEY_PATH || "./kalshi/private_key.pem";
    privateKeyPem = fs.readFileSync(path.resolve(keyPath), "utf-8");
  }

  return {
    keyId,
    privateKeyPem,
    wsUrl: isDemo ? DEMO_WS : PROD_WS,
  };
}

function signWsRequest(privateKeyPem: string, timestamp: number): string {
  // Kalshi WS auth: sign "GET/trade-api/ws/v2" with the timestamp
  const method = "GET";
  const requestPath = "/trade-api/ws/v2";
  const message = `${timestamp}${method}${requestPath}`;
  const key = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign("sha256", Buffer.from(message), {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString("base64");
}

export class KalshiStream {
  private ws: WebSocket | null = null;
  private listeners: ((update: KalshiOrderbookUpdate) => void)[] = [];
  private tradeListeners: ((trade: { ticker: string; price: number; count: number; taker_side: string; timestamp: number }) => void)[] = [];
  private subscribedTickers: string[] = [];
  private shouldRun = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private msgId = 1;

  onOrderbook(listener: (update: KalshiOrderbookUpdate) => void): void {
    this.listeners.push(listener);
  }

  onTrade(listener: (trade: { ticker: string; price: number; count: number; taker_side: string; timestamp: number }) => void): void {
    this.tradeListeners.push(listener);
  }

  start(tickers: string[]): void {
    this.subscribedTickers = tickers;
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
    console.log("[Kalshi WS] Stopped");
  }

  updateTickers(tickers: string[]): void {
    this.subscribedTickers = tickers;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.subscribe();
    }
  }

  private connect(): void {
    if (!this.shouldRun) return;

    try {
      const config = loadKalshiConfig();
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signWsRequest(config.privateKeyPem, timestamp);

      console.log("[Kalshi WS] Connecting...");
      this.ws = new WebSocket(config.wsUrl, {
        headers: {
          "KALSHI-ACCESS-KEY": config.keyId,
          "KALSHI-ACCESS-SIGNATURE": signature,
          "KALSHI-ACCESS-TIMESTAMP": timestamp.toString(),
        },
      });

      this.ws.on("open", () => {
        console.log(`[Kalshi WS] Connected`);
        this.subscribe();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch {
          // Ignore parse errors
        }
      });

      this.ws.on("close", () => {
        console.log("[Kalshi WS] Disconnected");
        this.reconnect();
      });

      this.ws.on("error", (err) => {
        console.error("[Kalshi WS] Error:", err.message);
        this.ws?.close();
      });
    } catch (err) {
      console.error("[Kalshi WS] Connection setup error:", err);
      this.reconnect();
    }
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.subscribedTickers.length === 0) return;

    // Subscribe to orderbook deltas
    this.ws.send(
      JSON.stringify({
        id: this.msgId++,
        cmd: "subscribe",
        params: {
          channels: ["orderbook_delta"],
          market_tickers: this.subscribedTickers,
        },
      })
    );

    // Subscribe to trades
    this.ws.send(
      JSON.stringify({
        id: this.msgId++,
        cmd: "subscribe",
        params: {
          channels: ["trade"],
          market_tickers: this.subscribedTickers,
        },
      })
    );

    // Subscribe to ticker updates
    this.ws.send(
      JSON.stringify({
        id: this.msgId++,
        cmd: "subscribe",
        params: {
          channels: ["ticker"],
          market_tickers: this.subscribedTickers,
        },
      })
    );

    console.log(`[Kalshi WS] Subscribed to ${this.subscribedTickers.length} tickers`);
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    if (type === "orderbook_snapshot" || type === "orderbook_delta") {
      const ticker = msg.market_ticker as string;
      const msgData = msg.msg as Record<string, unknown> | undefined;
      if (!msgData) return;

      const yesBids = (msgData.yes as number[][] | undefined) ?? [];
      const bestBid = yesBids.length > 0 ? yesBids[0][0] : 0;

      // For asks, we look at the 'no' side or compute from yes
      const noAsks = (msgData.no as number[][] | undefined) ?? [];
      const bestAsk = noAsks.length > 0 ? 100 - noAsks[0][0] : 100;

      const update: KalshiOrderbookUpdate = {
        ticker,
        yes_bid: bestBid,
        yes_ask: bestAsk,
        spread: bestAsk - bestBid,
        timestamp: Date.now(),
      };

      for (const listener of this.listeners) {
        try {
          listener(update);
        } catch (err) {
          console.error("[Kalshi WS] Orderbook listener error:", err);
        }
      }
    }

    if (type === "trade") {
      const ticker = msg.market_ticker as string;
      const msgData = msg.msg as Record<string, unknown> | undefined;
      if (!msgData) return;

      const trade = {
        ticker,
        price: (msgData.yes_price as number) ?? 0,
        count: (msgData.count as number) ?? 0,
        taker_side: (msgData.taker_side as string) ?? "unknown",
        timestamp: Date.now(),
      };

      for (const listener of this.tradeListeners) {
        try {
          listener(trade);
        } catch (err) {
          console.error("[Kalshi WS] Trade listener error:", err);
        }
      }
    }
  }

  private reconnect(): void {
    if (!this.shouldRun) return;
    console.log("[Kalshi WS] Reconnecting in 5s...");
    this.reconnectTimer = setTimeout(() => this.connect(), 5000);
  }
}
