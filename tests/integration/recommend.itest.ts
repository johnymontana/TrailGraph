import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { considerPark } from '../../lib/bridges';
import { forYou, mapDefaultFilters } from '../../lib/recommend';

/**
 * The §8.3 differentiator: cross-graph, novelty-aware recommendation. We write the canonical PREFERS
 * bridge directly (bypassing NAMS, which isn't available in CI) and assert the graph traversal.
 */
describeIntegration('recommendations & bridges (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;

  beforeAll(async () => {
    await seedTestData();
    // Canonicalized preference: user likes Astronomy (as ADR-011's PREFERS bridge would produce).
    await writeGraph(
      `MATCH (a:Activity {name:'Astronomy'})
       MERGE (u:User {userId:$userId})
       MERGE (u)-[r:PREFERS]->(a) SET r.category='activity', r.value='stargazing', r.at=datetime()`,
      { userId },
    );
  });
  afterAll(async () => {
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('recommends parks matching preferences (personalized source)', async () => {
    const { source, parks } = await forYou(userId, { limit: 10 });
    expect(source).toBe('personalized');
    const codes = parks.map((p) => p.parkCode);
    expect(codes).toEqual(expect.arrayContaining(['grca', 'glac'])); // both offer Astronomy
    expect(codes).not.toContain('yell'); // no Astronomy
  });

  it('excludes parks the user has already considered (novelty)', async () => {
    await considerPark(userId, 'grca');
    const { parks } = await forYou(userId, { limit: 10 });
    const codes = parks.map((p) => p.parkCode);
    expect(codes).not.toContain('grca');
    expect(codes).toContain('glac');
  });

  it('derives map default filters from preferences', async () => {
    const filters = await mapDefaultFilters(userId);
    expect(filters.activities).toContain('Astronomy');
  });
});
