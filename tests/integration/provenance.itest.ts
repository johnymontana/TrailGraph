import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { setTravelConstraints, considerPark } from '../../lib/bridges';
import { userContextGraph } from '../../lib/memory-graph';
import { explainGraph } from '../../lib/explain';

/**
 * "Why this park?" provenance + context-graph-as-graph against real Neo4j (ADR-047). Bridges are written
 * directly (NAMS isn't available in CI), matching the other context-graph integration suites.
 */
describeIntegration('provenance + context graph (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;

  beforeAll(async () => {
    await seedTestData();
    // User prefers Hiking (yell offers it) + has considered grca.
    await writeGraph(
      `MATCH (a:Activity {name:'Hiking'}) MERGE (u:User {userId:$userId})
       MERGE (u)-[r:PREFERS]->(a) SET r.category='activity', r.value='easy hikes', r.at=datetime()`,
      { userId },
    );
    await considerPark(userId, 'grca', 'viewed');
  });
  afterAll(async () => {
    await writeGraph(
      `MATCH (u:User {userId:$userId}) OPTIONAL MATCH (u)-[:TRAVELS_WITH]->(c:Constraint) DETACH DELETE u, c`,
      { userId },
    ).catch(() => {});
    await closeDriver();
  });

  it('explainGraph returns the preference triple with relationship direction', async () => {
    const ex = await explainGraph(userId, 'yell');
    const hiking = ex.prefPaths.find((p) => p.name === 'Hiking');
    expect(hiking).toBeTruthy();
    expect(hiking!.via).toBe('OFFERS');
    expect(hiking!.kind).toBe('activity');
    expect(hiking!.yourWords).toBe('easy hikes');
  });

  it('explainGraph cites the concrete campground satisfying the RV + wheelchair constraints', async () => {
    await setTravelConstraints(userId, { wheelchair: true, rvMaxLengthFt: 30 });
    const ex = await explainGraph(userId, 'yell'); // Canyon Campground: wheelchair + 40 ft
    const wc = ex.constraints.find((c) => c.kind === 'wheelchair');
    const rv = ex.constraints.find((c) => c.kind === 'rv');
    expect(wc?.satisfiedBy).toContain('Canyon');
    expect(rv?.satisfiedBy).toContain('Canyon');
    await writeGraph(`MATCH (:User {userId:$userId})-[r:TRAVELS_WITH]->(c:Constraint) DELETE r, c`, { userId }).catch(() => {});
  });

  it('userContextGraph reshapes memory into NVL nodes/rels with the You anchor + bare-parkCode merge key', async () => {
    const g = await userContextGraph(userId);
    expect(g.nodes.find((n) => n.id === 'ctx:You')).toBeTruthy();
    expect(g.nodes.find((n) => n.id === 'ctx:Activity:Hiking')).toBeTruthy();
    expect(g.nodes.find((n) => n.id === 'grca')).toBeTruthy(); // CONSIDERED park keyed by bare parkCode
    const captions = new Set(g.rels.map((r) => r.caption));
    expect(captions.has('PREFERS')).toBe(true);
    expect(captions.has('CONSIDERED')).toBe(true);
  });
});
