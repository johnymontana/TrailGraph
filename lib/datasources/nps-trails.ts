import '../server-guard'; // network egress + env; keep out of the client bundle
import type { Feature } from 'geojson';
import { env } from '../env';

/**
 * AD-3 adapter for the NPS Public Trails ArcGIS FeatureServer (ADR-066). The service is public-domain and
 * keyed by `UNITCODE` (the NPS unit code), so we query a park's trails by `UNITCODE='<UC>'` and read GeoJSON
 * LineString features (WGS84 via `outSR=4326`). Paged by `resultOffset` against the ~2,000-record limit.
 * Degrades to `[]` on any error (like `lib/parkboundary.ts`) so a flaky GIS service never breaks a sync.
 */

const MAX_PER_REQUEST = 2000; // FeatureServer maxRecordCount
const OFFSET_CAP = 50_000; // safety: stop runaway paging

export function parkCodeToUnitCode(parkCode: string): string {
  return (parkCode ?? '').trim().toUpperCase();
}

interface ArcGisGeoJson {
  features?: Feature[];
  exceededTransferLimit?: boolean;
  error?: unknown;
}

/** Fetch every public trail centerline feature for a park, paging the FeatureServer. */
export async function fetchParkTrails(parkCode: string): Promise<Feature[]> {
  const unit = parkCodeToUnitCode(parkCode);
  if (!/^[A-Z]{4}$/.test(unit)) return [];
  const base = env.trails.featureServerUrl;
  const features: Feature[] = [];
  let offset = 0;

  for (;;) {
    const url = new URL(`${base}/query`);
    url.searchParams.set('where', `UNITCODE='${unit}'`);
    url.searchParams.set('outFields', '*');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('f', 'geojson');
    url.searchParams.set('returnGeometry', 'true');
    url.searchParams.set('resultOffset', String(offset));
    url.searchParams.set('resultRecordCount', String(MAX_PER_REQUEST));

    let json: ArcGisGeoJson;
    try {
      const res = await fetch(url.toString(), { next: { revalidate: 604_800 } });
      if (!res.ok) break;
      json = (await res.json()) as ArcGisGeoJson;
    } catch {
      break;
    }
    if (json.error || !Array.isArray(json.features) || json.features.length === 0) break;
    features.push(...json.features);
    if (json.features.length < MAX_PER_REQUEST && !json.exceededTransferLimit) break;
    offset += json.features.length;
    if (offset > OFFSET_CAP) break;
    await new Promise((r) => setTimeout(r, 120)); // polite between pages
  }
  return features;
}
