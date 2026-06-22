import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { nearbyParks, oftenPlannedTogether, graphNeighborhood } from '../../lib/queries';
import { createTrip, addStop, deleteTrip } from '../../lib/trips';

/**
 * Graph-relationship surfaces (R2 §P3): proximity ("Nearby"), itinerary co-occurrence ("Often
 * planned together"), and the constellation neighborhood feeding /graph. Real Neo4j, gated by
 * RUN_INTEGRATION=1 (see db.ts).
 */
describeIntegration('graph relationships', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await closeDriver();
  });

  it('nearbyParks returns parks within radius ordered by distance, excluding far ones', async () => {
    const near = await nearbyParks('glac', 600, 6); // Glacier (MT)
    const codes = near.map((p) => p.parkCode);
    expect(codes).toContain('yell'); // Yellowstone ~300mi
    expect(codes).not.toContain('grca'); // Grand Canyon ~900mi, outside 600mi
    for (const p of near) expect(typeof p.miles).toBe('number');
    // ordered ascending by distance
    const miles = near.map((p) => p.miles);
    expect([...miles].sort((a, b) => a - b)).toEqual(miles);
  });

  it('oftenPlannedTogether surfaces parks that co-occur in trips (C4/§6)', async () => {
    const userId = 'itest-graph-user';
    const tripId = await createTrip(userId, { name: 'Co-occur' });
    await addStop(userId, tripId, { kind: 'park', refId: 'yell' });
    await addStop(userId, tripId, { kind: 'park', refId: 'grca' });
    try {
      const together = await oftenPlannedTogether('yell', 6);
      expect(together.map((p) => p.parkCode)).toContain('grca');
      expect(together.find((p) => p.parkCode === 'grca')?.together).toBeGreaterThanOrEqual(1);
    } finally {
      await deleteTrip(userId, tripId);
    }
  });

  it('graphNeighborhood links parks sharing ≥ minShared topics ({nodes, links} shape)', async () => {
    // Give Yellowstone the "Lakes" topic so it shares one with Glacier; clean up after.
    await writeGraph(
      `MATCH (p:Park {parkCode:'yell'}), (t:Topic {id:'top-lakes'}) MERGE (p)-[:HAS_TOPIC]->(t)`,
    );
    try {
      const g = await graphNeighborhood(1, 250);
      expect(Array.isArray(g.nodes)).toBe(true);
      expect(Array.isArray(g.links)).toBe(true);
      const link = g.links.find(
        (l) =>
          (l.source === 'yell' && l.target === 'glac') || (l.source === 'glac' && l.target === 'yell'),
      );
      expect(link, 'expected a yell↔glac link via shared Lakes topic').toBeTruthy();
      expect(link!.value).toBeGreaterThanOrEqual(1);
      // both endpoints present as nodes
      const ids = g.nodes.map((n) => n.id);
      expect(ids).toEqual(expect.arrayContaining(['yell', 'glac']));
    } finally {
      await writeGraph(
        `MATCH (:Park {parkCode:'yell'})-[r:HAS_TOPIC]->(:Topic {id:'top-lakes'}) DELETE r`,
      );
    }
  });
});
