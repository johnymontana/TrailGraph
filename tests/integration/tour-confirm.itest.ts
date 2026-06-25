import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, readGraph, writeGraph } from '../../lib/neo4j';
import { previewTourFromTour, createTripFromTour, deleteTrip } from '../../lib/trips';

/**
 * P1.3 confirm-before-save for tours, on a real Neo4j over the seeded `tour-canyon-rim` (Artist Point →
 * Canyon Visitor Center). Proves the proposal path (previewTourFromTour) returns the ordered stops and
 * writes NO :Trip, while the agreement path (createTripFromTour) persists exactly one.
 */
describeIntegration('tour confirm-before-save (P1.3, Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  let tripId: string | undefined;

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    if (tripId) await deleteTrip(userId, tripId);
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  async function tripCount(): Promise<number> {
    const r = await readGraph<{ n: number }>(`MATCH (t:Trip {userId:$userId}) RETURN count(t) AS n`, { userId });
    return r[0]?.n ?? 0;
  }

  it('previewTourFromTour returns the tour\'s ordered named stops and writes NOTHING', async () => {
    const before = await tripCount();
    const preview = await previewTourFromTour('tour-canyon-rim');
    expect(preview?.name).toBe('Canyon Rim Tour (tour)');
    // Place label comes from `.title` (Artist Point); VisitorCenter from `.name` (its real, fuller name).
    expect(preview?.stops.map((s) => s.name)).toEqual(['Artist Point', 'Canyon Visitor Education Center']);
    expect(await tripCount()).toBe(before); // proposal must not persist a trip
  });

  it('createTripFromTour DOES persist the trip (the confirmed path)', async () => {
    const created = await createTripFromTour(userId, 'tour-canyon-rim');
    expect(created).not.toBeNull();
    tripId = created!.tripId;
    expect(created!.stops).toBeGreaterThan(0);
    expect(await tripCount()).toBe(1);
  });

  it('previewTourFromTour returns null for an unknown tour', async () => {
    expect(await previewTourFromTour('no-such-tour')).toBeNull();
  });
});
