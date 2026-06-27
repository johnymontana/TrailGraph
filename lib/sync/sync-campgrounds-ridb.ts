import { writeGraph } from '../neo4j';
import {
  mapAgencyKind,
  facilityAttrs,
  type RidbFacility,
} from '../datasources/ridb';

/**
 * RIDB Facilities → :Campground (multi-agency, Campgrounds feature, Phase 1). The upsert is a
 * UNIFICATION: an NPS-origin campground already keyed to this RIDB facility (via ridbId, parsed from its
 * recreation.gov URL by datasources/recreation.ts#applyReservations) is enriched IN PLACE — one node per
 * facility, never a duplicate. A facility with no NPS twin gets a canonical `ridb:<FacilityID>` id.
 *
 * Driven by `pagedExternalStep('campgrounds-ridb', …)` in lib/sync/index.ts, which handles the
 * `:SyncState` cursor + RIDB-rate-limit pause/resume. This module only knows how to upsert a page.
 */
export async function upsertRidbCampgrounds(batch: RidbFacility[]): Promise<number> {
  const rows = batch
    .filter((f) => f.FacilityTypeDescription === 'Campground' && f.Enabled !== false)
    .map((f) => {
      const org = f.ORGANIZATION?.[0];
      const rec = f.RECAREA?.[0];
      const reservable = f.Reservable === true;
      const fa = facilityAttrs(f.ATTRIBUTES);
      return {
        ridbId: f.FacilityID,
        canonicalId: `ridb:${f.FacilityID}`,
        name: f.FacilityName,
        lat: f.FacilityLatitude ?? f.GEOJSON?.COORDINATES?.[1] ?? null,
        lng: f.FacilityLongitude ?? f.GEOJSON?.COORDINATES?.[0] ?? null,
        reservationUrl: f.FacilityReservationURL ?? null,
        reservable,
        // RIDB has no explicit facility-level FCFS flag; treat non-reservable facilities as first-come.
        fcfs: !reservable,
        agencyKind: mapAgencyKind(org?.OrgName),
        agencyId: org ? `agency:${org.OrgID}` : 'agency:unknown',
        agencyName: org?.OrgName ?? 'Unknown',
        recAreaId: rec ? `recarea:${rec.RecAreaID}` : null,
        recAreaName: rec?.RecAreaName ?? null,
        petsAllowed: fa.petsAllowed,
        feeUSD: fa.feeUSD,
        cellReception: fa.cellReception,
        sourceIds: JSON.stringify({ ridbId: f.FacilityID, osmId: null }),
      };
    });
  if (!rows.length) return 0;

  const r = await writeGraph<{ c: number }>(
    `UNWIND $rows AS row
     // Federation: reuse the NPS campground already keyed to this RIDB facility (via ridbId), else create
     // the canonical RIDB node. MERGE accepts the resolved id as a bound variable.
     OPTIONAL MATCH (existing:Campground {ridbId: row.ridbId})
     WITH row, coalesce(existing.id, row.canonicalId) AS mergeId
     MERGE (c:Campground {id: mergeId})
       SET c.ridbId = row.ridbId,
           c.name = coalesce(c.name, row.name),
           c.reservationUrl = coalesce(c.reservationUrl, row.reservationUrl),
           c.reservable = row.reservable,
           c.fcfs = row.fcfs,
           c.agency = row.agencyKind,
           c.sourceIds = row.sourceIds,
           c.petsAllowed = coalesce(row.petsAllowed, c.petsAllowed),
           c.feeUSD = coalesce(row.feeUSD, c.feeUSD),
           c.cellReception = coalesce(c.cellReception, row.cellReception),
           // A RIDB-canonical node is 'ridb'; a unified NPS node records the federation as 'nps+ridb'.
           c.source = CASE WHEN c.id STARTS WITH 'ridb:' THEN 'ridb' ELSE 'nps+ridb' END,
           c.location = CASE WHEN row.lat IS NOT NULL AND row.lng IS NOT NULL
                             THEN point({latitude: row.lat, longitude: row.lng}) ELSE c.location END,
           c.lastSyncedAt = datetime()
     // Managing agency (always) + rec area (federal, outside a park unit).
     MERGE (ag:Agency {id: row.agencyId}) SET ag.name = row.agencyName, ag.kind = row.agencyKind
     MERGE (c)-[:MANAGED_BY]->(ag)
     WITH c, row WHERE row.recAreaId IS NOT NULL
     MERGE (ra:RecArea {id: row.recAreaId}) SET ra.name = row.recAreaName
     MERGE (c)-[:IN_RECAREA]->(ra)
     RETURN count(c) AS c`,
    { rows },
  );
  return r[0]?.c ?? 0;
}
