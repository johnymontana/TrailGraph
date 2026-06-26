/**
 * Weather data source (§4) — behind the AD-3 adapter. Uses Open-Meteo (free, no API key) for current
 * conditions + a short forecast by park lat/lng. This is a *runtime* fetch (weather isn't graph-synced),
 * cached briefly via `fetch`'s `next.revalidate`. Pure WMO-code→label mapping is unit-tested.
 */
export interface DayForecast {
  date: string;
  hiF: number;
  loF: number;
  condition: string;
  emoji: string;
}
export interface ParkWeather {
  currentTempF: number | null;
  condition: string;
  emoji: string;
  daily: DayForecast[];
}

/** WMO weather code → friendly label + emoji. Pure (unit-tested). */
export function weatherCodeLabel(code: number | null | undefined): { label: string; emoji: string } {
  const c = code ?? -1;
  if (c < 0) return { label: '—', emoji: '🌡️' };
  if (c === 0) return { label: 'Clear', emoji: '☀️' };
  if (c <= 2) return { label: 'Partly cloudy', emoji: '⛅' };
  if (c === 3) return { label: 'Overcast', emoji: '☁️' };
  if (c <= 48) return { label: 'Fog', emoji: '🌫️' };
  if (c <= 57) return { label: 'Drizzle', emoji: '🌦️' };
  if (c <= 67) return { label: 'Rain', emoji: '🌧️' };
  if (c <= 77) return { label: 'Snow', emoji: '🌨️' };
  if (c <= 82) return { label: 'Showers', emoji: '🌦️' };
  if (c <= 86) return { label: 'Snow showers', emoji: '🌨️' };
  if (c <= 99) return { label: 'Thunderstorm', emoji: '⛈️' };
  return { label: '—', emoji: '🌡️' };
}

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; weather_code?: number };
  daily?: { time?: string[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; weather_code?: number[] };
}

/**
 * Current conditions + forecast for a lat/lng, or null if unavailable. Cached ~30 min. Defaults to a 3-day
 * forecast (existing callers); pass `{ days }` to extend the horizon (e.g. the condition-aware map's "this
 * weekend", #4) — Open-Meteo caps at 16 days, so dates beyond that have no daily row (caller treats as unknown).
 */
export async function getWeather(lat: number, lng: number, opts?: { days?: number }): Promise<ParkWeather | null> {
  const days = Math.min(16, Math.max(1, Math.round(opts?.days ?? 3)));
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=${days}`;
  try {
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return null;
    const d = (await res.json()) as OpenMeteoResponse;
    const cur = weatherCodeLabel(d.current?.weather_code);
    const daily: DayForecast[] = (d.daily?.time ?? []).map((date, i) => {
      const c = weatherCodeLabel(d.daily?.weather_code?.[i]);
      return {
        date,
        hiF: Math.round(d.daily?.temperature_2m_max?.[i] ?? 0),
        loF: Math.round(d.daily?.temperature_2m_min?.[i] ?? 0),
        condition: c.label,
        emoji: c.emoji,
      };
    });
    return {
      currentTempF: d.current?.temperature_2m != null ? Math.round(d.current.temperature_2m) : null,
      condition: cur.label,
      emoji: cur.emoji,
      daily,
    };
  } catch {
    return null;
  }
}
