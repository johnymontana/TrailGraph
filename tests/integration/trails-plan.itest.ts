import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { setTrailPreferences, getTrailPreferences, saveTrail } from '../../lib/bridges';
import { createTrip, deleteTrip, addStop, addTrailToStop, removeTrailFromStop, getTrip, tripHikeRefs } from '../../lib/trips';
import { getUserMemory } from '../../lib/memory-graph';
import { renderMemoryBlock } from '../../lib/memory-block';

/**
 * Phase 3 — hikes as first-class trip content (ADR-071), end to end on a real Neo4j: the trail-memory
 * bridges (PREFERS_TRAIL, SAVED/WISHLISTED/DID) round-trip through getUserMemory → renderMemoryBlock, and
 * INCLUDES_TRAIL attaches/detaches a hike on a trip stop (getTrip.hikes + tripHikeRefs). Self-skips without
 * RUN_INTEGRATION=1. Uses the seeded :Trail fixtures; only removes the user's own edges on cleanup.
 */
describeIntegration('Trail planning + memory (ADR-071, Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  let tripId: string;
  let stopId: string;

  const BRIGHT_ANGEL = 'nps:grca:bright-angel-trail';
  const ANGELS_LANDING = 'nps:zion:angels-landing-trail';
  const STORM_POINT = 'nps:yell:storm-point-trail';

  beforeAll(async () => {
    await seedTestData();
    await setTrailPreferences(userId, { maxMiles: 6, difficulty: 'moderate', dogsRequired: true });
    await saveTrail(userId, BRIGHT_ANGEL, 'saved');
    await saveTrail(userId, ANGELS_LANDING, 'wishlisted');
    await saveTrail(userId, STORM_POINT, 'did');
    tripId = await createTrip(userId, { name: 'Canyon Hikes' });
    stopId = (await addStop(userId, tripId, { kind: 'park', refId: 'grca' })) as string;
  });

  afterAll(async () => {
    if (tripId) await deleteTrip(userId, tripId);
    await writeGraph(`MATCH (:User {userId:$userId})-[:PREFERS_TRAIL]->(tp:TrailPrefs) DETACH DELETE tp`, { userId });
    await writeGraph(`MATCH (:User {userId:$userId})-[r:SAVED|WISHLISTED|DID]->(:Trail) DELETE r`, { userId });
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('setTrailPreferences round-trips through getTrailPreferences', async () => {
    const p = await getTrailPreferences(userId);
    expect(p.maxMiles).toBe(6);
    expect(p.difficulty).toBe('moderate');
    expect(p.dogsRequired).toBe(true);
    expect(p.avoidExposure).toBe(false);
    expect(p.maxGainFt).toBeNull();
  });

  it('getUserMemory exposes trail preferences + saved/wishlisted/done trails', async () => {
    const mem = await getUserMemory(userId);
    expect(mem.trailPreferences.maxMiles).toBe(6);
    expect(mem.trailPreferences.difficulty).toBe('moderate');
    expect(mem.trailHistory.saved.map((t) => t.id)).toContain(BRIGHT_ANGEL);
    expect(mem.trailHistory.wishlisted.map((t) => t.id)).toContain(ANGELS_LANDING);
    expect(mem.trailHistory.done.map((t) => t.id)).toContain(STORM_POINT);
    // No cross-contamination between the three relationship types.
    expect(mem.trailHistory.saved.map((t) => t.id)).not.toContain(ANGELS_LANDING);
  });

  it('renderMemoryBlock injects the trail lines (the per-turn system-prompt block)', async () => {
    const block = renderMemoryBlock(await getUserMemory(userId));
    expect(block).toContain('Trail preferences:');
    expect(block).toContain('moderate or easier');
    expect(block).toContain('≤ 6 mi');
    expect(block).toContain('dog-friendly');
    expect(block).toContain('Bright Angel'); // saved
    expect(block).toContain('Angels Landing'); // wishlisted (merged into the saved/bucket-list line)
    expect(block).toContain('Trails already hiked:');
  });

  it('addTrailToStop attaches a hike that getTrip nests under the stop', async () => {
    const ok = await addTrailToStop(userId, tripId, stopId, BRIGHT_ANGEL);
    expect(ok).toBe(true);
    const trip = await getTrip(userId, tripId);
    const stop = trip?.stops.find((s) => s.id === stopId);
    expect(stop?.hikes.map((h) => h.id)).toContain(BRIGHT_ANGEL);
    expect(stop?.hikes.find((h) => h.id === BRIGHT_ANGEL)?.name).toBe('Bright Angel Trail');
  });

  it('addTrailToStop does not multiply stop rows (the CALL subquery guard)', async () => {
    await addTrailToStop(userId, tripId, stopId, ANGELS_LANDING); // a 2nd hike on the same stop
    const trip = await getTrip(userId, tripId);
    const matching = (trip?.stops ?? []).filter((s) => s.id === stopId);
    expect(matching.length).toBe(1); // one stop row, not one-per-hike
    expect(matching[0].hikes.length).toBe(2);
  });

  it('tripHikeRefs returns each hike with its park + (possibly null) geo URL', async () => {
    const refs = await tripHikeRefs(userId, tripId);
    const ba = refs.find((r) => r.trailId === BRIGHT_ANGEL);
    expect(ba).toBeTruthy();
    expect(ba?.parkCode).toBe('grca');
    expect('geoUrl' in (ba ?? {})).toBe(true);
  });

  it('removeTrailFromStop detaches a hike', async () => {
    await removeTrailFromStop(userId, tripId, stopId, ANGELS_LANDING);
    const trip = await getTrip(userId, tripId);
    const stop = trip?.stops.find((s) => s.id === stopId);
    expect(stop?.hikes.map((h) => h.id)).not.toContain(ANGELS_LANDING);
    expect(stop?.hikes.map((h) => h.id)).toContain(BRIGHT_ANGEL); // the other hike survives
  });
});
