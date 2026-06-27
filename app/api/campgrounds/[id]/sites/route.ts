import { readCampgroundSites } from '../../../../../lib/blob-campsites';
import { readGraph } from '../../../../../lib/neo4j';

/**
 * Serve a campground's site/loop geometry — the mirror of `/api/trails/[parkCode]`. Reads the
 * campground's `sitesGeoUrl` to locate the Blob FeatureCollection, degrading to an empty FC so a
 * RIDB-only campground (no per-site geometry) or an unsynced one never errors. The detail page falls
 * back to the site list (campsitesForCampground) when this is empty.
 *
 * Campground ids carry colons ('ridb:232449') → params arrive URL-encoded in production (decode first).
 */
export const dynamic = 'force-dynamic';

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  if (!/^[A-Za-z0-9:_-]+$/.test(id)) return Response.json({ error: 'invalid id' }, { status: 400 });
  const rows = await readGraph<{ url: string | null }>(
    `MATCH (c:Campground {id: $id}) RETURN c.sitesGeoUrl AS url`,
    { id },
  ).catch(() => []);
  const fc = await readCampgroundSites(id, rows[0]?.url ?? null);
  return Response.json(fc ?? EMPTY, {
    headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' },
  });
}
