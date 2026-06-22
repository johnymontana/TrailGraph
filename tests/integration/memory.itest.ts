import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import {
  writePreferenceBridge,
  deletePreference,
  considerPark,
  deleteConsidered,
  deleteAllConsidered,
  setPreferenceFeedback,
} from '../../lib/bridges';
import { isSuppressed, preferenceSignature } from '../../lib/tombstone';
import { getUserMemory, consideredBounds } from '../../lib/memory-graph';
import { explainRecommendation } from '../../lib/explain';

/**
 * E3/E4 + D4: canonical preference bridges, the "Your memory" read, durable delete with tombstones
 * (ADR-016), and graph-grounded "why this?" — all without NAMS (we write the bridge directly).
 */
describeIntegration('memory: bridges, durable delete, explain (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('writePreferenceBridge canonicalizes a value to a domain node', async () => {
    const res = await writePreferenceBridge({ userId, category: 'activity', value: 'stargazing' });
    expect(res.canonicalized).toBe(true);
    expect(res.target).toMatchObject({ kind: 'activity', name: 'Astronomy' });
  });

  it('getUserMemory surfaces the canonical preference + considered parks', async () => {
    await considerPark(userId, 'grca');
    const mem = await getUserMemory(userId);
    expect(mem.preferences.some((p) => p.name === 'Astronomy')).toBe(true);
    expect(mem.considered.some((c) => c.parkCode === 'grca')).toBe(true);
  });

  it('explainRecommendation cites the matched preference (with the user\'s words)', async () => {
    const ex = await explainRecommendation(userId, 'glac'); // Glacier offers Astronomy
    expect(ex.matches.some((m) => m.name === 'Astronomy' && m.yourWords === 'stargazing')).toBe(true);
  });

  it('records E4 feedback on a preference', async () => {
    await setPreferenceFeedback(userId, 'activity', 'Astronomy', 'up');
    const mem = await getUserMemory(userId);
    expect(mem.preferences.find((p) => p.name === 'Astronomy')?.feedback).toBe('up');
  });

  it('removes a considered park', async () => {
    await deleteConsidered(userId, 'grca');
    const mem = await getUserMemory(userId);
    expect(mem.considered.some((c) => c.parkCode === 'grca')).toBe(false);
  });

  it('explain returns no matches for a park with nothing in common', async () => {
    const ex = await explainRecommendation(userId, 'yell'); // Yellowstone offers Hiking, not Astronomy
    expect(ex.matches).toHaveLength(0);
  });

  it('delete is durable: removes the bridge, tombstones it, and blocks resurrection', async () => {
    await deletePreference(userId, 'activity', 'Astronomy');

    // gone from memory
    const mem = await getUserMemory(userId);
    expect(mem.preferences.some((p) => p.name === 'Astronomy')).toBe(false);
    // tombstone recorded
    expect(await isSuppressed(userId, preferenceSignature('activity', 'Astronomy'))).toBe(true);
    // re-extraction / re-canonicalization must NOT recreate it
    const retry = await writePreferenceBridge({ userId, category: 'activity', value: 'dark skies' });
    expect(retry.suppressed).toBe(true);
    const after = await getUserMemory(userId);
    expect(after.preferences.some((p) => p.name === 'Astronomy')).toBe(false);
  });

  it('consideredBounds returns a bbox of considered parks; deleteAllConsidered clears them (§2.7/§4)', async () => {
    await considerPark(userId, 'yell');
    await considerPark(userId, 'grca');
    const bounds = await consideredBounds(userId);
    expect(bounds).not.toBeNull();
    const [[w, s], [e, n]] = bounds!;
    expect(w).toBeLessThanOrEqual(e);
    expect(s).toBeLessThanOrEqual(n);

    await deleteAllConsidered(userId);
    expect((await getUserMemory(userId)).considered).toHaveLength(0);
    expect(await consideredBounds(userId)).toBeNull();
  });
});
