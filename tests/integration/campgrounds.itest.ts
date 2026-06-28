import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { searchCampgrounds, campgroundDetail, campgroundFacets, campsitesForCampground } from '../../lib/campgrounds';
import { upsertRidbCampgrounds } from '../../lib/sync/sync-campgrounds-ridb';
import { deriveCampNear } from '../../lib/sync/derive-camp-near';
import { setCampPreferences, getCampPreferences, setCampAmenityNeeds, saveCampground, unsaveCampground } from '../../lib/bridges';
import { getUserMemory } from '../../lib/memory-graph';
import { renderMemoryBlock } from '../../lib/memory-block';
import { createTrip, deleteTrip, addStop, addLodgingToStop, removeCampgroundFromStop, getTrip } from '../../lib/trips';
import { upsertOsmCampgrounds } from '../../lib/sync/enrich-camp-osm';
import { resolveCampgrounds } from '../../lib/sync/resolve-campgrounds';
import { deriveBookingDifficulty } from '../../lib/sync/derive-booking-difficulty';
import { appendDigestItem, listDigests } from '../../lib/digest';
import { readGraph } from '../../lib/neo4j';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RidbFacility } from '../../lib/datasources/ridb';
import type { OsmCampRecord } from '../../lib/datasources/osm-camp';

/** Multi-agency campgrounds (Phase 1): RIDB unification, site-level facets, detail, NEAR derivation. */
describeIntegration('Campgrounds data layer (Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
    await deriveCampNear();
  });
  afterAll(async () => {
    // Remove the synthetic dup if a failed unify ever created one (keeps re-runs clean).
    await writeGraph(`MATCH (c:Campground {id:'ridb:232449'}) DETACH DELETE c`);
    await closeDriver();
  });

  it('unifies an NPS campground with its RIDB facility IN PLACE (no duplicate)', async () => {
    const before = (await searchCampgrounds({})).total;
    const facility: RidbFacility = {
      FacilityID: '232449',
      FacilityName: 'Canyon Campground (RIDB)',
      FacilityTypeDescription: 'Campground',
      FacilityLatitude: 44.73,
      FacilityLongitude: -110.49,
      Reservable: true,
      Enabled: true,
      ORGANIZATION: [{ OrgID: '128', OrgName: 'National Park Service' }],
    };
    await upsertRidbCampgrounds([facility]);
    const after = (await searchCampgrounds({})).total;
    expect(after).toBe(before); // enriched cg-canyon in place, no ridb:232449 node
    const detail = await campgroundDetail('cg-canyon');
    expect(detail?.source).toBe('nps+ridb');
    expect(detail?.ridbId).toBe('232449');
  });

  it('filters by agency / dispersed / siteType / amps / site-level ADA', async () => {
    expect((await searchCampgrounds({ agency: 'USFS' })).items.map((c) => c.id)).toEqual(['ridb:999001']);
    expect((await searchCampgrounds({ dispersed: true })).items.map((c) => c.id)).toEqual(['ridb:999001']);
    expect((await searchCampgrounds({ siteType: 'tent' })).items.map((c) => c.id)).toEqual(['cg-canyon']);
    expect((await searchCampgrounds({ minAmps: 30 })).items.some((c) => c.id === 'cg-canyon')).toBe(true);
    expect((await searchCampgrounds({ ada: true })).items.some((c) => c.id === 'cg-canyon')).toBe(true);
  });

  it('answers "near a park" across boundaries (IN_PARK + NEAR)', async () => {
    const near = await searchCampgrounds({ nearParkCode: 'yell' });
    const ids = near.items.map((c) => c.id);
    expect(ids).toContain('cg-canyon'); // IN_PARK, distance 0
    expect(ids).toContain('ridb:999001'); // USFS, via NEAR
    const gallatin = near.items.find((c) => c.id === 'ridb:999001');
    expect(gallatin?.distanceMiles).toBeGreaterThan(0);
  });

  it('campgroundDetail returns sites + agency + maxAmps + NEAR', async () => {
    const d = await campgroundDetail('cg-canyon');
    expect(d?.sites).toHaveLength(2);
    expect(d?.agencyKind).toBe('NPS');
    expect(d?.maxAmps).toBe(30);
    expect((d?.nearParks.length ?? 0)).toBeGreaterThanOrEqual(1);
    const sites = await campsitesForCampground('cg-canyon');
    expect(sites.some((s) => s.type === 'tent' && s.ada)).toBe(true);
  });

  it('facets expose distinct agencies + site types', async () => {
    const f = await campgroundFacets();
    expect(f.agencies).toContain('NPS');
    expect(f.agencies).toContain('USFS');
    expect(f.siteTypes).toEqual(expect.arrayContaining(['tent', 'rv']));
  });
});

