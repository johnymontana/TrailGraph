import './server-guard';
import { readGraph } from './neo4j';
import { readParkTrails } from './blob-trails';

export interface ProfilePoint {
  distMi: number;
  elevFt: number;
}

/**
 * Load downsampled elevation profiles for the trails in a set of parks (for the finder-card sparklines).
 * Reads each park's Blob FeatureCollection once (deduped by parkCode) and keys the profile by trail id.
 * Returns `{}` when no park has trail geometry yet (pre-sync) → cards just omit the sparkline. Bounded:
 * a finder page spans a handful of parks, so this is a few Blob reads, not an N+1 over trails.
 */
export async function trailProfiles(parkCodes: string[]): Promise<Record<string, ProfilePoint[]>> {
  const codes = [...new Set(parkCodes.filter(Boolean))];
  if (codes.length === 0) return {};
  const rows = await readGraph<{ parkCode: string; url: string | null }>(
    `MATCH (p:Park) WHERE p.parkCode IN $codes RETURN p.parkCode AS parkCode, p.trailsGeoUrl AS url`,
    { codes },
  ).catch(() => []);

  const out: Record<string, ProfilePoint[]> = {};
  await Promise.all(
    rows.map(async ({ parkCode, url }) => {
      const fc = await readParkTrails(parkCode, url);
      for (const f of fc?.features ?? []) {
        const props = f.properties as { id?: string; profile?: ProfilePoint[] } | null;
        if (props?.id && Array.isArray(props.profile) && props.profile.length >= 2) {
          out[props.id] = props.profile;
        }
      }
    }),
  );
  return out;
}
