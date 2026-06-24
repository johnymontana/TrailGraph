import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { createTrip, deleteTrip } from '../../lib/trips';
import { createWatch, listWatches, deleteWatch, usersWithWatches, WATCH_CAP } from '../../lib/watches';

/** Proactive Ranger watches (ADR-052): create/dedupe/list/delete + the digest fan-out query. */
describeIntegration('Proactive Ranger watches (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  let tripId: string;

  beforeAll(async () => {
    await seedTestData();
    tripId = await createTrip(userId, { name: 'Watched Trip' });
  });
  afterAll(async () => {
    if (tripId) await deleteTrip(userId, tripId);
    await writeGraph(`MATCH (u:User {userId:$userId})-[:WATCHES]->(w:Watch) DETACH DELETE w`, { userId });
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('creates a park watch, deduped by user+kind+refId', async () => {
    const r1 = await createWatch(userId, 'park', 'grca', 'Grand Canyon');
    const r2 = await createWatch(userId, 'park', 'grca', 'Grand Canyon');
    expect('id' in r1 && 'id' in r2).toBe(true);
    expect((r1 as { id: string }).id).toBe((r2 as { id: string }).id); // same :Watch node, not a duplicate
    const watches = await listWatches(userId);
    expect(watches.filter((w) => w.refId === 'grca')).toHaveLength(1);
  });

  it('lists watches across kinds with label + refId', async () => {
    await createWatch(userId, 'trip', tripId, 'Watched Trip');
    const watches = await listWatches(userId);
    expect(watches.some((w) => w.kind === 'park' && w.refId === 'grca')).toBe(true);
    expect(watches.some((w) => w.kind === 'trip' && w.refId === tripId && w.label === 'Watched Trip')).toBe(true);
  });

  it('appears in the digest fan-out (usersWithWatches)', async () => {
    const users = await usersWithWatches();
    const me = users.find((u) => u.userId === userId);
    expect(me).toBeTruthy();
    expect(me!.emailDigest).toBe(false); // default OFF
  });

  it('caps watches per user at WATCH_CAP (audit C8)', async () => {
    const capUser = `test-cap-${randomUUID()}`;
    try {
      // Fill to the cap with distinct refIds (re-watching an existing one never counts against it).
      for (let i = 0; i < WATCH_CAP; i++) {
        const r = await createWatch(capUser, 'park', `cap-park-${i}`);
        expect('id' in r).toBe(true);
      }
      const blocked = await createWatch(capUser, 'park', 'one-too-many');
      expect('error' in blocked).toBe(true);
      // Re-watching an existing one is still allowed at the cap.
      const reWatch = await createWatch(capUser, 'park', 'cap-park-0');
      expect('id' in reWatch).toBe(true);
    } finally {
      await writeGraph(`MATCH (u:User {userId:$userId})-[:WATCHES]->(w:Watch) DETACH DELETE w`, { userId: capUser });
      await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId: capUser });
    }
  });

  it('delete is user-scoped (another user cannot delete your watch)', async () => {
    const w = (await listWatches(userId)).find((x) => x.refId === 'grca')!;
    await deleteWatch(`other-${randomUUID()}`, w.id);
    expect((await listWatches(userId)).some((x) => x.id === w.id)).toBe(true);
    await deleteWatch(userId, w.id);
    expect((await listWatches(userId)).some((x) => x.id === w.id)).toBe(false);
  });
});