/** Camp memory bridges (Phase 3): preferences + amenity needs + saved campgrounds flow into the injected block. */
describeIntegration('Camp memory bridges (Neo4j)', () => {
  const userId = `test-campmem-${randomUUID()}`;
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('setCampPreferences is a partial update (null keeps prior)', async () => {
    await setCampPreferences(userId, { rig: 'rv', maxLengthFt: 28, hookups: '30amp', pets: true, budget: 30 });
    await setCampPreferences(userId, { quiet: true }); // partial — must not wipe rig/maxLengthFt
    const cp = await getCampPreferences(userId);
    expect(cp.rig).toBe('rv');
    expect(cp.maxLengthFt).toBe(28);
    expect(cp.hookups).toBe('30amp');
    expect(cp.pets).toBe(true);
    expect(cp.quiet).toBe(true);
    expect(cp.budget).toBe(30);
  });

  it('camp prefs + saved campgrounds surface in the injected memory block', async () => {
    await setCampAmenityNeeds(userId, ['amen:hookup-30amp', 'amen:dump-station']);
    expect(await saveCampground(userId, 'cg-canyon')).toBe(true);
    const block = renderMemoryBlock(await getUserMemory(userId));
    expect(block).toContain('Camp preferences:');
    expect(block).toContain('28-ft rv');
    expect(block).toContain('Saved campgrounds: Canyon Campground');
    // REQUIRES amenities are honored by the existing travel-constraint readout.
    const mem = await getUserMemory(userId);
    expect(mem.travel.requiredAmenities).toEqual(expect.arrayContaining(['30-amp Hookup', 'Dump Station']));
  });

  it('saveCampground returns false for an unknown id; unsave removes it', async () => {
    expect(await saveCampground(userId, 'no-such-campground')).toBe(false);
    await unsaveCampground(userId, 'cg-canyon');
    const mem = await getUserMemory(userId);
    expect(mem.campHistory.saved.some((c) => c.id === 'cg-canyon')).toBe(false);
  });
});

