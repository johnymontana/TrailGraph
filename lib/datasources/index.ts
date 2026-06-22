import { applyDarkSky } from './darksky';
import { applyVisitation } from './visitation';
import { applyTrailDifficulty } from './trails';
import { applyReservations } from './recreation';
import { applyPermits } from './permits';

/**
 * Run every §5 data-source adapter. Each writes graph-native props into the one Neo4j (AD-1/2) and is
 * idempotent. Wired into the scheduled sync and runnable directly via `pnpm datasources:sync`.
 */
export async function syncDataSources(): Promise<Record<string, number>> {
  return {
    darkSky: await applyDarkSky(),
    visitation: await applyVisitation(),
    trailDifficulty: await applyTrailDifficulty(),
    reservations: await applyReservations(),
    permits: await applyPermits(),
  };
}

export { darkSkyRating } from './darksky';
export { deriveBestMonths, crowdLevel, monthNames } from './visitation';
export { classifyDifficulty, difficultyDot, type Difficulty } from './trails';
export { recreationUrl, parseRidbId } from './recreation';
export { getWeather, weatherCodeLabel, type ParkWeather } from './weather';
