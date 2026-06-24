import { env } from './env';

/**
 * Park boundary GeoJSON fetch (NPS-expansion P1 #4), extracted so both the on-demand map route
 * (`/api/parkboundary/[parkCode]`) and the Trip Lab offline pack (ADR-057) share one cached path. We
 * never store boundary geometry in Neo4j (large + non-relational, ADR-006). Coverage is uneven — many
 * sites have no boundary — so failures degrade to an empty FeatureCollection rather than throwing.
 */
export interface GeoJson {
  type: string;
  features: unknown[];
  [k: string]: unknown;
}

const EMPTY: GeoJson = { type: 'FeatureCollection', features: [] };

export async function fetchParkBoundary(parkCode: string): Promise<GeoJson> {
  if (!/^[a-z]{4}$/i.test(parkCode)) return EMPTY;
  const url = `${env.nps.baseUrl}/mapdata/parkboundaries/${parkCode.toLowerCase()}`;
  try {
    const res = await fetch(url, { headers: { 'X-Api-Key': env.nps.apiKey }, next: { revalidate: 604_800 } });
    if (!res.ok) return EMPTY;
    return (await res.json()) as GeoJson;
  } catch {
    return EMPTY;
  }
}
