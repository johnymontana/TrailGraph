import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph, readGraph } from '../../lib/neo4j';
import { createWatch } from '../../lib/watches';
import {
  buildDigest,
  listDigests,
  unreadDigestCount,
  markDigestRead,
  setEmailDigest,
  getEmailDigest,
  unsubscribeByToken,
} from '../../lib/digest';

/** Proactive Ranger digest (ADR-052): build → persist → inbox reads → email opt-in + unsubscribe. */
describeIntegration('Proactive Ranger digest (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  const FEE_FREE = '2026-06-19'; // Juneteenth → a deterministic fee-free digest item

  beforeAll(async () => {
    await seedTestData();
    await createWatch(userId, 'park', 'grca');
  });
  afterAll(async () => {
    await writeGraph(`MATCH (u:User {userId:$userId})-[:WATCHES]->(w:Watch) DETACH DELETE w`, { userId });
    await writeGraph(`MATCH (u:User {userId:$userId})-[:HAS_DIGEST]->(d:Digest) DETACH DELETE d`, { userId });
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('builds + persists a digest for a watched park (with a fee-free item)', async () => {
    const d = await buildDigest(userId, FEE_FREE);
    expect(d.id).toBeTruthy();
    expect(d.items.length).toBeGreaterThan(0);
    expect(d.items.some((i) => i.kind === 'feefree')).toBe(true);
  });

  it('rebuilds idempotently per forDate (no duplicate digest nodes)', async () => {
    await buildDigest(userId, FEE_FREE);
    const list = await listDigests(userId);
    expect(list.filter((d) => d.forDate === FEE_FREE)).toHaveLength(1);
  });

  it('lists digests + tracks unread, then marks read', async () => {
    const list = await listDigests(userId);
    expect(list.length).toBeGreaterThan(0);
    const before = await unreadDigestCount(userId);
    expect(before).toBeGreaterThan(0);
    await markDigestRead(userId, list[0].id);
    expect(await unreadDigestCount(userId)).toBe(before - 1);
  });

  it('email opt-in mints an unsubscribe token; one-click unsubscribe disables it', async () => {
    await setEmailDigest(userId, true);
    expect(await getEmailDigest(userId)).toBe(true);
    const tok = (await readGraph<{ t: string }>(`MATCH (u:User {userId:$userId}) RETURN u.unsubToken AS t`, { userId }))[0].t;
    expect(tok).toBeTruthy();
    expect(await unsubscribeByToken(tok)).toBe(true);
    expect(await getEmailDigest(userId)).toBe(false);
    expect(await unsubscribeByToken('not-a-real-token')).toBe(false);
  });

  it('builds an empty (unpersisted) digest for a user with no watches', async () => {
    const noWatchUser = `test-${randomUUID()}`;
    const d = await buildDigest(noWatchUser);
    expect(d.id).toBe('');
    expect(d.items).toEqual([]);
    expect(await listDigests(noWatchUser)).toEqual([]);
  });
});
