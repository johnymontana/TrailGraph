import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { setHomeLocation, getHomeLocation, clearHomeLocation } from '../../lib/bridges';
import { getUserMemory } from '../../lib/memory-graph';
import { renderMemoryBlock } from '../../lib/memory-block';
import { searchParks } from '../../lib/queries';
import { createTrip, addStop, getTrip, setTripOrigin, deleteTrip } from '../../lib/trips';

/**
 * Home location + trip origin (ADR-074) against a real Neo4j: the :Home anchor round-trips as a
 * spatial point, defaults new trips' origins, and recomputeSegments persists the origin/return legs
 * as :Trip props. Isolated by a random userId; cleans up.
 */
describeIntegration('home location + trip origin (ADR-074, Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  const BOZEMAN = { latitude: 45.6793, longitude: -111.0429, label: 'Bozeman, MT, USA', source: 'geocode' as const };
  let tripId: string | null = null;

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    if (tripId) await deleteTrip(userId, tripId);
    await writeGraph(
      `MATCH (u:User {userId:$userId}) OPTIONAL MATCH (u)-[:LIVES_AT]->(h:Home) DETACH DELETE u, h`,
      { userId },
    );
    await closeDriver();
  });

  it('round-trips the :Home anchor as a spatial point and overwrites in place', async () => {
    expect(await getHomeLocation(userId)).toBeNull();
    await setHomeLocation(userId, BOZEMAN);
    const home = await getHomeLocation(userId);
    expect(home?.label).toBe('Bozeman, MT, USA');
    expect(home?.latitude).toBeCloseTo(45.6793, 3);
    expect(home?.source).toBe('geocode');

    // Second write MERGEs onto the same node (home_user constraint) — no duplicates.
    await setHomeLocation(userId, { latitude: 39.7392, longitude: -104.9903, label: 'Denver, CO, USA', source: 'geolocation' });
    const rows = await writeGraph<{ n: number }>(
      `MATCH (:User {userId:$userId})-[:LIVES_AT]->(h:Home) RETURN count(h) AS n`,
      { userId },
    );
    expect(rows[0].n).toBe(1);
    expect((await getHomeLocation(userId))?.label).toBe('Denver, CO, USA');

    await setHomeLocation(userId, BOZEMAN); // restore for the rest of the suite
  });

  it('surfaces home in getUserMemory and the memory block (label only, never coords)', async () => {
    const mem = await getUserMemory(userId);
    expect(mem.home.label).toBe('Bozeman, MT, USA');
    expect(mem.home.latitude).toBeCloseTo(45.6793, 3);
    const block = renderMemoryBlock(mem);
    expect(block).toContain('- Home: Bozeman, MT, USA (default trip start point)');
    expect(block).not.toContain('45.67');
  });

  it('defaults a new trip’s origin from home (round trip on) and computes origin legs', async () => {
    tripId = await createTrip(userId, { name: 'Home Loop' });
    await addStop(userId, tripId, { kind: 'park', refId: 'yell' });
    await addStop(userId, tripId, { kind: 'park', refId: 'glac' });

    const trip = await getTrip(userId, tripId);
    expect(trip!.origin?.label).toBe('Bozeman, MT, USA');
    expect(trip!.returnToOrigin).toBe(true);
    // Both legs exist (real ORS or great-circle fallback — either way, non-zero miles).
    expect(trip!.originLeg?.miles).toBeGreaterThan(0);
    expect(trip!.returnLeg?.miles).toBeGreaterThan(0);
  });

  it('setTripOrigin overrides per trip (fly-in), toggles the round trip, and clears', async () => {
    // Override the origin (fly-in trip) — home itself is untouched.
    await setTripOrigin(userId, tripId!, { origin: { latitude: 36.08, longitude: -115.15, label: 'Las Vegas, NV' } });
    let trip = await getTrip(userId, tripId!);
    expect(trip!.origin?.label).toBe('Las Vegas, NV');
    expect((await getHomeLocation(userId))?.label).toBe('Bozeman, MT, USA');

    // Toggle-only update keeps the point but drops the return leg.
    await setTripOrigin(userId, tripId!, { returnToOrigin: false });
    trip = await getTrip(userId, tripId!);
    expect(trip!.origin?.label).toBe('Las Vegas, NV');
    expect(trip!.returnToOrigin).toBe(false);
    expect(trip!.returnLeg).toBeNull();
    expect(trip!.originLeg?.miles).toBeGreaterThan(0);

    // Clear → no origin, no stale legs.
    await setTripOrigin(userId, tripId!, { origin: null });
    trip = await getTrip(userId, tripId!);
    expect(trip!.origin).toBeNull();
    expect(trip!.originLeg).toBeNull();
    expect(trip!.returnLeg).toBeNull();
  });

  it('other users cannot set this trip’s origin (userId scope)', async () => {
    expect(await setTripOrigin(`other-${randomUUID()}`, tripId!, { origin: { latitude: 1, longitude: 2 } })).toBe(false);
  });

  it('searchParks sort=home orders by distance from the home point', async () => {
    const { items } = await searchParks({
      home: { latitude: BOZEMAN.latitude, longitude: BOZEMAN.longitude },
      sort: 'home',
      limit: 10,
    });
    expect(items.length).toBeGreaterThan(1);
    // Yellowstone is the nearest seeded park to Bozeman; Zion/Grand Canyon are far south.
    expect(items[0].parkCode).toBe('yell');
    const located = items.filter((p) => p.lat != null && p.lng != null);
    const dist = (p: { lat: number | null; lng: number | null }) =>
      Math.hypot((p.lat as number) - BOZEMAN.latitude, (p.lng as number) - BOZEMAN.longitude);
    for (let i = 1; i < located.length; i++) {
      expect(dist(located[i])).toBeGreaterThanOrEqual(dist(located[i - 1]));
    }
  });
});
