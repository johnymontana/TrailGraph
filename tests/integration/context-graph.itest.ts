import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import {
  setTravelConstraints,
  getTravelConstraints,
  clearTravelConstraints,
  recordPass,
  getHeldPasses,
  clearPass,
  collectStamp,
  uncollectStamp,
  setAvailability,
  getAvailability,
  clearAvailability,
} from '../../lib/bridges';
import { getUserMemory } from '../../lib/memory-graph';
import { createTripFromTour, tripCost, createTrip, addStop, deleteTrip } from '../../lib/trips';
import { stampsForPark } from '../../lib/queries';
import { forYou } from '../../lib/recommend';
import { explainRecommendation } from '../../lib/explain';

/**
 * NPS-expansion context graph (Phases 2/4): the new NAMS bridges (TRAVELS_WITH/REQUIRES, HOLDS,
 * COLLECTED, AVAILABLE→Season) and the features they power — accessibility-aware recommend/explain,
 * tour→trip seeding, and the fees cost model. Bridges are written directly (NAMS isn't available in
 * CI), matching the existing recommend/memory integration tests.
 */
describeIntegration('NPS expansion context graph (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  const tripIds: string[] = [];

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    for (const id of tripIds) await deleteTrip(userId, id).catch(() => {});
    await writeGraph(
      `MATCH (u:User {userId:$userId})
       OPTIONAL MATCH (u)-[:TRAVELS_WITH]->(con:Constraint)
       OPTIONAL MATCH (u)-[:AVAILABLE]->(se:Season)
       DETACH DELETE u, con, se`,
      { userId },
    ).catch(() => {});
    await closeDriver();
  });

  // ── Travel constraints (P0 #1) ───────────────────────────────────────────
  it('setTravelConstraints stores scalar constraints + canonicalized required amenities', async () => {
    await setTravelConstraints(userId, {
      wheelchair: true,
      rvMaxLengthFt: 30,
      requiredAmenities: ['Accessible Restrooms'],
    });
    const c = await getTravelConstraints(userId);
    expect(c.wheelchair).toBe(true);
    expect(c.rvMaxLengthFt).toBe(30);
    expect(c.requiredAmenities).toContain('Accessible Restrooms'); // canonicalized to the seeded Amenity
  });

  it('partial updates keep prior values; clear removes everything', async () => {
    await setTravelConstraints(userId, { rvMaxLengthFt: 35 }); // wheelchair untouched
    const c = await getTravelConstraints(userId);
    expect(c.wheelchair).toBe(true);
    expect(c.rvMaxLengthFt).toBe(35);

    await clearTravelConstraints(userId);
    const cleared = await getTravelConstraints(userId);
    expect(cleared).toEqual({ wheelchair: false, rvMaxLengthFt: null, requiredAmenities: [] });
  });

  // ── Accessibility-aware recommend + explain (P0 #1) ──────────────────────
  it('forYou filters to parks with a wheelchair-accessible campground when required', async () => {
    // Seed a Hiking preference (yell/grca/glac all offer Hiking); only yell has an accessible campground.
    await writeGraph(
      `MATCH (a:Activity {name:'Hiking'}) MERGE (u:User {userId:$userId})
       MERGE (u)-[r:PREFERS]->(a) SET r.category='activity', r.value='easy hikes', r.at=datetime()`,
      { userId },
    );
    const unconstrained = (await forYou(userId, { limit: 10 })).parks.map((p) => p.parkCode);
    expect(unconstrained).toEqual(expect.arrayContaining(['yell']));

    await setTravelConstraints(userId, { wheelchair: true });
    const constrained = (await forYou(userId, { limit: 10 })).parks.map((p) => p.parkCode);
    expect(constrained).toContain('yell'); // cg-canyon is wheelchair-accessible
    expect(constrained).not.toContain('grca'); // no accessible campground in fixtures
    expect(constrained).not.toContain('glac');
    await clearTravelConstraints(userId);
  });

  it('explainRecommendation cites each satisfied accessibility constraint', async () => {
    await setTravelConstraints(userId, {
      wheelchair: true,
      rvMaxLengthFt: 35,
      requiredAmenities: ['Accessible Restrooms'],
    });
    const ex = await explainRecommendation(userId, 'yell');
    expect(ex.accessibility).toEqual(
      expect.arrayContaining([
        'has a wheelchair-accessible campground',
        'has an RV site ≥ your 35 ft', // cg-canyon rvMaxLengthFt = 40
        'has Accessible Restrooms',
      ]),
    );
    await clearTravelConstraints(userId);
    // clean up the Hiking preference so it doesn't leak into other suites' user (it's userId-scoped anyway)
    await writeGraph(`MATCH (:User {userId:$userId})-[r:PREFERS]->() DELETE r`, { userId });
  });

  // ── Passes / HOLDS (P2 #9) ───────────────────────────────────────────────
  it('recordPass adds a HOLDS edge to the AtB pass; clearPass removes it', async () => {
    await recordPass(userId); // defaults to atb-annual
    const held = await getHeldPasses(userId);
    expect(held.some((p) => p.id === 'atb-annual')).toBe(true);

    await clearPass(userId);
    expect((await getHeldPasses(userId)).some((p) => p.id === 'atb-annual')).toBe(false);
  });

  // ── Passport stamps / COLLECTED (P2 #8) ──────────────────────────────────
  it('collectStamp records COLLECTED and surfaces in stampsForPark; uncollect reverts', async () => {
    const ok = await collectStamp(userId, 'stamp-yell-canyon');
    expect(ok).toBe(true);
    const collected = await stampsForPark('yell', userId);
    expect(collected.find((s) => s.id === 'stamp-yell-canyon')!.collected).toBe(true);

    await uncollectStamp(userId, 'stamp-yell-canyon');
    const after = await stampsForPark('yell', userId);
    expect(after.find((s) => s.id === 'stamp-yell-canyon')!.collected).toBe(false);
  });

  it('collectStamp returns false for an unknown stamp (no node created)', async () => {
    expect(await collectStamp(userId, 'no-such-stamp')).toBe(false);
  });

  // ── Availability / AVAILABLE→Season (P2 #7) ──────────────────────────────
  it('setAvailability stores the travel window; clear removes it', async () => {
    await setAvailability(userId, '2026-08-10', '2026-08-14');
    expect(await getAvailability(userId)).toEqual({ start: '2026-08-10', end: '2026-08-14' });
    await clearAvailability(userId);
    expect(await getAvailability(userId)).toEqual({ start: null, end: null });
  });

  // ── getUserMemory aggregates the new bridges (E3) ────────────────────────
  it('getUserMemory surfaces travel, passes, stamps, and availability together', async () => {
    await setTravelConstraints(userId, { wheelchair: true, rvMaxLengthFt: 28 });
    await recordPass(userId);
    await collectStamp(userId, 'stamp-yell-canyon');
    await setAvailability(userId, '2026-09-01', '2026-09-08');

    const mem = await getUserMemory(userId);
    expect(mem.travel.wheelchair).toBe(true);
    expect(mem.travel.rvMaxLengthFt).toBe(28);
    expect(mem.passes.some((p) => p.id === 'atb-annual')).toBe(true);
    expect(mem.stamps.some((s) => s.id === 'stamp-yell-canyon')).toBe(true);
    expect(mem.availability).toEqual({ start: '2026-09-01', end: '2026-09-08' });

    // tidy up the edges so later assertions in this suite start clean
    await clearTravelConstraints(userId);
    await clearPass(userId);
    await uncollectStamp(userId, 'stamp-yell-canyon');
    await clearAvailability(userId);
  });

  // ── Tour → trip (P1 #3) ──────────────────────────────────────────────────
  it('createTripFromTour materializes the tour stops as a trip', async () => {
    const created = await createTripFromTour(userId, 'tour-canyon-rim');
    expect(created).not.toBeNull();
    tripIds.push(created!.tripId);
    expect(created!.stops).toBe(2); // Artist Point (Place) + Canyon Visitor Center (VisitorCenter→custom)
    // The Place stop resolves its title back through getTrip.
    const titles = JSON.stringify(created);
    expect(titles).toContain('tour'); // name carries the "(tour)" suffix
  });

  it('createTripFromTour returns null for an unknown tour', async () => {
    expect(await createTripFromTour(userId, 'no-such-tour')).toBeNull();
  });

  // ── Fees cost model (P2 #9) ──────────────────────────────────────────────
  it('tripCost sums park entrance fees and zeroes out when the AtB pass is held', async () => {
    const tripId = await createTrip(userId, { name: 'Cost Trip' });
    tripIds.push(tripId);
    await addStop(userId, tripId, { kind: 'park', refId: 'yell' }); // entranceFees: $35
    await addStop(userId, tripId, { kind: 'park', refId: 'grca' }); // entranceFees: []

    const before = await tripCost(userId, tripId);
    expect(before.perPark.find((p) => p.parkCode === 'yell')!.fee).toBe(35);
    expect(before.total).toBe(35);
    expect(before.holdsAtb).toBe(false);

    await recordPass(userId);
    const after = await tripCost(userId, tripId);
    expect(after.holdsAtb).toBe(true);
    expect(after.total).toBe(0);
    await clearPass(userId);
  });
});
