import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { createTrip, addStop, getTrip, removeStop, renameTrip, checkTripAlerts, deleteTrip } from '../../lib/trips';

describeIntegration('trip service (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  let tripId: string;

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    if (tripId) await deleteTrip(userId, tripId);
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('creates a trip, adds ordered park stops, and computes a drive segment', async () => {
    tripId = await createTrip(userId, { name: 'NW Loop' });
    await addStop(userId, tripId, { kind: 'park', refId: 'yell' });
    await addStop(userId, tripId, { kind: 'park', refId: 'glac' });

    const trip = await getTrip(userId, tripId);
    expect(trip).not.toBeNull();
    const stops = (trip!.stops ?? []).filter(Boolean) as { order: number; parkName?: string; driveTo?: unknown }[];
    expect(stops).toHaveLength(2);
    expect(stops[0].order).toBe(0);
    // first stop has a DRIVE_TO to the second (great-circle fallback if ORS absent)
    expect(stops[0].driveTo).toBeTruthy();
  });

  it('rejects an unknown parkCode instead of creating a nameless stop (§2.5)', async () => {
    const before = (await getTrip(userId, tripId))!.stops.filter(Boolean).length;
    const stopId = await addStop(userId, tripId, { kind: 'park', refId: 'nope-not-a-park' });
    expect(stopId).toBeNull();
    const after = (await getTrip(userId, tripId))!.stops.filter(Boolean).length;
    expect(after).toBe(before); // no orphan stop added
  });

  it('adding a park records a CONSIDERED memory signal (§5)', async () => {
    const rows = await writeGraph<{ ok: boolean }>(
      `RETURN EXISTS { (:User {userId:$userId})-[:CONSIDERED]->(:Park {parkCode:'yell'}) } AS ok`,
      { userId },
    );
    expect(rows[0]?.ok).toBe(true);
  });

  it('enforces per-user isolation (other user cannot read the trip)', async () => {
    const other = await getTrip(`other-${randomUUID()}`, tripId);
    expect(other).toBeNull();
  });

  it('flags an active Closure alert on a park in the itinerary (C3)', async () => {
    const alerts = (await checkTripAlerts(userId, tripId)) as { parkCode: string; alerts: unknown[] }[];
    const yell = alerts.find((a) => a.parkCode === 'yell');
    expect(yell).toBeTruthy();
    expect(yell!.alerts.length).toBeGreaterThan(0);
  });

  it('omits legacy orphan stops (no park/name/coords) from getTrip (§2.4)', async () => {
    // Simulate a pre-validation orphan stop directly in the graph.
    await writeGraph(
      `MATCH (t:Trip {id:$tripId, userId:$userId})
       CREATE (s:Stop {id:'orphan-' + $tripId, order:99, kind:'park'})
       MERGE (t)-[:HAS_STOP]->(s)`,
      { userId, tripId },
    );
    const trip = await getTrip(userId, tripId);
    const stops = (trip!.stops ?? []).filter(Boolean) as { id: string }[];
    expect(stops.some((s) => s.id.startsWith('orphan-'))).toBe(false);
  });

  it('removes a stop and renumbers', async () => {
    const trip = await getTrip(userId, tripId);
    const stops = (trip!.stops ?? []).filter(Boolean) as { id: string }[];
    await removeStop(userId, tripId, stops[0].id);
    const after = await getTrip(userId, tripId);
    const remaining = (after!.stops ?? []).filter(Boolean) as { order: number }[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].order).toBe(0);
  });

  it('renames a trip (R3 §4.5), userId-scoped', async () => {
    await renameTrip(userId, tripId, 'Renamed Loop');
    expect((await getTrip(userId, tripId))!.name).toBe('Renamed Loop');
    // another user can't rename it
    await renameTrip(`other-${randomUUID()}`, tripId, 'Hijacked');
    expect((await getTrip(userId, tripId))!.name).toBe('Renamed Loop');
  });
});
