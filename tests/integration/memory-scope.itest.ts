import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph, readGraph } from '../../lib/neo4j';
import {
  setTravelConstraints,
  getTravelConstraints,
  removeRequiredAmenity,
  clearTravelConstraints,
} from '../../lib/bridges';

/**
 * P0.5 — lightweight memory scoping: a user can remove a single durable accessibility/amenity need from
 * /me (`removeRequiredAmenity`) without wiping the rest, and the shared :Amenity node is never deleted.
 * Uses the seeded amenities ('Accessible Restrooms', 'Potable Water'); userId-isolated + cleaned up.
 */
describeIntegration('memory scope: per-row constraint removal (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;

  beforeAll(async () => {
    await seedTestData();
    // Attach the user to two existing seeded amenities + give them a wheelchair constraint.
    await writeGraph(
      `MERGE (u:User {userId:$userId})
       WITH u MATCH (a:Amenity {name:'Accessible Restrooms'}) MERGE (u)-[:REQUIRES]->(a)
       WITH u MATCH (b:Amenity {name:'Potable Water'}) MERGE (u)-[:REQUIRES]->(b)`,
      { userId },
    );
    await setTravelConstraints(userId, { wheelchair: true });
  });
  afterAll(async () => {
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('getTravelConstraints surfaces the wheelchair flag + both required amenities', async () => {
    const c = await getTravelConstraints(userId);
    expect(c.wheelchair).toBe(true);
    expect(c.requiredAmenities).toEqual(expect.arrayContaining(['Accessible Restrooms', 'Potable Water']));
  });

  it('removeRequiredAmenity drops ONE REQUIRES edge, leaving the other need + wheelchair intact', async () => {
    await removeRequiredAmenity(userId, 'Accessible Restrooms');
    const c = await getTravelConstraints(userId);
    expect(c.requiredAmenities).not.toContain('Accessible Restrooms');
    expect(c.requiredAmenities).toContain('Potable Water'); // the other need survives
    expect(c.wheelchair).toBe(true); // the scalar constraint is untouched
  });

  it('never deletes the shared :Amenity node (only the edge)', async () => {
    const rows = await readGraph<{ n: number }>(
      `MATCH (a:Amenity {name:'Accessible Restrooms'}) RETURN count(a) AS n`,
      {},
    );
    expect(rows[0].n).toBe(1);
  });

  it('clearTravelConstraints still wipes everything (wheelchair + remaining amenities)', async () => {
    await clearTravelConstraints(userId);
    const c = await getTravelConstraints(userId);
    expect(c.wheelchair).toBe(false);
    expect(c.requiredAmenities).toEqual([]);
  });
});
