import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { createTrip, deleteTrip } from '../../lib/trips';
import { createWatch, listWatches, deleteWatch, usersWithWatches } from '../../lib/watches';

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
    const id1 = await createWatch(userId, 'park', 'grca', 'Grand Canyon');
    const id2 = await createWatch(userId, 'park', 'grca', 'Grand Canyon');
    expect(id1).toBe(id2); // same :Watch node, not a duplicate
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

  it('delete is user-scoped (another user cannot delete your watch)', async () => {
    const w = (await listWatches(userId)).find((x) => x.refId === 'grca')!;
    await deleteWatch(`other-${randomUUID()}`, w.id);
    expect((await listWatches(userId)).some((x) => x.id === w.id)).toBe(true);
    await deleteWatch(userId, w.id);
    expect((await listWatches(userId)).some((x) => x.id === w.id)).toBe(false);
  });
});
