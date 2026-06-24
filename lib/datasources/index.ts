import { applyDarkSky } from './darksky';
import { applyVisitation } from './visitation';
import { applyTrailDifficulty } from './trails';
import { applyReservations } from './recreation';
import { applyPermits } from './permits';
import { applyFeeFreeDays } from './feefree';
import { applyAccessibilityTaxonomy } from './accessibility';
import { applyRegions } from './regions';

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
    feeFreeDays: await applyFeeFreeDays(), // F2: curated national fee-free days
    accessibility: await applyAccessibilityTaxonomy(), // F5: ensure + tag accessibility amenities
    regions: await applyRegions(), // F9: state→region IN_REGION edges
  };
}

export { darkSkyRating } from './darksky';
export { deriveBestMonths, crowdLevel, monthNames, normalizeCrowdCurve, type CrowdCurvePoint } from './visitation';
export { classifyDifficulty, difficultyDot, type Difficulty } from './trails';
export { recreationUrl, parseRidbId } from './recreation';
export { FEE_FREE_DAYS, isFeeFreeDay, applyFeeFreeDays, type FeeFreeDay } from './feefree';
export {
  ACCESS_AMENITIES,
  ACCESS_NAME_BY_ID,
  accessibilityFromText,
  deriveAccessibilityAmenityIds,
  applyAccessibilityTaxonomy,
} from './accessibility';
export { STATE_TO_REGION, regionForState, applyRegions } from './regions';
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
