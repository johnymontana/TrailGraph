import '../lib/load-env';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse';
import { writeGraph, closeDriver } from '../lib/neo4j';
import { applyReservations } from '../lib/datasources/recreation';
import { upsertRidbCampgrounds } from '../lib/sync/sync-campgrounds-ridb';
import { upsertRidbCampsites } from '../lib/sync/sync-campsites-ridb';
import { deriveCampNear } from '../lib/sync/derive-camp-near';
import { contentHash } from '../lib/embeddings';
import type { RidbFacility, RidbCampsite } from '../lib/datasources/ridb';

/**
 * Offline initial database load from the full RIDB export (Campgrounds feature). Reads the CSV export in
 * `data/RIDBFullExport_V1_CSV/` (override with `RIDB_EXPORT_DIR`) and bulk-loads ~5,754 campgrounds + ~130k
 * campsites WITHOUT the live API's rate-limit pause/resume. Reshapes the flat, normalized CSV rows into the
 * API record shapes (`RidbFacility` / `RidbCampsite`) the existing upserts already accept, so the graph
 * model, the `ridbId` federation (NPS campgrounds unify in place), and the mappers are all REUSED:
 *   - `upsertRidbCampgrounds` (federation MERGE-by-ridbId)
 *   - `upsertRidbCampsites`   (HAS_SITE + scoped orphan-prune; `campsiteAttrs`/`mapCampsiteType` parse attrs)
 *   - `deriveCampNear`        (NEAR → :Park, NEAR_TRAILHEAD → :Trail)
 *
 * Complements (does NOT replace) the live `SYNC_CAMPGROUNDS` sync, which still runs for nightly
 * LastUpdatedDate deltas. Run once by an operator:
 *
 *   NEO4J_URI=… NEO4J_USERNAME=… NEO4J_PASSWORD=… RIDB_EXPORT_DIR=data/RIDBFullExport_V1_CSV pnpm campgrounds:load
 *
 * Idempotent (MERGE-by-id + the orphan-prune). Requires parks to already exist for the NEAR derivation.
 */

const DIR = process.env.RIDB_EXPORT_DIR || join(process.cwd(), 'data', 'RIDBFullExport_V1_CSV');
// The JSON sibling export — read the small Organizations/RecAreas from JSON (unambiguous; csv-parse drops
// rows on RecAreas' multiline descriptions). Facilities/Campsites/CampsiteAttributes stream from CSV (they
// parse correctly + the 95MB attributes file streams). Override with RIDB_EXPORT_JSON_DIR.
const JSON_DIR = process.env.RIDB_EXPORT_JSON_DIR || DIR.replace(/_CSV$/, '_JSON');
const BATCH = 1000;

const num = (s: string | undefined): number | undefined => {
  const n = Number(s);
  return Number.isFinite(n) && s !== '' ? n : undefined;
};
const bool = (s: string | undefined): boolean => String(s ?? '').toLowerCase() === 'true';

/** Stream a CSV file as header-keyed records (RFC-4180 quoting + multiline, BOM-tolerant). */
async function* rows(file: string): AsyncGenerator<Record<string, string>> {
  const parser = createReadStream(join(DIR, file)).pipe(
    parse({ columns: true, skip_empty_lines: true, bom: true, relax_quotes: true, relax_column_count: true }),
  );
  for await (const r of parser) yield r as Record<string, string>;
}

/** Read a `{RECDATA:[…]}` JSON export file fully (small files only — orgs/recareas). */
async function recdata(file: string): Promise<Record<string, string>[]> {
  const j = JSON.parse(await readFile(join(JSON_DIR, file), 'utf8')) as { RECDATA?: Record<string, string>[] };
  return j.RECDATA ?? [];
}

