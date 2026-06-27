import { readGraph, writeGraph } from '../neo4j';
import { contentHash } from '../embeddings';
import {
  fetchFacilityCampsites,
  campsiteAttrs,
  mapCampsiteType,
  RidbRateLimitError,
  type RidbCampsite,
} from '../datasources/ridb';
import type { StepResult } from './index';

const RESOURCE = 'campsites-ridb';
const RESUME_TTL_SECONDS = 20 * 3600; // matches the slow-tier window in index.ts

/**
 * RIDB Campsites → :Campsite (site-level inventory, Campgrounds feature, Phase 1). This is the heavy
 * step (~100k sites across ~3,600 facilities), so it SELF-MANAGES its `:SyncState` checkpoint — the unit
 * of resumption is the FACILITY (cursor = facility index), and each facility is content-hash gated
 * (`:Campground.campSyncHash`, like sync-trails' per-park hash) so an unchanged facility is skipped on
 * re-run. A `RidbRateLimitError` mid-list PAUSES (cursor saved) and resumes next window. Idempotent
 * MERGE + a scoped orphan-prune (like upsertTrails) keep replays + upstream deletions correct.
 *
 * It's not wrapped in `step()` (which only pauses on NpsRateLimitError); index.ts pushes its StepResult.
 */
export async function syncCampsitesRidb(): Promise<StepResult> {
  const start = Date.now();

  // Resume cursor + freshness. Skip when a fresh OK checkpoint exists (unless forced).
  const state = await readGraph<{ page: number; count: number; status: string | null; fresh: boolean }>(
    `OPTIONAL MATCH (s:SyncState {resource: $resource})
     RETURN coalesce(s.partialPage, 0) AS page, coalesce(s.partialCount, 0) AS count, s.lastStatus AS status,
            (s.lastStatus = 'ok' AND s.lastRunAt > datetime() - duration({seconds: toInteger($ttl)})) AS fresh`,
    { resource: RESOURCE, ttl: RESUME_TTL_SECONDS },
  ).catch(() => []);
  if (process.env.SYNC_FORCE !== '1' && state[0]?.fresh) {
    return { resource: RESOURCE, counts: { skipped: 1, facilities: state[0].count }, ms: 0 };
  }

  // Worklist: every campground that has a RIDB facility id, deterministically ordered for a stable cursor.
  const facilities = await readGraph<{ ridbId: string; hash: string | null }>(
    `MATCH (c:Campground) WHERE c.ridbId IS NOT NULL
     RETURN c.ridbId AS ridbId, c.campSyncHash AS hash ORDER BY c.ridbId ASC`,
  );

  const resuming = state[0]?.status === 'paused';
  let idx = resuming ? (state[0]?.page ?? 0) : 0;
  let sites = resuming ? (state[0]?.count ?? 0) : 0;
  let facilitiesDone = idx;
  let skippedFacilities = 0;

  try {
    for (; idx < facilities.length; idx++) {
      const { ridbId, hash } = facilities[idx];
      const raw = await fetchFacilityCampsites(ridbId);
      const overnight = raw.filter((s) => (s.TypeOfUse ?? 'Overnight') === 'Overnight');
      const setHash = contentHash(hashPayload(overnight));

      if (process.env.SYNC_FORCE !== '1' && setHash === hash) {
        skippedFacilities++;
      } else {
        sites += await upsertRidbCampsites(ridbId, overnight, setHash);
      }
      facilitiesDone = idx + 1;

      // Persist the cursor every facility so a crash/pause resumes from here (status stays 'paused' until
      // the whole worklist is exhausted below).
      await writeGraph(
        `MERGE (s:SyncState {resource: $resource})
         SET s.tier = 'slow', s.partialPage = $page, s.partialCount = $count,
             s.lastStatus = 'paused', s.lastRunAt = datetime()`,
        { resource: RESOURCE, page: facilitiesDone, count: sites },
      );
      await new Promise((r) => setTimeout(r, 80)); // polite between facilities
    }
  } catch (err) {
    if (err instanceof RidbRateLimitError) {
      await writeGraph(
        `MERGE (s:SyncState {resource: $resource}) SET s.lastStatus = 'paused', s.lastError = $message, s.lastErrorAt = datetime()`,
        { resource: RESOURCE, message: err.message },
      ).catch(() => {});
      return { resource: RESOURCE, counts: { sites, facilities: facilitiesDone, paused: 1 }, ms: Date.now() - start };
    }
    throw err;
  }

  const ms = Date.now() - start;
  await writeGraph(
    `MERGE (s:SyncState {resource: $resource})
     SET s.tier = 'slow', s.lastStatus = 'ok', s.lastRunAt = datetime(), s.partialPage = 0, s.partialCount = $count,
         s.lastCounts = $counts, s.lastMs = $ms`,
    {
      resource: RESOURCE,
      count: facilities.length,
      counts: JSON.stringify({ facilities: facilities.length, sites, skipped: skippedFacilities }),
      ms,
    },
  );
  return { resource: RESOURCE, counts: { facilities: facilities.length, sites, skipped: skippedFacilities }, ms };
}