/** STAYS_AT trip lodging (Phase 3): a campground nested UNDER a park stop, one per stop, in getTrip. */
describeIntegration('Trip lodging — STAYS_AT (Neo4j)', () => {
  const userId = `test-lodging-${randomUUID()}`;
  let tripId: string;
  let stopId: string;

  beforeAll(async () => {
    await seedTestData();
    tripId = await createTrip(userId, { name: 'Yellowstone trip' });
    stopId = (await addStop(userId, tripId, { kind: 'park', refId: 'yell' })) as string;
  });
  afterAll(async () => {
    if (tripId) await deleteTrip(userId, tripId);
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('attaches lodging nested under the stop (not a peer stop)', async () => {
    expect(await addLodgingToStop(userId, tripId, stopId, 'cg-canyon', { nights: 2, date: '2030-07-03' })).toBe(true);
    const trip = await getTrip(userId, tripId);
    const stop = (trip?.stops ?? []).find((s) => s && s.id === stopId);
    expect(stop?.lodging?.id).toBe('cg-canyon');
    expect(stop?.lodging?.nights).toBe(2);
    // Lodging is nested — it did NOT add a second (campground-kind) stop.
    expect((trip?.stops ?? []).filter(Boolean)).toHaveLength(1);
  });

  it('replaces lodging (a stop sleeps in one place)', async () => {
    await addLodgingToStop(userId, tripId, stopId, 'cg-fishing-bridge', { nights: 1 });
    const trip = await getTrip(userId, tripId);
    const stop = (trip?.stops ?? []).find((s) => s && s.id === stopId);
    expect(stop?.lodging?.id).toBe('cg-fishing-bridge'); // prior STAYS_AT cleared
  });

  it('returns false for an unknown campground; remove detaches it', async () => {
    expect(await addLodgingToStop(userId, tripId, stopId, 'no-such-cg')).toBe(false);
    await removeCampgroundFromStop(userId, tripId, stopId, 'cg-fishing-bridge');
    const trip = await getTrip(userId, tripId);
    const stop = (trip?.stops ?? []).find((s) => s && s.id === stopId);
    expect(stop?.lodging).toBeNull();
  });
});

/** Phase 4: OSM ingest + cross-source entity resolution (dedup OSM vs the federal canon). */
describeIntegration('Campground entity resolution (Neo4j)', () => {
  const osm = (over: Partial<OsmCampRecord>): OsmCampRecord => ({
    osmId: over.osmId ?? 'osm:node/1', name: over.name ?? 'X', lat: over.lat ?? 44.73, lng: over.lng ?? -110.49,
    dispersed: over.dispersed ?? false, reservable: over.reservable ?? null, fcfs: over.fcfs ?? null,
    feeUSD: over.feeUSD ?? null, petsAllowed: over.petsAllowed ?? null, amenityIds: over.amenityIds ?? [],
  });

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await writeGraph(`MATCH (c:Campground) WHERE c.source = 'osm' DETACH DELETE c`);
    await closeDriver();
  });

  it('merges a near-coincident OSM duplicate INTO the federal node, retires the OSM node', async () => {
    // An OSM "Canyon Campground" ~20m from cg-canyon (44.73,-110.49) with an amenity.
    await upsertOsmCampgrounds([osm({ osmId: 'osm:node/777', name: 'Canyon Campground', lat: 44.7301, lng: -110.4901, amenityIds: ['amen:shower'] })]);
    // A far, differently-named OSM site that must NOT merge.
    await upsertOsmCampgrounds([osm({ osmId: 'osm:node/888', name: 'Madison Junction', lat: 44.64, lng: -110.86 })]);

    const r = await resolveCampgrounds(250);
    expect(r.merged).toBe(1);

    // The duplicate is gone; cg-canyon absorbed it (confidence raised, sourceIds carries the osmId, amenity relinked).
    expect((await readGraph(`MATCH (c:Campground {id:'osm:node/777'}) RETURN c`)).length).toBe(0);
    const fed = (await readGraph<{ conf: string; sourceIds: string; hasShower: boolean }>(
      `MATCH (c:Campground {id:'cg-canyon'})
       RETURN c.dataConfidence AS conf, c.sourceIds AS sourceIds,
              EXISTS { (c)-[:HAS_AMENITY]->(:Amenity {id:'amen:shower'}) } AS hasShower`,
    ))[0];
    expect(fed.conf).toBe('high');
    expect(fed.sourceIds).toContain('osm:node/777');
    expect(fed.hasShower).toBe(true);

    // The far site survives (no federal neighbour to merge into).
    expect((await readGraph(`MATCH (c:Campground {id:'osm:node/888'}) RETURN c`)).length).toBe(1);
  });
});

