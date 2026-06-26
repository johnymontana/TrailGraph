import { getInsights } from '../../../../lib/graph-analytics';
import { serverError } from '../../../../lib/http';

/**
 * Insights feed for the /graph Insights panel (#7): emergent communities, most-central parks, and bridges.
 * Reads the GDS-materialized props (computed by the slow-sync derive steps / `pnpm analytics:rebuild`), so
 * it's a cheap 3-query indexed read that returns empty arrays where analytics haven't been computed.
 *
 * NOT wrapped in `unstable_cache`: that in-process/data cache has no tag-revalidation path here, so it
 * served a stale-empty result for the full hour after an analytics rebuild. Instead we cache at the CDN
 * edge via `s-maxage` (prod) — dev has no edge cache, so the panel reflects the DB immediately after a
 * rebuild. Distinct sub-path from the map BFF op-switch.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await getInsights(), {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400' },
    });
  } catch (err) {
    return serverError('graph-analytics', err);
  }
}
