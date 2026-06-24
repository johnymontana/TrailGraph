import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { createShareLink, getSharedTrip, listShareLinks, revokeShareLink } from '../../lib/share';
import { createTrip, deleteTrip } from '../../lib/trips';
import { writeGraph, closeDriver } from '../../lib/neo4j';

/** Share-link lifecycle against real Neo4j (audit S6/S7): expiry, legacy links, revoke, owner scoping. */
describeIntegration('share links (Neo4j)', () => {
  const userId = `test-share-${randomUUID()}`;
  let tripId: string;

  beforeAll(async () => {
    tripId = await createTrip(userId, { name: 'Share Test Trip' });
  });
  afterAll(async () => {
    if (tripId) await deleteTrip(userId, tripId);
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('mints a read-only link that resolves to the trip', async () => {
    const token = await createShareLink(userId, tripId);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const shared = await getSharedTrip(token!);
    expect(shared?.trip.id).toBe(tripId);
    expect(shared?.role).toBe('read');
    const links = await listShareLinks(userId, tripId);
    expect(links.some((l) => l.token === token && l.expiresAt)).toBe(true);
  });

  it('does not resolve an expired link (S6)', async () => {
    const token = await createShareLink(userId, tripId);
    await writeGraph(
      `MATCH (sl:ShareLink {token:$token}) SET sl.expiresAt = datetime() - duration({days: 1})`,
      { token },
    );
    expect(await getSharedTrip(token!)).toBeNull();
  });

  it('still resolves a legacy link with no expiresAt', async () => {
    const token = await createShareLink(userId, tripId);
    await writeGraph(`MATCH (sl:ShareLink {token:$token}) REMOVE sl.expiresAt`, { token });
    const shared = await getSharedTrip(token!);
    expect(shared?.trip.id).toBe(tripId);
  });

  it('revoke makes the link stop resolving', async () => {
    const token = await createShareLink(userId, tripId);
    await revokeShareLink(userId, tripId, token!);
    expect(await getSharedTrip(token!)).toBeNull();
  });

  it('does not create a link for a non-owner (R4)', async () => {
    expect(await createShareLink(`intruder-${randomUUID()}`, tripId)).toBeNull();
  });
});
