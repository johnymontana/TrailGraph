import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph, readGraph } from '../../lib/neo4j';
import {
  checkOpen,
  tripBudget,
  accessibilityScorecard,
  parkDetail,
  newsForPark,
  searchArticles,
  parkingForPark,
  parksWithEventOn,
  eventsForPark,
  searchParks,
  closureWarningsForTrip,
  parksInRegion,
} from '../../lib/queries';
import {
  upsertCampgrounds,
  upsertEntranceFees,
  upsertParks,
  extractCampsiteInventory,
} from '../../lib/sync/upserts';
import { setAccessibilityNeeds, clearAccessibilityNeeds, getTravelConstraints, clearTravelConstraints } from '../../lib/bridges';
import { applyRegions } from '../../lib/datasources/regions';
import { applyAccessibilityTaxonomy } from '../../lib/datasources/accessibility';
import { deriveNear } from '../../lib/sync/derive-near';
import { deriveSharedEdges } from '../../lib/sync/derive-shared';

/**
 * NPS data-features domain layer (plan F1–F10 + bonuses): the new graph reads (hours/open-closed, fees +
 * budget, campground inventory + the fixed HAS_AMENITY edge, events/recurrence, accessibility scorecard,
 * thing-to-do facets, news + article search, regions/NEAR, parking) against the seeded fixtures, plus
 * upsert/derivation round-trips that exercise the hand-written Cypher. Self-skips without RUN_INTEGRATION=1
 * + a reachable Neo4j (safety rail in db.ts).
 */
