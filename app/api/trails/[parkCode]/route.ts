import { readParkTrails } from '../../../../lib/blob-trails';
import { readGraph } from '../../../../lib/neo4j';

/**
 * Serve a park's trail geometry (ADR-067): the simplified GeoJSON FeatureCollection persisted to Blob by
 * sync-trails (or the local `public/trails/` fallback in dev). Used by the map trails layer + the trail
 * detail route map. Reads the park's `trailsGeoUrl` to locate the Blob, degrading to an empty FC (like
 * `/api/parkboundary`) so a missing/unsynced park never errors.
 */
export const dynamic = 'force-dynamic';

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

export async function GET(_req: Request, { params }: { params: Promise<{ parkCode: string }> }) {
  const { parkCode } = await params;
  if (!/^[a-z]{4}$/i.test(parkCode)) return Response.json({ error: 'invalid parkCode' }, { status: 400 });
  const code = parkCode.toLowerCase();
  const rows = await readGraph<{ url: string | null }>(
    `MATCH (p:Park {parkCode:$code}) RETURN p.trailsGeoUrl AS url`,
    { code },
  ).catch(() => []);
  const fc = await readParkTrails(code, rows[0]?.url ?? null);
  return Response.json(fc ?? EMPTY, {
    headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' },
  });
}
