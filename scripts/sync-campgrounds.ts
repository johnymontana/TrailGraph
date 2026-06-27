import '../lib/load-env';
import { closeDriver } from '../lib/neo4j';
import { pagedExternalStep } from '../lib/sync';
import { applyReservations } from '../lib/datasources/recreation';
import { fetchFacilitiesPage } from '../lib/datasources/ridb';
import { upsertRidbCampgrounds } from '../lib/sync/sync-campgrounds-ridb';
import { syncCampsitesRidb } from '../lib/sync/sync-campsites-ridb';
import { deriveCampNear } from '../lib/sync/derive-camp-near';
import { enrichCampgroundsOSM } from '../lib/sync/enrich-camp-osm';
import { resolveCampgrounds } from '../lib/sync/resolve-campgrounds';

/**
 * Standalone multi-agency campground ingest (Campgrounds feature) — populate :Campground / :Campsite /
 * :Agency / :RecArea from RIDB + the NEAR / NEAR_TRAILHEAD edges, without the whole slow corpus sync.
 * Requires parks to already exist (run the normal sync / `pnpm seed:test` first); NEAR_TRAILHEAD needs
 * trails synced too. NPS campgrounds unify in place via ridbId.
 *
 *   RIDB_API_KEY=… NEO4J_URI=… NEO4J_USERNAME=… NEO4J_PASSWORD=… pnpm campgrounds:sync
 *
 * Re-runs are cheap (per-facility content-hash skip + :SyncState checkpoints); `SYNC_FORCE=1` re-writes all.
 */
async function main() {
  console.log('[campgrounds] camp-ridbids (parse ridbId from recreation.gov URLs so NPS↔RIDB unify)…');
  console.log('   ', JSON.stringify({ applied: await applyReservations() }));

  console.log('[campgrounds] campgrounds-ridb (RIDB Facilities → :Campground + :Agency/:RecArea)…');
  console.log('   ', JSON.stringify((await pagedExternalStep('campgrounds-ridb', 50, fetchFacilitiesPage, upsertRidbCampgrounds)).counts));

  console.log('[campgrounds] campsites-ridb (RIDB Campsites → :Campsite, per-facility checkpoint)…');
  console.log('   ', JSON.stringify((await syncCampsitesRidb()).counts));

  if (process.env.ENRICH_OSM_CAMP === '1') {
    console.log('[campgrounds] enrich-camp-osm (OSM state/private/dispersed coverage, ODbL)…');
    console.log('   ', JSON.stringify(await enrichCampgroundsOSM()));
  }
  if (process.env.RESOLVE_CAMPGROUNDS === '1') {
    console.log('[campgrounds] resolve-campgrounds (dedup OSM vs federal by name+geodistance)…');
    console.log('   ', JSON.stringify(await resolveCampgrounds()));
  }

  console.log('[campgrounds] derive-camp-near (NEAR → :Park, NEAR_TRAILHEAD → :Trail)…');
  console.log('   ', JSON.stringify(await deriveCampNear()));

  await closeDriver();
  console.log('✓ campgrounds synced');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
