// External data connectors — barrel export

export { polymarket } from "./prediction/polymarket";
export { predictit } from "./prediction/predictit";
export { espn } from "./sports/espn";
export { oddsApi } from "./sports/odds-api";
export { fred } from "./economics/fred";
export { coingecko } from "./crypto/coingecko";
export { openMeteo } from "./weather/open-meteo";
export { nws } from "./weather/nws";

export type { ExternalSignal, DataConnector, SignalSource, SignalCategory } from "./types";

import type { DataConnector } from "./types";
import { polymarket } from "./prediction/polymarket";
import { predictit } from "./prediction/predictit";
import { espn } from "./sports/espn";
import { oddsApi } from "./sports/odds-api";
import { fred } from "./economics/fred";
import { coingecko } from "./crypto/coingecko";
import { openMeteo } from "./weather/open-meteo";
import { nws } from "./weather/nws";

/** All registered data connectors */
export const ALL_CONNECTORS: DataConnector[] = [
  polymarket,
  predictit,
  espn,
  oddsApi,
  fred,
  coingecko,
  openMeteo,
  nws,
];

/** Only connectors that require no API key */
export const FREE_CONNECTORS: DataConnector[] = [
  polymarket,
  predictit,
  espn,
  coingecko,
  openMeteo,
  nws,
];