describeIntegration('NPS data features (Neo4j)', () => {
  const TEMP_PARKS = ['itest-np-1', 'itest-np-2', 'itest-edge'];
  const TEMP_IDS = ['itest-cg-1'];
  const TEMP_USER = 'itest-user-a11y';

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await writeGraph(`UNWIND $codes AS c MATCH (p:Park {parkCode: c}) DETACH DELETE p`, { codes: TEMP_PARKS }).catch(() => {});
    await writeGraph(`UNWIND $ids AS id MATCH (n {id: id}) DETACH DELETE n`, { ids: TEMP_IDS }).catch(() => {});
    await clearTravelConstraints(TEMP_USER).catch(() => {});
    await writeGraph(`MATCH (u:User {userId:$u}) DETACH DELETE u`, { u: TEMP_USER }).catch(() => {});
    await closeDriver();
  });

  // ── F1: operating hours & open/closed ────────────────────────────────────
  it('checkOpen reports a park open on a date and surfaces its dated closure summary', async () => {
    const winter = await checkOpen('yell', '2026-12-15');
    expect(winter).toBeTruthy();
    expect(winter!.state).toBe('open'); // Park Hours are All Day; only a road closes in winter
    expect(winter!.closureSummary).toMatch(/North Entrance Road/);

    const summer = await checkOpen('yell', '2026-07-15');
    expect(summer!.state).toBe('open');
  });

  it('checkOpen flags a national fee-free day', async () => {
    const res = await checkOpen('yell', '2026-08-04');
    expect(res!.feeFree?.name).toMatch(/Great American Outdoors Act/);
  });

  it('parkDetail surfaces the seasonal closure summary + derived open seasons + hours nodes', async () => {
    const p = await parkDetail('yell');
    expect(p!.seasonalClosureSummary).toMatch(/North Entrance Road/);
    expect(p!.openSeasons).toEqual(expect.arrayContaining(['summer', 'winter']));
    const hours = await readGraph<{ n: number }>(
      `MATCH (:Park {parkCode:'yell'})-[:HAS_HOURS]->(:OperatingHours)-[:HAS_EXCEPTION]->(e:HoursException)
       RETURN count(e) AS n`,
    );
    expect(hours[0].n).toBeGreaterThanOrEqual(1);
  });

  // ── F2: fees & budget ────────────────────────────────────────────────────
  it('upsertEntranceFees derives CHARGES->(:EntranceFee {unit}) from the park JSON', async () => {
    await upsertEntranceFees();
    const rows = await readGraph<{ unit: string; cost: number }>(
      `MATCH (:Park {parkCode:'yell'})-[:CHARGES]->(f:EntranceFee) RETURN f.unit AS unit, f.cost AS cost`,
    );
    expect(rows.some((r) => r.unit === 'vehicle' && r.cost === 35)).toBe(true);
  });

  it('tripBudget sums per-vehicle fees and compares to the annual pass; fee-free parks contribute 0', async () => {
    const b = await tripBudget(['yell', 'grca'], 'vehicle');
    const yell = b.parks.find((p) => p.parkCode === 'yell');
    const grca = b.parks.find((p) => p.parkCode === 'grca');
    expect(yell!.fee).toBe(35);
    expect(grca!.feeFree).toBe(true);
    expect(grca!.fee).toBe(0);
    expect(b.total).toBe(35);
    expect(b.atbCost).toBe(80);
    expect(b.atbSaves).toBe(false); // $35 < $80 annual pass
  });

  // ── F3: campground inventory + the fixed dead HAS_AMENITY edge ────────────
  it('upsertCampgrounds writes inventory props + a HAS_AMENITY edge to a canonical amenity', async () => {
    await upsertCampgrounds([
      {
        id: 'itest-cg-1',
        name: 'Test Hookup CG',
        parkCode: 'grca',
        campsites: { totalSites: '50', electricalHookups: '50', group: '2' },
        amenities: { dumpStation: 'Yes', showers: ['Yes'] },
      },
    ]);
    const rows = await readGraph<{ electric: number; hookups: boolean; dump: boolean }>(
      `MATCH (c:Campground {id:'itest-cg-1'})
       RETURN c.electricSites AS electric, c.hasHookups AS hookups,
              EXISTS { (c)-[:HAS_AMENITY]->(:Amenity {name:'Dump Station'}) } AS dump`,
    );
    expect(rows[0].electric).toBe(50);
    expect(rows[0].hookups).toBe(true);
    expect(rows[0].dump).toBe(true);
  });

  it('searchParks amenity facet now matches a campground amenity (dead-edge fix)', async () => {
    const { items } = await searchParks({ amenity: 'Dump Station' });
    expect(items.map((p) => p.parkCode)).toContain('yell'); // seeded cg-canyon HAS_AMENITY Dump Station
  });

  // ── F4: events, types, materialized calendar dates ───────────────────────
  it('eventsForPark returns enriched events; parksWithEventOn traverses OCCURS_ON + OF_TYPE', async () => {
    const events = await eventsForPark('yell');
    const astro = events.find((e) => e.id === 'event-yell-astro');
    expect(astro!.isFree).toBe(true);
    expect(astro!.types).toContain('Astronomy');

    const parks = await parksWithEventOn('2026-08-12', 'Astronomy');
    expect(parks.map((p) => p.parkCode)).toContain('yell');
    // a date with no event returns nothing
    expect((await parksWithEventOn('2026-03-03', 'Astronomy')).length).toBe(0);
  });

  // ── F5: accessibility scorecard + REQUIRES bridge (reuse :Amenity) ────────
  it('accessibilityScorecard aggregates reported features across a park\'s children', async () => {
    await applyAccessibilityTaxonomy();
    const sc = await accessibilityScorecard('yell');
    expect(sc!.features).toEqual(expect.arrayContaining(['Wheelchair Accessible']));
    expect(sc!.accessibleCampgrounds).toBeGreaterThanOrEqual(1);
    expect(sc!.audioDescribedPlaces).toBeGreaterThanOrEqual(1); // Artist Point has an audio description
  });

  it('setAccessibilityNeeds writes REQUIRES->(:Amenity) read back by getTravelConstraints; clear removes them', async () => {
    await setAccessibilityNeeds(TEMP_USER, ['amen:wheelchair-accessible', 'amen:braille']);
    const c = await getTravelConstraints(TEMP_USER);
    expect(c.requiredAmenities).toEqual(expect.arrayContaining(['Wheelchair Accessible', 'Braille']));
    // P2-2: clearing accessibility needs removes those REQUIRES edges.
    await clearAccessibilityNeeds(TEMP_USER);
    const after = await getTravelConstraints(TEMP_USER);
    expect(after.requiredAmenities).not.toContain('Braille');
    expect(after.requiredAmenities).not.toContain('Wheelchair Accessible');
  });

  // ── F7: thing-to-do facets ───────────────────────────────────────────────
  it('parkDetail exposes ThingToDo facets (pets/season/duration)', async () => {
    const p = await parkDetail('grca');
    const ttd = p!.thingsToDo.find((t) => t.id === 'ttd-rim');
    expect(ttd!.petsAllowed).toBe(true);
    expect(ttd!.season).toEqual(expect.arrayContaining(['summer']));
    expect(ttd!.durationText).toBe('1-2 hours');
  });

  // ── F8: news + article full-text search (Article.body now populated) ──────
  it('newsForPark returns recent releases and searchArticles finds populated bodies', async () => {
    const news = await newsForPark('yell');
    expect(news.some((n) => n.id === 'news-yell-1' && n.releaseDate === '2026-06-15')).toBe(true);

    const hits = await searchArticles('geysers');
    expect(hits.some((a) => a.id === 'article-yell-geysers')).toBe(true);
  });

  // ── F9: regions + materialized NEAR + shared edges ───────────────────────
  it('applyRegions maps a park to its curated region', async () => {
    await applyRegions();
    const rows = await readGraph<{ region: string }>(
      `MATCH (:Park {parkCode:'yell'})-[:IN_REGION]->(r:Region) RETURN r.name AS region`,
    );
    expect(rows.map((r) => r.region)).toContain('Rocky Mountains');
  });

  it('deriveNear materializes a NEAR edge (FLOAT miles) between close parks', async () => {
    await upsertParks([
      tinyPark('itest-np-1', 44.0, -110.0),
      tinyPark('itest-np-2', 44.05, -110.05),
    ]);
    const { edges } = await deriveNear();
    expect(edges).toBeGreaterThan(0);
    const rows = await readGraph<{ miles: number }>(
      `MATCH (:Park {parkCode:'itest-np-1'})-[r:NEAR]->(:Park {parkCode:'itest-np-2'}) RETURN r.miles AS miles`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].miles).toBeGreaterThan(0);
    expect(rows[0].miles).toBeLessThan(150);
  });

  it('deriveSharedEdges materializes SHARES_ACTIVITY for parks with shared activities', async () => {
    const { activityEdges } = await deriveSharedEdges(99, 1); // min 1 activity (seed parks share ≤2)
    expect(activityEdges).toBeGreaterThan(0);
    const rows = await readGraph<{ n: number }>(`MATCH (:Park)-[r:SHARES_ACTIVITY]->(:Park) RETURN count(r) AS n`);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  // ── F10 + bonuses ─────────────────────────────────────────────────────────
  it('parkingForPark exposes accessible-space count + EV-charging flag', async () => {
    const lots = await parkingForPark('yell');
    const lot = lots.find((l) => l.id === 'lot-canyon');
    expect(lot!.accessibleSpaces).toBe(12);
    expect(lot!.hasEvCharging).toBe(true);
  });

  // ── Negative / edge cases + extra round-trips (plan P2-3) ────────────────
  it('checkOpen returns "unknown" (never a false "closed") when a park reports no hours', async () => {
    await writeGraph(`MERGE (p:Park {parkCode:'itest-edge'}) SET p.fullName='Edge NP', p.operatingHours='[]', p.feeFree=false`);
    const res = await checkOpen('itest-edge', '2026-12-15');
    expect(res!.state).toBe('unknown');
  });

  it('tripBudget([]) is empty/zero; accessibilityScorecard is empty for a park with no amenities', async () => {
    const b = await tripBudget([], 'vehicle');
    expect(b.total).toBe(0);
    expect(b.parks).toEqual([]);
    const sc = await accessibilityScorecard('itest-edge');
    expect(sc!.features).toEqual([]);
    expect(sc!.accessibleCampgrounds).toBe(0);
  });

  it('closureWarningsForTrip surfaces the seeded road closure for a trip', async () => {
    const w = await closureWarningsForTrip(['yell'], '2026-12-15');
    expect(w.some((x) => /North Entrance Road/.test(x.summary ?? ''))).toBe(true);
  });

  it('parksInRegion returns parks for a curated region (after applyRegions)', async () => {
    await applyRegions();
    const parks = await parksInRegion('Rocky Mountains', 60);
    expect(parks.map((p) => p.parkCode)).toContain('yell'); // MT/WY → Rocky Mountains
  });

  it('ThingToDo edges: BEST_IN Season + RELATES_TO_TOPIC are written (F7)', async () => {
    const rows = await readGraph<{ season: boolean; topic: boolean }>(
      `MATCH (n:ThingToDo {id:'ttd-rim'})
       RETURN EXISTS { (n)-[:BEST_IN]->(:Season {name:'summer'}) } AS season,
              EXISTS { (n)-[:RELATES_TO_TOPIC]->(:Topic) } AS topic`,
    );
    expect(rows[0].season).toBe(true);
    expect(rows[0].topic).toBe(true);
  });

  it('bonus: queryable contacts + lesson-plan node attaches to the park (Ranger School data)', async () => {
    const p = await parkDetail('yell');
    expect(p!.phone).toBe('307-344-7381');
    const rows = await readGraph<{ lesson: boolean; topic: boolean }>(
      `MATCH (p:Park {parkCode:'yell'})
       RETURN EXISTS { (:LessonPlan {id:'lesson-yell-geology'})-[:ABOUT]->(p) } AS lesson,
              EXISTS { (:LessonPlan {id:'lesson-yell-geology'})-[:RELATES_TO_TOPIC]->(:Topic) } AS topic`,
    );
    expect(rows[0].lesson).toBe(true);
    expect(rows[0].topic).toBe(true);
  });

  it('Ranger School: lesson-plan spine (GradeBand + Module→Lesson→QuizQuestion) + park-grounded media (CAN_USE_MEDIA)', async () => {
    const rows = await readGraph<{
      gradeBand: boolean;
      module: boolean;
      lesson: boolean;
      quiz: boolean;
      tests: boolean;
      media: boolean;
      correctId: string;
    }>(
      `MATCH (lp:LessonPlan {id:'lesson-yell-geology'})
       OPTIONAL MATCH (lp)-[:CONTAINS_MODULE]->(:Module)-[:CONTAINS_LESSON]->(:Lesson)-[:HAS_QUESTION]->(q:QuizQuestion)
       RETURN EXISTS { (lp)-[:TARGETS]->(:GradeBand {id:'6-8'}) } AS gradeBand,
              EXISTS { (lp)-[:CONTAINS_MODULE]->(:Module) } AS module,
              EXISTS { (lp)-[:CONTAINS_MODULE]->(:Module)-[:CONTAINS_LESSON]->(:Lesson) } AS lesson,
              q IS NOT NULL AS quiz,
              EXISTS { (q)-[:TESTS]->(:Topic) } AS tests,
              EXISTS { (lp)-[:CAN_USE_MEDIA]->(:AudioFile)-[:ABOUT]->(:Park {parkCode:'yell'}) } AS media,
              q.correctId AS correctId`,
    );
    expect(rows[0].gradeBand).toBe(true);
    expect(rows[0].module).toBe(true);
    expect(rows[0].lesson).toBe(true);
    expect(rows[0].quiz).toBe(true);
    expect(rows[0].tests).toBe(true);
    expect(rows[0].media).toBe(true);
    // quiz ground truth lives on the node (deterministic, offline-capable grading) — never shipped to the client
    expect(rows[0].correctId).toBe('hotspot');
  });
});

/** Minimal NpsPark for proximity round-trips. */
function tinyPark(parkCode: string, lat: number, lng: number) {
  return {
    id: parkCode,
    parkCode,
    name: parkCode,
    fullName: `${parkCode} National Park`,
    designation: 'National Park',
    description: '',
    states: 'WY',
    latitude: String(lat),
    longitude: String(lng),
    url: 'https://example.com',
    activities: [],
    topics: [],
  };
}
