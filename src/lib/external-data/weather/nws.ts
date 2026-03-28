import type { DataConnector, ExternalSignal } from "../types";

const NWS_BASE = "https://api.weather.gov";

// NWS requires grid points — we pre-map major cities to their NWS grid
const NWS_STATIONS = [
  { name: "New York", office: "OKX", gridX: 33, gridY: 37 },
  { name: "Los Angeles", office: "LOX", gridX: 154, gridY: 44 },
  { name: "Chicago", office: "LOT", gridX: 65, gridY: 76 },
  { name: "Houston", office: "HGX", gridX: 65, gridY: 97 },
  { name: "Phoenix", office: "PSR", gridX: 159, gridY: 57 },
  { name: "Miami", office: "MFL", gridX: 75, gridY: 51 },
  { name: "Dallas", office: "FWD", gridX: 80, gridY: 103 },
  { name: "Denver", office: "BOU", gridX: 62, gridY: 60 },
  { name: "Washington DC", office: "LWX", gridX: 97, gridY: 71 },
  { name: "Atlanta", office: "FFC", gridX: 50, gridY: 86 },
];

export const nws: DataConnector = {
  source: "nws",

  async fetchSignals(): Promise<ExternalSignal[]> {
    const signals: ExternalSignal[] = [];
    const now = new Date().toISOString();

    const fetches = NWS_STATIONS.map(async (station) => {
      try {
        const url = `${NWS_BASE}/gridpoints/${station.office}/${station.gridX},${station.gridY}/forecast`;
        const res = await fetch(url, {
          headers: { "User-Agent": "InvestApp/1.0 (contact@example.com)" },
        });
        if (!res.ok) return;

        const data = await res.json();
        const periods = data.properties?.periods;
        if (!periods) return;

        // Take first 6 periods (3 days of day/night forecasts)
        for (const period of periods.slice(0, 6)) {
          signals.push({
            source: "nws",
            signal_type: "forecast",
            external_id: `nws-${station.name.toLowerCase().replace(/\s/g, "-")}-${period.number}`,
            category: "weather",
            title: `${station.name} NWS ${period.name}: ${period.temperature}°${period.temperatureUnit} - ${period.shortForecast}`,
            data: {
              city: station.name,
              office: station.office,
              period_name: period.name,
              start_time: period.startTime,
              end_time: period.endTime,
              temperature: period.temperature,
              temperature_unit: period.temperatureUnit,
              short_forecast: period.shortForecast,
              detailed_forecast: period.detailedForecast,
              precip_probability: period.probabilityOfPrecipitation?.value ?? null,
              is_daytime: period.isDaytime,
            },
            fetched_at: now,
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
          });
        }
      } catch (err) {
        console.error(`[NWS] Error fetching ${station.name}:`, err);
      }
    });

    await Promise.all(fetches);
    console.log(`[NWS] Fetched ${signals.length} signals`);
    return signals;
  },
};