/** Deterministic content-hash input for one facility's campsites (order-independent). */
function hashPayload(sites: RidbCampsite[]): string {
  return sites
    .map((s) => {
      const at = campsiteAttrs(s.ATTRIBUTES);
      return [
        s.CampsiteID,
        s.Loop ?? '',
        s.CampsiteName ?? '',
        mapCampsiteType(s.CampsiteType),
        at.maxRvLengthFt ?? '',
        at.electricAmps ?? '',
        at.hasWater ? 1 : 0,
        at.hasSewer ? 1 : 0,
        at.pullThrough ? 1 : 0,
        s.CampsiteAccessible ? 1 : 0,
        s.CampsiteReservable ? 1 : 0,
      ].join('|');
    })
    .sort()
    .join('\n');
}

/** Bulk-UNWIND upsert of one facility's campsites + a scoped orphan-prune; sets the content hash. */
async function upsertRidbCampsites(
  facilityRidbId: string,
  sites: RidbCampsite[],
  setHash: string,
): Promise<number> {
  const rows = sites.map((s) => {
    const at = campsiteAttrs(s.ATTRIBUTES);
    return {
      id: `ridb:cs:${s.CampsiteID}`,
      loop: s.Loop ?? null,
      number: s.CampsiteName ?? null,
      type: mapCampsiteType(s.CampsiteType),
      maxRvLengthFt: at.maxRvLengthFt,
      electricAmps: at.electricAmps,
      hasWater: at.hasWater,
      hasSewer: at.hasSewer,
      pullThrough: at.pullThrough,
      ada: s.CampsiteAccessible === true,
      reservable: s.CampsiteReservable === true,
    };
  });

  const r = await writeGraph<{ c: number }>(
    `MATCH (c:Campground {ridbId: $facilityRidbId})
     // representative geometry = the campground's location (RIDB campsites have no per-site coords);
     // pitch polygons (OSM camp_pitch, Phase 4) override this in Blob.
     WITH c, c.location AS loc
     UNWIND $rows AS row
     MERGE (s:Campsite {id: row.id})
       SET s.campgroundId = c.id, s.loop = row.loop, s.number = row.number, s.type = row.type,
           s.maxRvLengthFt = row.maxRvLengthFt, s.electricAmps = row.electricAmps,
           s.hasWater = row.hasWater, s.hasSewer = row.hasSewer, s.pullThrough = row.pullThrough,
           s.ada = row.ada, s.reservable = row.reservable,
           s.geometry = coalesce(s.geometry, loc), s.lastSyncedAt = datetime()
     MERGE (c)-[:HAS_SITE]->(s)
     RETURN count(s) AS c`,
    { facilityRidbId, rows },
  );

  // Prune sites that vanished upstream for this facility (scoped, like upsertTrails' orphan prune).
  await writeGraph(
    `MATCH (c:Campground {ridbId: $facilityRidbId})-[:HAS_SITE]->(s:Campsite)
     WHERE NOT s.id IN $ids DETACH DELETE s`,
    { facilityRidbId, ids: rows.map((row) => row.id) },
  );
  // Record the content hash so an unchanged facility is skipped on the next run.
  await writeGraph(`MATCH (c:Campground {ridbId: $facilityRidbId}) SET c.campSyncHash = $hash`, {
    facilityRidbId,
    hash: setHash,
  });
  return r[0]?.c ?? 0;
}
