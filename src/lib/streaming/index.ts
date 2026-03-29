// Live streaming infrastructure — barrel export

export { EspnPoller } from "./espn-poller";
export { BinanceStream } from "./binance-ws";
export { KalshiStream } from "./kalshi-ws";
export {
  recordKalshiUpdate,
  checkScoreChange,
  checkCryptoMove,
  cleanup,
} from "./stale-detector";

export type {
  LiveEvent,
  LiveScore,
  LiveCryptoPrice,
  KalshiOrderbookUpdate,
  StaleOpportunity,
  StreamListener,
} from "./types";
