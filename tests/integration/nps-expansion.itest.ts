import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph, readGraph } from '../../lib/neo4j';
import {
  thematicTrail,
  peopleForPark,
  trailThemes,
  toursForPark,
  stampsForPark,
  eventsForPark,
  placesForPark,
  articlesForPark,
  parkingForPark,
  searchParks,
  facets,
} from '../../lib/queries';
import {
  upsertPlaces,
  upsertPeople,
  upsertTours,
  upsertPassportStamps,
  upsertParkingLots,
  upsertArticles,
} from '../../lib/sync/upserts';

/**
 * NPS-expansion domain layer (Phases 1/3/5): the new node/edge reads (places, people, tours, stamps,
 * events, articles, parking, amenity facets) against the seeded fixtures, plus upsert round-trips that
 * exercise the hand-written MERGE Cypher (guarded `AT` matches, tag→Topic bridging). Self-skips without
 * RUN_INTEGRATION=1 + a reachable Neo4j (safety rail in db.ts).
 */
describeIntegration('NPS expansion domain (Neo4j)', () => {
  // Distinct ids so upsert round-trips never clobber the shared seed; cleaned up in afterAll.
  const UPSERT_IDS = ['itest-place-1', 'itest-person-1', 'itest-tour-1', 'itest-tour-1-0', 'itest-stamp-1', 'itest-lot-1', 'itest-article-1'];

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await writeGraph(
      `UNWIND $ids AS id MATCH (n {id: id}) DETACH DELETE n`,
      { ids: UPSERT_IDS },
    ).catch(() => {});
    await closeDriver();
  });

  // ── Thematic trails (P0 #2) ──────────────────────────────────────────────
  it('thematicTrail(person) traverses ASSOCIATED_WITH to every park a figure touches', async () => {
    const trail = await thematicTrail({ person: 'Hayden' });
    const codes = trail.map((p) => p.parkCode);
    expect(codes).toEqual(expect.arrayContaining(['yell', 'glac'])); // seeded: Ferdinand Hayden → yell + glac
    expect(trail.every((p) => p.via === 'Ferdinand Hayden')).toBe(true);
  });

  it('thematicTrail(topic) returns parks sharing a topic', async () => {
    const trail = await thematicTrail({ topic: 'Volcanoes' });
    expect(trail.map((p) => p.parkCode)).toContain('yell');
    expect(trail.every((p) => p.via === 'Volcanoes')).toBe(true);
  });

  it('peopleForPark + trailThemes surface multi-park figures', async () => {
    const people = await peopleForPark('yell');
    expect(people.some((p) => p.title === 'Ferdinand Hayden')).toBe(true);

    const themes = await trailThemes();
    const hayden = themes.people.find((p) => p.title === 'Ferdinand Hayden');
    expect(hayden).toBeTruthy();
    expect(hayden!.parks).toBeGreaterThanOrEqual(2);
  });

  // ── Tours (P1 #3) ────────────────────────────────────────────────────────
  it('toursForPark returns a tour with its stop count', async () => {
    const tours = await toursForPark('yell');
    const t = tours.find((x) => x.id === 'tour-canyon-rim');
    expect(t).toBeTruthy();
    expect(t!.stops).toBe(2);
  });

  // ── Passport stamps (P2 #8) ──────────────────────────────────────────────
  it('stampsForPark lists the park stamp, uncollected for an anonymous user', async () => {
    const stamps = await stampsForPark('yell', null);
    const s = stamps.find((x) => x.id === 'stamp-yell-canyon');
    expect(s).toBeTruthy();
    expect(s!.collected).toBe(false);
    expect(s!.label).toBe('Canyon Village');
  });

  // ── Events / season (P2 #7) ──────────────────────────────────────────────
  it('eventsForPark flags events that fall inside the travel window', async () => {
    const inside = await eventsForPark('yell', { start: '2026-08-10', end: '2026-08-14' });
    const ev = inside.find((e) => e.id === 'event-yell-astro');
    expect(ev).toBeTruthy();
    expect(ev!.inWindow).toBe(true);

    const outside = await eventsForPark('yell', { start: '2026-01-01', end: '2026-01-07' });
    expect(outside.find((e) => e.id === 'event-yell-astro')!.inWindow).toBe(false);
  });

  // ── Media / content / parking (P3 + P5) ──────────────────────────────────
  it('placesForPark returns POIs with audio description + stamp flag', async () => {
    const places = await placesForPark('yell');
    const artist = places.find((p) => p.id === 'place-artist-point');
    expect(artist).toBeTruthy();
    expect(artist!.audioDescription).toBeTruthy();
    expect(artist!.isStamp).toBe(true);
  });

  it('articlesForPark and parkingForPark return park-scoped content', async () => {
    const articles = await articlesForPark('yell');
    expect(articles.some((a) => a.id === 'article-yell-geysers' && !!a.url)).toBe(true);

    const parking = await parkingForPark('yell');
    const lot = parking.find((p) => p.id === 'lot-canyon');
    expect(lot).toBeTruthy();
    expect(lot!.wheelchairAccessible).toBe(true);
  });

  // ── Amenity facets (P1 #5) ───────────────────────────────────────────────
  it('searchParks filters by an amenity on a park child node', async () => {
    const { items } = await searchParks({ amenity: 'Accessible Restrooms' });
    const codes = items.map((p) => p.parkCode);
    expect(codes).toContain('yell'); // its Place/VC/Campground HAS_AMENITY Accessible Restrooms
    expect(codes).not.toContain('grca');
  });

  it('facets expose only amenities actually wired to a child node', async () => {
    const f = await facets();
    expect(f.amenities).toEqual(expect.arrayContaining(['Accessible Restrooms', 'Potable Water']));
  });

  // ── Upsert round-trips (Phase 1 ingestion Cypher) ────────────────────────
  it('upsertPlaces links a POI to its related park with HAS_PLACE', async () => {
    const n = await upsertPlaces([
      {
        id: 'itest-place-1',
        title: 'Test Overlook',
        latitude: '36.1',
        longitude: '-112.1',
        audioDescription: 'An audio description.',
        isPassportStampLocation: 'true',
        tags: ['Geology'],
        relatedParks: [{ parkCode: 'grca' }],
      },
    ]);
    expect(n).toBe(1);
    const rows = await readGraph<{ ok: boolean; stamp: boolean }>(
      `MATCH (p:Park {parkCode:'grca'})-[:HAS_PLACE]->(pl:Place {id:'itest-place-1'})
       RETURN true AS ok, pl.isStamp AS stamp`,
    );
    expect(rows[0]?.ok).toBe(true);
    expect(rows[0]?.stamp).toBe(true);
  });

  it('upsertPeople bridges a tag to a matching Topic via RELATES_TO_TOPIC', async () => {
    await upsertPeople([
      {
        id: 'itest-person-1',
        title: 'Test Naturalist',
        tags: ['Volcanoes'], // matches the seeded Topic name
        relatedParks: [{ parkCode: 'yell' }],
      },
    ]);
    const rows = await readGraph<{ assoc: boolean; topic: boolean }>(
      `MATCH (per:Person {id:'itest-person-1'})
       RETURN EXISTS { (per)-[:ASSOCIATED_WITH]->(:Park {parkCode:'yell'}) } AS assoc,
              EXISTS { (per)-[:RELATES_TO_TOPIC]->(:Topic {name:'Volcanoes'}) } AS topic`,
    );
    expect(rows[0]?.assoc).toBe(true);
    expect(rows[0]?.topic).toBe(true);
  });

  it('upsertTours builds the ordered HAS_STOP path with a guarded AT to a Place', async () => {
    await upsertTours([
      {
        id: 'itest-tour-1',
        title: 'Test Tour',
        relatedParks: [{ parkCode: 'grca' }],
        stops: [{ id: 'itest-tour-1-0', ordinal: '0', assetType: 'Place', assetId: 'itest-place-1', title: 'Stop A' }],
      },
    ]);
    const rows = await readGraph<{ inPark: boolean; at: boolean; ordinal: number }>(
      `MATCH (tr:Tour {id:'itest-tour-1'})-[:HAS_STOP]->(ts:TourStop {id:'itest-tour-1-0'})
       RETURN EXISTS { (tr)-[:IN_PARK]->(:Park {parkCode:'grca'}) } AS inPark,
              EXISTS { (ts)-[:AT]->(:Place {id:'itest-place-1'}) } AS at, ts.ordinal AS ordinal`,
    );
    expect(rows[0]?.inPark).toBe(true);
    expect(rows[0]?.at).toBe(true);
    expect(rows[0]?.ordinal).toBe(0);
  });

  it('upsertPassportStamps, upsertParkingLots, upsertArticles attach to a park', async () => {
    await upsertPassportStamps([{ id: 'itest-stamp-1', label: 'Test Stamp', parks: [{ parkCode: 'grca' }] }]);
    await upsertParkingLots([{ id: 'itest-lot-1', name: 'Test Lot', relatedParks: [{ parkCode: 'grca' }], accessibility: { isLotAccessibleToDisabled: true } }]);
    await upsertArticles([{ id: 'itest-article-1', title: 'Test Article', url: 'http://x', relatedParks: [{ parkCode: 'grca' }] }]);
    const rows = await readGraph<{ stamp: boolean; lot: boolean; article: boolean; lotAccessible: boolean }>(
      `MATCH (p:Park {parkCode:'grca'})
       OPTIONAL MATCH (l:ParkingLot {id:'itest-lot-1'})
       RETURN EXISTS { (:PassportStamp {id:'itest-stamp-1'})-[:IN_PARK]->(p) } AS stamp,
              EXISTS { (:ParkingLot {id:'itest-lot-1'})-[:IN_PARK]->(p) } AS lot,
              EXISTS { (:Article {id:'itest-article-1'})-[:ABOUT]->(p) } AS article,
              coalesce(l.wheelchairAccessible, false) AS lotAccessible`,
    );
    expect(rows[0]?.stamp).toBe(true);
    expect(rows[0]?.lot).toBe(true);
    expect(rows[0]?.article).toBe(true);
    expect(rows[0]?.lotAccessible).toBe(true);
  });
});