/** Phase 1/4: the full searchCampgrounds facet matrix against the seeded fixtures + NEAR/NEAR_TRAILHEAD. */
describeIntegration('searchCampgrounds — full facet matrix (Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
    await deriveCampNear();
  });
  afterAll(async () => {
    await writeGraph(`MATCH (c:Campground {id:'ridb:232449'}) DETACH DELETE c`);
    await closeDriver();
  });

  const ids = async (opts: Parameters<typeof searchCampgrounds>[0]) => (await searchCampgrounds(opts)).items.map((c) => c.id).sort();

  it('amenity facets: dumpStation / showers / drinkingWater / cellReception → cg-canyon', async () => {
    expect(await ids({ dumpStation: true })).toContain('cg-canyon');
    expect(await ids({ showers: true })).toContain('cg-canyon');
    expect(await ids({ drinkingWater: true })).toContain('cg-canyon');
    expect(await ids({ cellReception: true })).toContain('cg-canyon');
  });

  it('free → only the dispersed forest site (feeUSD 0)', async () => {
    expect(await ids({ free: true })).toEqual(['ridb:999001']);
  });

  it('maxPriceUSD ≤ 20 excludes the $35 NPS site + the null-fee one (only the free site qualifies)', async () => {
    expect(await ids({ maxPriceUSD: 20 })).toEqual(['ridb:999001']);
  });

  it('reservable → cg-canyon (the seed sets reservable=true); fcfs → the dispersed site', async () => {
    expect(await ids({ reservable: true })).toContain('cg-canyon');
    expect(await ids({ fcfs: true })).toContain('ridb:999001');
  });

  it('bbox confines to the viewport', async () => {
    const inBox = await ids({ bbox: { minLat: 44, minLng: -111.5, maxLat: 45.2, maxLng: -110 } });
    expect(inBox).toContain('cg-canyon');
    const tiny = await ids({ bbox: { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 } });
    expect(tiny).toEqual([]);
  });

  it('nearTrailId returns campgrounds NEAR that trailhead', async () => {
    const near = await readGraph<{ tid: string }>(`MATCH (:Campground {id:'cg-canyon'})-[:NEAR_TRAILHEAD]->(t:Trail) RETURN t.id AS tid LIMIT 1`);
    expect(near.length).toBeGreaterThan(0);
    expect(await ids({ nearTrailId: near[0].tid })).toContain('cg-canyon');
  });

  it('AND-composes multiple predicates (USFS + dispersed + free → the forest site)', async () => {
    expect(await ids({ agency: 'USFS', dispersed: true, free: true })).toEqual(['ridb:999001']);
    // contradictory combo → empty
    expect(await ids({ agency: 'NPS', dispersed: true })).toEqual([]);
  });

  it('paginates with an accurate total', async () => {
    const page = await searchCampgrounds({ limit: 1, offset: 0 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(3);
  });
});

/** Phase 2: booking-difficulty derive from a (temp) RIDB historical CSV → :Campground stats by ridbId. */
describeIntegration('deriveBookingDifficulty (Neo4j)', () => {
  let csvPath: string;
  beforeAll(async () => {
    await seedTestData(); // cg-canyon has ridbId 232449
    const dir = await mkdtemp(join(tmpdir(), 'ridb-hist-'));
    csvPath = join(dir, 'reservations.csv');
    await writeFile(
      csvPath,
      ['facilityid,orderdate,startdate,nights', '232449,2026-06-01,2026-06-11,2', '232449,2026-06-01,2026-06-12,2', '232449,2026-06-01,2026-06-13,2'].join('\n'),
      'utf8',
    );
  });
  afterAll(async () => {
    delete process.env.RIDB_HISTORICAL_PATH;
    await closeDriver();
  });

  it('no-ops when no file is configured', async () => {
    delete process.env.RIDB_HISTORICAL_PATH;
    expect(await deriveBookingDifficulty()).toMatchObject({ skipped: 1 });
  });

  it('writes median books-out + weekend-fill onto the matching campground', async () => {
    process.env.RIDB_HISTORICAL_PATH = csvPath;
    const r = await deriveBookingDifficulty();
    expect(r.updated).toBeGreaterThanOrEqual(1);
    const rows = await readGraph<{ booksOut: number; fill: number }>(
      `MATCH (c:Campground {ridbId:'232449'}) RETURN c.booksOutDays AS booksOut, c.weekendFillRate AS fill`,
    );
    expect(rows[0].booksOut).toBe(11); // median of 10/11/12-day leads
    expect(rows[0].fill).toBeGreaterThan(0); // 2 of 3 starts are Fri/Sat
  });
});

/** Phase 2: the Camp Watch poller drops alerts into the same in-app digest inbox (appendDigestItem). */
describeIntegration('appendDigestItem (camp-watch inbox)', () => {
  const userId = `test-digest-${randomUUID()}`;
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('appends a campavail item and de-dupes an identical re-poll', async () => {
    const item = { kind: 'campavail' as const, title: 'A site opened', detail: '2 newly-open at Canyon', tone: 'good' as const };
    await appendDigestItem(userId, item);
    await appendDigestItem(userId, item); // identical → deduped
    const digests = await listDigests(userId);
    const today = digests[0];
    expect(today.items.filter((i) => i.kind === 'campavail')).toHaveLength(1);
    expect(today.items[0].title).toBe('A site opened');
  });
});
