import { readGraph, writeGraph } from '../neo4j';
import { fetchCampgroundsOSM, bboxAround, type OsmCampRecord } from '../datasources/osm-camp';

/**
 * OSM campground enrichment (Campgrounds feature, Phase 4 reach; gated `ENRICH_OSM_CAMP=1`). Fetches
 * `tourism=camp_site|caravan_site|camp_pitch` around each park (state/private/dispersed coverage the federal
 * APIs lack) and upserts them as SEPARATE `osm:<id>` :Campground nodes (`source='osm'`, ODbL). They are
 * never auto-merged with federal sites — the gated `resolve-campgrounds` step dedups them by name+geodistance.
 * Polite + bounded (one Overpass call per park, delay between calls); degrades gracefully (per-park `[]`).
 */
export async function enrichCampgroundsOSM(): Promise<{ parks: number; campgrounds: number }> {
  const parks = await readGraph<{ parkCode: string; lat: number; lng: number }>(
    `MATCH (p:Park) WHERE p.location IS NOT NULL
     RETURN p.parkCode AS parkCode, p.location.latitude AS lat, p.location.longitude AS lng ORDER BY p.parkCode`,
  );
  let campgrounds = 0;
  let parksDone = 0;
  for (const p of parks) {
    const records = await fetchCampgroundsOSM(bboxAround(p.lat, p.lng));
    if (records.length) campgrounds += await upsertOsmCampgrounds(records);
    parksDone += 1;
    await new Promise((r) => setTimeout(r, 1200)); // be polite to the public Overpass endpoint
  }
  return { parks: parksDone, campgrounds };
}

export async function upsertOsmCampgrounds(records: OsmCampRecord[]): Promise<number> {
  if (!records.length) return 0;
  const rows = records.map((r) => ({
    ...r,
    sourceIds: JSON.stringify({ ridbId: null, osmId: r.osmId }),
  }));
  const res = await writeGraph<{ c: number }>(
    `UNWIND $rows AS row
     MERGE (c:Campground {id: row.osmId})
       SET c.osmId = row.osmId, c.name = coalesce(c.name, row.name), c.source = 'osm',
           c.dispersed = row.dispersed, c.reservable = row.reservable, c.fcfs = row.fcfs,
           c.feeUSD = row.feeUSD, c.petsAllowed = row.petsAllowed, c.agency = 'PRIVATE',
           c.dataConfidence = coalesce(c.dataConfidence, 'medium'), c.sourceIds = row.sourceIds,
           c.location = point({latitude: row.lat, longitude: row.lng}), c.lastSyncedAt = datetime()
     MERGE (ag:Agency {id: 'agency:osm'}) SET ag.name = 'OpenStreetMap (community, ODbL)', ag.kind = 'PRIVATE'
     MERGE (c)-[:MANAGED_BY]->(ag)
     WITH c, row
     // unit subquery — empty amenityIds is a no-op (does NOT drop the campground row)
     CALL { WITH c, row UNWIND row.amenityIds AS aid
            MERGE (am:Amenity {id: aid}) ON CREATE SET am.camp = true
            MERGE (c)-[:HAS_AMENITY]->(am) }
     RETURN count(c) AS c`,
    { rows },
  );
  return res[0]?.c ?? 0;
}
