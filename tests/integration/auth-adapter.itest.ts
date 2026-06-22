import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { auth } from '../../lib/auth';
import { closeDriver, writeGraph } from '../../lib/neo4j';

/**
 * Regression coverage for the Better Auth → Neo4j adapter. These exercise the exact bugs that broke
 * magic-link sign-in against a live DB:
 *  - returning a raw neo4j Node instead of its properties (→ undefined fields → INVALID_TOKEN),
 *  - deleteMany subquery scope,
 *  - a JS Date in a where clause (the expired-verification cleanup).
 *
 * Uses the REAL adapter from `auth.$context` so the Better Auth field/date transforms match prod.
 */
describeIntegration('Better Auth → Neo4j adapter', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adapter: any;
  const email = `adapter-${randomUUID()}@example.test`;
  let userId: string | undefined;

  beforeAll(async () => {
    adapter = (await auth.$context).adapter;
  });
  afterAll(async () => {
    if (userId) await writeGraph(`MATCH (u:User {id:$id}) DETACH DELETE u`, { id: userId });
    await closeDriver();
  });

  it('create returns plain properties, not a raw Node', async () => {
    const user = await adapter.create({
      model: 'user',
      data: { email, name: 'Adapter Test', emailVerified: true },
    });
    expect(user.email).toBe(email); // would be undefined if a Node leaked through
    expect(typeof user.id).toBe('string');
    userId = user.id;
  });

  it('findOne resolves by a where clause', async () => {
    const u = await adapter.findOne({ model: 'user', where: [{ field: 'email', value: email }] });
    expect(u?.email).toBe(email);
    expect(u?.id).toBe(userId);
  });

  it('mirrors id → userId on the :User node (context-graph anchor, ADR-008)', async () => {
    const rows = await writeGraph<{ userId: string }>(
      `MATCH (u:User {id:$id}) RETURN u.userId AS userId`,
      { id: userId },
    );
    expect(rows[0]?.userId).toBe(userId);
  });

  it('update mutates and returns the row', async () => {
    const u = await adapter.update({
      model: 'user',
      where: [{ field: 'id', value: userId }],
      update: { name: 'Renamed' },
    });
    expect(u?.name).toBe('Renamed');
  });

  it('count works', async () => {
    expect(await adapter.count({ model: 'user', where: [{ field: 'email', value: email }] })).toBe(1);
  });

  it('deleteMany handles a JS Date where value (verify-cleanup path)', async () => {
    const identifier = `vtest-${randomUUID()}`;
    await adapter.create({
      model: 'verification',
      data: { identifier, value: 'x', expiresAt: new Date(Date.now() - 1000) },
    });
    const removed = await adapter.deleteMany({
      model: 'verification',
      where: [{ field: 'expiresAt', value: new Date(), operator: 'lt' }],
    });
    expect(removed).toBeGreaterThanOrEqual(1);
  });

  it('delete removes the user', async () => {
    await adapter.delete({ model: 'user', where: [{ field: 'id', value: userId }] });
    const u = await adapter.findOne({ model: 'user', where: [{ field: 'id', value: userId }] });
    expect(u).toBeNull();
    userId = undefined;
  });
});
