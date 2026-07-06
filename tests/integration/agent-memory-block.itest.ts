import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { setTravelConstraints, considerPark, setAvailability, recordPass } from '../../lib/bridges';
import { createTrip, deleteTrip } from '../../lib/trips';
import { getUserMemory } from '../../lib/memory-graph';
import { renderMemoryBlock } from '../../lib/memory-block';

/**
 * P1.4 deterministic-memory data path, end to end on a real Neo4j: the SAME bridges the ranger's tools
 * write through → getUserMemory (the single source of truth) → renderMemoryBlock (the per-turn injection).
 * Proves the injected block reflects everything the user actually saved, and that an empty user injects
 * nothing.
 */
describeIntegration('deterministic memory block round-trip (P1.4, Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  // Unique, non-vocabulary topic name: a raw shared-vocab name (e.g. 'dark skies') would persist as an
  // orphan :Topic and shadow the canonicalize.ts synonym table for every LATER test file (order-dependent
  // flake in memory.itest's tombstone test). Cleaned up in afterAll.
  const topicName = `test-topic-${userId}`;
  let tripId: string;

  beforeAll(async () => {
    await seedTestData();
    await setTravelConstraints(userId, { wheelchair: true, rvMaxLengthFt: 30 });
    await considerPark(userId, 'grca');
    await setAvailability(userId, '2026-09-21', '2026-09-30');
    await recordPass(userId); // atb-annual
    // A PREFERS edge written directly so the read test doesn't depend on the canonical vocab being seeded.
    await writeGraph(
      `MERGE (u:User {userId:$userId}) MERGE (t:Topic {name:$topicName}) MERGE (u)-[:PREFERS]->(t)`,
      { userId, topicName },
    );
    tripId = await createTrip(userId, { name: 'Utah Dark Skies' });
  });

  afterAll(async () => {
    if (tripId) await deleteTrip(userId, tripId);
    await writeGraph(`MATCH (:User {userId:$userId})-[:TRAVELS_WITH]->(c:Constraint) DETACH DELETE c`, { userId });
    await writeGraph(`MATCH (s:Season {userId:$userId}) DETACH DELETE s`, { userId }); // per-user availability anchor
    await writeGraph(`MATCH (t:Topic {name:$topicName}) DETACH DELETE t`, { topicName }); // the artificial topic
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('getUserMemory feeds renderMemoryBlock with everything the user saved', async () => {
    const block = renderMemoryBlock(await getUserMemory(userId));
    expect(block).toContain('load-bearing');
    expect(block).toContain(topicName); // PREFERS
    expect(block).toContain('needs wheelchair-accessible sites'); // TRAVELS_WITH
    expect(block).toContain('RV ≤ 30 ft');
    expect(block).toContain('America the Beautiful'); // HOLDS → EntrancePass
    expect(block).toContain('2026-09-21 → 2026-09-30'); // AVAILABLE
    expect(block).toContain('Grand Canyon'); // CONSIDERED park fullName
    expect(block).toContain('Utah Dark Skies'); // PLANNED trip
    expect(block).toContain('do NOT call `recall_user_context`'); // the steering footer
  });

  it('injects NOTHING for a user with no saved memory', async () => {
    const block = renderMemoryBlock(await getUserMemory(`test-empty-${randomUUID()}`));
    expect(block).toBe('');
  });
});
