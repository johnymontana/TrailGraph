import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph, readGraph } from '../../lib/neo4j';
import { createTrip, addStop, getTrip, removeStop, deleteTrip } from '../../lib/trips';
import { forkTrip, tripMetrics, tripDiff, tripBrief } from '../../lib/trip-lab';

/** Trip Lab (ADR-056/057): fork (deep clone + lineage + isolation), diff metrics, field brief. */
describeIntegration('Trip Lab (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  const other = `other-${randomUUID()}`;
  let tripId: string;
  let forkId: string | null = null;

  beforeAll(async () => {
    await seedTestData();
    tripId = await createTrip(userId, { name: 'Dark Sky Loop', startDate: '2026-09-10' });
    await addStop(userId, tripId, { kind: 'park', refId: 'grca' });
    await addStop(userId, tripId, { kind: 'park', refId: 'glac' });
  });
  afterAll(async () => {
    for (const id of [tripId, forkId]) if (id) await deleteTrip(userId, id);
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('forks a trip: new stop ids (deep clone), order + parks preserved, lineage set', async () => {
    forkId = await forkTrip(userId, tripId);
    expect(forkId).toBeTruthy();
    expect(forkId).not.toBe(tripId);

    const orig = (await getTrip(userId, tripId))!.stops.filter(Boolean) as { id: string; parkCode?: string | null }[];
    const fork = (await getTrip(userId, forkId!))!.stops.filter(Boolean) as { id: string; parkCode?: string | null }[];
    expect(fork).toHaveLength(orig.length);

    const origIds = new Set(orig.map((s) => s.id));
    expect(fork.every((s) => !origIds.has(s.id))).toBe(true); // distinct stop nodes
    expect(fork.map((s) => s.parkCode)).toEqual(orig.map((s) => s.parkCode)); // OF_PARK edges + order preserved

    const meta = await readGraph<{ parentId: string; version: number }>(
      `MATCH (t:Trip {id:$forkId}) RETURN t.parentId AS parentId, t.version AS version`,
      { forkId },
    );
    expect(meta[0].parentId).toBe(tripId);
    expect(meta[0].version).toBeGreaterThanOrEqual(2);
    expect((await getTrip(userId, forkId!))!.name.toLowerCase()).toContain('copy');
  });

  it('fork rebuilds DRIVE_TO segments on the copy', async () => {
    const fork = (await getTrip(userId, forkId!))!.stops.filter(Boolean) as { driveTo?: unknown }[];
    expect(fork[0].driveTo).toBeTruthy(); // great-circle fallback if ORS absent
  });

  it('fork is user-scoped (another user cannot fork your trip)', async () => {
    expect(await forkTrip(other, tripId)).toBeNull();
  });

  it('computes trip metrics: drive, dark hours, cost, risk', async () => {
    const m = await tripMetrics(userId, tripId);
    expect(m).not.toBeNull();
    expect(m!.stops).toBe(2);
    expect(m!.parks).toBe(2);
    expect(m!.driveMiles).toBeGreaterThan(0);
    expect(m!.driveMinutes).toBeGreaterThan(0);
    expect(m!.darkHoursTotal).not.toBeNull(); // grca + glac have coords
    expect(m!.riskScore).toBeGreaterThanOrEqual(0);
    expect(m!.riskScore).toBeLessThanOrEqual(3);
    expect(['none', 'low', 'moderate', 'high']).toContain(m!.riskLabel);
  });

  it('diffs two trips side-by-side and exposes fork lineage', async () => {
    const d = await tripDiff(userId, tripId, forkId!);
    expect(d).not.toBeNull();
    expect(d!.a.tripId).toBe(tripId);
    expect(d!.b.tripId).toBe(forkId);
    expect(d!.a.parentId).toBeNull(); // original
    expect(d!.b.parentId).toBe(tripId); // fork
  });

  it('diff is user-scoped (null if either trip is not the caller’s)', async () => {
    expect(await tripDiff(other, tripId, forkId!)).toBeNull();
  });

  it('builds a field brief with per-stop coordinates + drive legs', async () => {
    const b = await tripBrief(userId, tripId);
    expect(b).not.toBeNull();
    expect(b!.stops).toHaveLength(2);
    expect(b!.stops[0].parkCode).toBe('grca');
    expect(b!.stops[0].lat).not.toBeNull();
    expect(b!.stops[0].lng).not.toBeNull();
    expect(b!.stops[0].driveToNext).not.toBeNull(); // first stop drives to the second
    expect(b!.stops[1].driveToNext).toBeNull(); // last stop has no next leg
  });

  it('editing the fork leaves the original untouched (true isolation)', async () => {
    const fStops = (await getTrip(userId, forkId!))!.stops.filter(Boolean) as { id: string }[];
    await removeStop(userId, forkId!, fStops[0].id);
    expect((await getTrip(userId, forkId!))!.stops.filter(Boolean)).toHaveLength(1);
    expect((await getTrip(userId, tripId))!.stops.filter(Boolean)).toHaveLength(2); // original intact
  });
});
