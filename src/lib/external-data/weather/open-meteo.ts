import type { DataConnector, ExternalSignal } from "../types";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

// Cities commonly featured in Kalshi weather markets
const CITIES = [
  { name: "New York", lat: 40.7128, lon: -74.006 },
  { name: "Los Angeles", lat: 34.0522, lon: -118.2437 },
  { name: "Chicago", lat: 41.8781, lon: -87.6298 },
  { name: "Houston", lat: 29.7604, lon: -95.3698 },
  { name: "Phoenix", lat: 33.4484, lon: -112.074 },
  { name: "Miami", lat: 25.7617, lon: -80.1918 },
  { name: "Dallas", lat: 32.7767, lon: -96.797 },
  { name: "Denver", lat: 39.7392, lon: -104.9903 },
  { name: "Washington DC", lat: 38.9072, lon: -77.0369 },
  { name: "Atlanta", lat: 33.749, lon: -84.388 },
];

export const openMeteo: DataConnector = {
  source: "open_meteo",

  async fetchSignals(): Promise<ExternalSignal[]> {
    const signals: ExternalSignal[] = [];
    const now = new Date().toISOString();

    const fetches = CITIES.map(async (city) => {
      try {
        const url = `${OPEN_METEO_BASE}?latitude=${city.lat}&longitude=${city.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weathercode&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America/New_York&forecast_days=7`;
        const res = await fetch(url);
        if (!res.ok) return;

        const data = await res.json();
        const daily = data.daily;
        if (!daily?.time) return;

        // Create a signal for each day's forecast
        for (let i = 0; i < daily.time.length; i++) {
          signals.push({
            source: "open_meteo",
            signal_type: "forecast",
            external_id: `${city.name.toLowerCase().replace(/\s/g, "-")}-${daily.time[i]}`,
            category: "weather",
            title: `${city.name} ${daily.time[i]}: High ${daily.temperature_2m_max[i]}°F, Low ${daily.temperature_2m_min[i]}°F`,
            data: {
              city: city.name,
              latitude: city.lat,
              longitude: city.lon,
              date: daily.time[i],
              temp_high_f: daily.temperature_2m_max[i],
              temp_low_f: daily.temperature_2m_min[i],
              precipitation_inches: daily.precipitation_sum[i],
              precipitation_prob_pct: daily.precipitation_probability_max[i],
              weather_code: daily.weathercode[i],
            },
            fetched_at: now,
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
          });
        }
      } catch (err) {
        console.error(`[OpenMeteo] Error fetching ${city.name}:`, err);
      }
    });

    await Promise.all(fetches);
    console.log(`[OpenMeteo] Fetched ${signals.length} signals`);
    return signals;
  },
};
