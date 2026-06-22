import { env } from '../../../../lib/env';

/**
 * Park boundary GeoJSON (NPS-expansion P1 #4). Proxies NPS `/mapdata/parkboundaries/{parkCode}` —
 * which returns GeoJSON, NOT the paged wrapper — and caches it hard (boundaries rarely change). We
 * deliberately DON'T store boundary geometry in Neo4j (it's large and non-relational, ADR-006); this
 * cached route is the access path the MapLibre layer fetches on demand. Never called from NPS sync.
 */
export const revalidate = 604800; // 7 days

export async function GET(_req: Request, { params }: { params: Promise<{ parkCode: string }> }) {
  const { parkCode } = await params;
  if (!/^[a-z]{4}$/i.test(parkCode)) {
    return Response.json({ error: 'invalid parkCode' }, { status: 400 });
  }
  const url = `${env.nps.baseUrl}/mapdata/parkboundaries/${parkCode.toLowerCase()}`;
  try {
    const res = await fetch(url, {
      headers: { 'X-Api-Key': env.nps.apiKey },
      next: { revalidate },
    });
    if (!res.ok) {
      // Coverage is uneven — many sites have no boundary. Treat as an empty FeatureCollection so the
      // map layer degrades gracefully instead of erroring.
      return Response.json({ type: 'FeatureCollection', features: [] }, { status: res.status === 404 ? 200 : 502 });
    }
    const geojson = await res.json();
    return Response.json(geojson, {
      headers: { 'Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400' },
    });
  } catch {
    return Response.json({ type: 'FeatureCollection', features: [] }, { status: 200 });
  }
}