async function main() {
  console.log(`[load] RIDB export from ${DIR}`);

  // 0. Federation: NPS campgrounds must carry ridbId BEFORE the campground upsert so they unify in place
  //    (else we'd create ridb:* duplicates that only self-heal on a later run).
  console.log('[load] applyReservations (NPS ridbId for federation)…');
  console.log('   applied', await applyReservations());

  // 1. Small in-memory lookups (from JSON — unambiguous). RecAreas carry the managing ParentOrgID: a
  //    facility's ParentOrgID points at a sub-org NOT in the 31-row Organizations table, but its RecArea's
  //    ParentOrgID resolves to the real top-level agency for ~97% of campgrounds.
  const orgs = new Map<string, { name: string; type: string }>();
  for (const r of await recdata('Organizations_API_v1.json')) orgs.set(r.OrgID, { name: r.OrgName, type: r.OrgType });
  const recAreas = new Map<string, { name: string; parentOrgID: string }>();
  for (const r of await recdata('RecAreas_API_v1.json')) recAreas.set(r.RecAreaID, { name: r.RecAreaName, parentOrgID: r.ParentOrgID });
  console.log(`[load] lookups: orgs=${orgs.size} recAreas=${recAreas.size}`);

  // 2. Campgrounds: filter to Campground-typed + enabled, reshape → RidbFacility, batch-upsert.
  const campgroundFacilityIds = new Set<string>();
  let cgCount = 0;
  let batch: RidbFacility[] = [];
  const flush = async () => {
    if (batch.length) {
      cgCount += await upsertRidbCampgrounds(batch);
      batch = [];
    }
  };
  for await (const r of rows('Facilities_API_v1.csv')) {
    if (r.FacilityTypeDescription !== 'Campground' || !bool(r.Enabled)) continue;
    campgroundFacilityIds.add(r.FacilityID);
    const rec = r.ParentRecAreaID ? recAreas.get(r.ParentRecAreaID) : undefined;
    // Resolve the managing org via the RecArea (the reliable signal), falling back to the facility's own
    // ParentOrgID; unresolved → no ORGANIZATION (agency 'PRIVATE'/unknown, honest).
    const orgId = rec && orgs.has(rec.parentOrgID) ? rec.parentOrgID : orgs.has(r.ParentOrgID) ? r.ParentOrgID : null;
    const org = orgId ? orgs.get(orgId)! : undefined;
    batch.push({
      FacilityID: r.FacilityID,
      FacilityName: r.FacilityName,
      FacilityTypeDescription: 'Campground',
      FacilityLatitude: num(r.FacilityLatitude),
      FacilityLongitude: num(r.FacilityLongitude),
      FacilityReservationURL: r.FacilityReservationURL || undefined,
      FacilityPhone: r.FacilityPhone || undefined,
      Reservable: bool(r.Reservable),
      Enabled: true,
      LastUpdatedDate: r.LastUpdatedDate || undefined,
      ORGANIZATION: org && orgId ? [{ OrgID: orgId, OrgName: org.name, OrgType: org.type }] : undefined,
      RECAREA: rec ? [{ RecAreaID: r.ParentRecAreaID, RecAreaName: rec.name }] : undefined,
    });
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  console.log(`[load] campgrounds upserted=${cgCount} (of ${campgroundFacilityIds.size} campground facilities)`);

  // 3. Campsites under those campgrounds → group by facility; index by id for attribute attachment.
  const sitesByFacility = new Map<string, RidbCampsite[]>();
  const siteById = new Map<string, RidbCampsite>();
  for await (const r of rows('Campsites_API_v1.csv')) {
    if (!campgroundFacilityIds.has(r.FacilityID)) continue;
    const site: RidbCampsite = {
      CampsiteID: r.CampsiteID,
      FacilityID: r.FacilityID,
      CampsiteName: r.CampsiteName || undefined,
      CampsiteType: r.CampsiteType || undefined,
      TypeOfUse: r.TypeOfUse || undefined,
      Loop: r.Loop || undefined,
      CampsiteAccessible: bool(r.CampsiteAccessible),
      ATTRIBUTES: [],
    };
    siteById.set(r.CampsiteID, site);
    const arr = sitesByFacility.get(r.FacilityID);
    if (arr) arr.push(site);
    else sitesByFacility.set(r.FacilityID, [site]);
  }
  console.log(`[load] campsites=${siteById.size} under ${sitesByFacility.size} campgrounds`);

  // 4. Campsite attributes (the 2.4M-row EAV table) — stream ONCE, attach to the relevant sites.
  let attrCount = 0;
  for await (const r of rows('CampsiteAttributes_API_v1.csv')) {
    if (r.EntityType !== 'Campsite') continue;
    const s = siteById.get(r.EntityID);
    if (!s) continue;
    s.ATTRIBUTES!.push({ AttributeName: r.AttributeName, AttributeValue: r.AttributeValue });
    attrCount++;
  }
  console.log(`[load] attributes attached=${attrCount}`);

  // 5. Upsert campsites per facility (reuses the live-sync upsert + scoped orphan-prune + the attr mappers).
  let siteCount = 0;
  let fi = 0;
  for (const [facilityRidbId, sites] of sitesByFacility) {
    const overnight = sites.filter((s) => (s.TypeOfUse ?? 'Overnight') === 'Overnight');
    if (!overnight.length) continue;
    siteCount += await upsertRidbCampsites(facilityRidbId, overnight, contentHash(`${facilityRidbId}:${overnight.length}`));
    if (++fi % 500 === 0) console.log(`   …${fi}/${sitesByFacility.size} facilities, ${siteCount} sites`);
  }
  console.log(`[load] campsites upserted=${siteCount}`);

  // 6. Materialize NEAR / NEAR_TRAILHEAD (needs :Park, and :Trail for trailhead edges).
  console.log('[load] derive-camp-near…');
  console.log('   ', JSON.stringify(await deriveCampNear()));

  // 7. Mark the API-path resources fresh so the slow sync's `recentlyOk` skip won't immediately re-pull.
  for (const resource of ['camp-ridbids', 'campgrounds-ridb', 'campsites-ridb', 'derive-camp-near']) {
    await writeGraph(
      `MERGE (s:SyncState {resource:$resource})
       SET s.tier='slow', s.lastStatus='ok', s.lastRunAt=datetime(), s.lastCounts=$counts`,
      { resource, counts: JSON.stringify({ source: 'export', campgrounds: cgCount, campsites: siteCount }) },
    );
  }

  await closeDriver();
  console.log(`✓ loaded ${cgCount} campgrounds + ${siteCount} campsites from the RIDB export`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
