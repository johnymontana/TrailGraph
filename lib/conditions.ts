import { parkDetail } from './queries';
import { darkSkyRating, getWeather, monthNames } from './datasources';

/**
 * Trip-conditions aggregation (§5.1 / ADR-042). Promotes the ranger's already-computed reasoning to
 * structured, render-ready data — sourced from the graph (`parkDetail`, the single fact source) + the
 * live weather fetch, NEVER parsed from the model's prose. The chat cards and the Trip Dashboard both
 * consume these shapes. Astronomy (moon/twilight) is merged in by the `dark_sky_card`/`astro_card`
 * tools (ADR-043); per-stop conditions stay to the always-available graph facts so the dashboard renders
 * even before `pnpm datasources:sync` fills the optional props.
 */

export type TempBand = 'cold' | 'cool' | 'mild' | 'warm' | 'hot';

export interface DarkSkyRating {
  stars: number;
  label: string;
}

export interface ConditionsCardData {
  parkCode: string;
  parkName: string;
  order?: number;
  darkSky: { bortleScale: number | null; rating: DarkSkyRating | null; darkSkyCertified: boolean } | null;
  crowdLevel: string | null;
  bestMonths: string | null;
  weather: { currentTempF: number | null; condition: string; emoji: string; hi: number | null; lo: number | null } | null;
  tempBand: TempBand | null;
}

export interface TripDashboard {
  tripId: string;
  tripName: string;
  startDate: string | null;
  endDate: string | null;
  stops: ConditionsCardData[];
}

/** Coarse temperature band from a daytime high (°F). Pure (unit-tested). */
export function tempBand(hiF: number | null): TempBand | null {
  if (hiF == null) return null;
  if (hiF < 32) return 'cold';
  if (hiF < 50) return 'cool';
  if (hiF < 70) return 'mild';
  if (hiF < 85) return 'warm';
  return 'hot';
}

/** Human label + rough range for a temp band (UI hint). Pure. */
export function tempBandLabel(band: TempBand | null): string | null {
  switch (band) {
    case 'cold':
      return 'Cold · below 32°F';
    case 'cool':
      return 'Cool · 32–50°F';
    case 'mild':
      return 'Mild · 50–70°F';
    case 'warm':
      return 'Warm · 70–85°F';
    case 'hot':
      return 'Hot · 85°F+';
    default:
      return null;
  }
}

/**
 * Build the structured conditions for one park (Bortle + crowd + best months + live weather + temp
 * band) from the single fact source. Returns null when the park doesn't exist.
 */
export async function buildParkConditions(parkCode: string, order?: number): Promise<ConditionsCardData | null> {
  const park = await parkDetail(parkCode);
  if (!park) return null;
  const weather =
    park.lat != null && park.lng != null
      ? await getWeather(park.lat as number, park.lng as number).catch(() => null)
      : null;
  const today = weather?.daily?.[0] ?? null;
  const bortle = (park.bortleScale as number | null) ?? null;
  const certified = (park.darkSkyCertified as boolean) ?? false;
  return {
    parkCode,
    parkName: park.name as string,
    order,
    darkSky:
      bortle != null || certified
        ? { bortleScale: bortle, rating: bortle != null ? darkSkyRating(bortle) : null, darkSkyCertified: certified }
        : null,
    crowdLevel: (park.crowdLevel as string | null) ?? null,
    bestMonths: monthNames((park.bestMonths as number[]) ?? []) || null,
    weather: weather
      ? {
          currentTempF: weather.currentTempF,
          condition: weather.condition,
          emoji: weather.emoji,
          hi: today?.hiF ?? null,
          lo: today?.loF ?? null,
        }
      : null,
    tempBand: tempBand(today?.hiF ?? null),
  };
}
