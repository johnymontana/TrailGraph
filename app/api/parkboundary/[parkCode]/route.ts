import { fetchParkBoundary } from '../../../../lib/parkboundary';

/**
 * Park boundary GeoJSON (NPS-expansion P1 #4). Proxies NPS `/mapdata/parkboundaries/{parkCode}` (cached
 * hard — boundaries rarely change) via the shared `fetchParkBoundary` helper, which the Trip Lab offline
 * pack (ADR-057) reuses. We deliberately DON'T store boundary geometry in Neo4j (large + non-relational,
 * ADR-006); this cached route is the access path the MapLibre layer fetches on demand.
 */
export const revalidate = 604800; // 7 days

export async function GET(_req: Request, { params }: { params: Promise<{ parkCode: string }> }) {
  const { parkCode } = await params;
  if (!/^[a-z]{4}$/i.test(parkCode)) {
    return Response.json({ error: 'invalid parkCode' }, { status: 400 });
  }
  // Coverage is uneven — many sites have no boundary; the helper degrades to an empty FeatureCollection.
  const geojson = await fetchParkBoundary(parkCode);
  return Response.json(geojson, {
    headers: { 'Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400' },
  });
}
