import '../lib/load-env';
import { closeDriver } from '../lib/neo4j';
import { hasBlob } from '../lib/blob-trails';
import { syncTrails } from '../lib/sync/sync-trails';
import { deriveTrailLogistics } from '../lib/sync/derive-trail-logistics';
import { joinThingsToDoTrails } from '../lib/sync/join-thingstodo-trails';
import { deriveTrailElevation } from '../lib/sync/derive-trail-elevation';

/**
 * Standalone trail ingest (ADR-066/067) — populate `:Trail` metadata + the per-park geometry Blob without
 * running the whole slow corpus sync. Requires parks to already exist in the graph (run the normal sync /
 * `pnpm seed:test` first). Geometry is written to Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, else to
 * `public/trails/` (local dev). Elevation profiles need `SYNC_TRAIL_ELEVATION=1` + `ELEVATION_API_URL`.
 *
 *   NEO4J_URI=… NEO4J_USERNAME=… NEO4J_PASSWORD=… BLOB_READ_WRITE_TOKEN=… pnpm trails:sync
 *
 * Re-runs are cheap (per-park content-hash skip); `SYNC_FORCE=1` re-writes everything.
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
    console.log('   ', JSON.stringify(await deriveTrailElevation()));
  } else {
    console.log('[trails] elevation skipped — set SYNC_TRAIL_ELEVATION=1 + ELEVATION_API_URL to fill profiles');
  }

  await closeDriver();
  console.log('✓ trails synced');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
