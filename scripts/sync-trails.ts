import '../lib/load-env';
import { closeDriver } from '../lib/neo4j';
import { hasBlob } from '../lib/blob-trails';
import { syncTrails } from '../lib/sync/sync-trails';
import { deriveTrailLogistics } from '../lib/sync/derive-trail-logistics';
import { joinThingsToDoTrails } from '../lib/sync/join-thingstodo-trails';
import { deriveTrailElevation } from '../lib/sync/derive-trail-elevation';
import { deriveTrailNetwork } from '../lib/sync/derive-trail-network';
import { embedTrails } from '../lib/sync/embed-nodes';

/**
 * Standalone trail ingest (ADR-066/067/072) — populate `:Trail` metadata + the per-park geometry Blob, the
 * loop-builder network, and (optionally) trail embeddings, without running the whole slow corpus sync.
 * Requires parks to already exist in the graph (run the normal sync / `pnpm seed:test` first). Geometry is
 * written to Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, else to `public/trails/` (local dev).
 * Elevation profiles need `SYNC_TRAIL_ELEVATION=1` + `ELEVATION_API_URL`; trail vibe-search embeddings need
 * `EMBED_TRAILS=1` (+ the AI Gateway).
 *
 *   NEO4J_URI=… NEO4J_USERNAME=… NEO4J_PASSWORD=… BLOB_READ_WRITE_TOKEN=… pnpm trails:sync
 *
 * Re-runs are cheap (per-park content-hash skip) — but a park whose `:Park.trailsGeoUrl` is null (Blob
 * wiped / store migrated / manually cleared) is ALWAYS re-uploaded, even on a hash match, so the skip can
 * never report "done" while geometry is missing from Blob. `SYNC_FORCE=1` re-writes everything.
 */
async function main() {
  console.log(
    `[trails] geometry → ${hasBlob() ? 'Vercel Blob (BLOB_READ_WRITE_TOKEN set)' : 'public/trails/ (local fallback — no BLOB_READ_WRITE_TOKEN)'}`,
  );

  console.log('[trails] sync-trails (NPS GIS → :Trail + simplified Blob geometry)…');
  console.log('   ', JSON.stringify(await syncTrails()));

  console.log('[trails] derive-trail-logistics (STARTS_AT parking / NEAR_SERVICE)…');
  console.log('   ', JSON.stringify(await deriveTrailLogistics()));

  console.log('[trails] join-thingstodo-trails (ALONG curated hikes)…');
  console.log('   ', JSON.stringify(await joinThingsToDoTrails()));

  if (process.env.SYNC_TRAIL_ELEVATION === '1') {
    console.log('[trails] derive-trail-elevation (DEM/API profile → Blob)…');
    const elev = await deriveTrailElevation();
    console.log('   ', JSON.stringify(elev));
    if (elev.rateLimited) {
      console.log(
        '   ⚠ elevation API rate-limited (HTTP 429) — stopped early to avoid burning the run on dead calls. ' +
          'Re-run later to resume; already-graded trails are skipped (use a self-hosted API or ' +
          'TRAIL_ELEV_MAX_SAMPLES to stay under a daily quota).',
      );
    }
  } else {
    console.log('[trails] elevation skipped — set SYNC_TRAIL_ELEVATION=1 + ELEVATION_API_URL to fill profiles');
  }

  // Phase 4 (ADR-072/073): the loop-builder network (reads the Blob geometry just written).
  console.log('[trails] derive-trail-network (CONNECTS from shared junctions → loop builder)…');
  console.log('   ', JSON.stringify(await deriveTrailNetwork()));

  if (process.env.EMBED_TRAILS === '1') {
    console.log('[trails] embed-trails (trail_embedding → semantic vibe-search)…');
    console.log('   ', JSON.stringify(await embedTrails()));
  } else {
    console.log('[trails] embeddings skipped — set EMBED_TRAILS=1 (+ AI Gateway) for trail vibe-search');
  }

  await closeDriver();
  console.log('✓ trails synced');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
