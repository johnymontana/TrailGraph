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
export { deriveBestMonths, crowdLevel, monthNames, normalizeCrowdCurve, type CrowdCurvePoint } from './visitation';
export { classifyDifficulty, difficultyDot, type Difficulty } from './trails';
export { recreationUrl, parseRidbId } from './recreation';
export { getWeather, weatherCodeLabel, type ParkWeather } from './weather';
export { getConditions, roadEventSeverity, type ParkConditions, type Webcam, type RoadEvent } from './conditions';
export { getAstro, moonPhaseName, sqmFromBortle, sunTimesFor, darkestNight, type AstroEvents, type SqmEstimate, type SunTimes, type DarkestNight } from './astro';
export {
  meteorShowers,
  satellitePasses,
  shotPlan,
  METEOR_SHOWERS,
  type MeteorShower,
  type ActiveMeteorShower,
  type SatellitePass,
  type ShotPlan,
  type ShotAlignment,
} from './astro';
export { fetchVisibleSatellites, parseTle, SAMPLE_ISS_TLE, type Tle } from './tle';
