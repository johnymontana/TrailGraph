import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { createTrip, addStop, deleteTrip } from '../../lib/trips';
import { createShareLink, getSharedTrip, revokeShareLink } from '../../lib/share';
import { writePreferenceBridge, considerPark } from '../../lib/bridges';
import { setCollectiveOptIn, travelersAlsoLoved } from '../../lib/collective';

/** Phase 4: shareable trips (C6/F4) + opt-in collective intelligence (E5). */
describeIntegration('social: sharing + collective (Neo4j)', () => {
  const owner = `test-${randomUUID()}`;
  const me = `test-${randomUUID()}`;
  const other = `test-${randomUUID()}`;
  let tripId: string;

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    if (tripId) await deleteTrip(owner, tripId);
    for (const u of [owner, me, other]) {
      await writeGraph(`MATCH (u:User {userId:$u}) DETACH DELETE u`, { u });
    }
    await closeDriver();
  });

  it('share link grants read-only access; revoke removes it', async () => {
    tripId = await createTrip(owner, { name: 'Shared Loop' });
    await addStop(owner, tripId, { kind: 'park', refId: 'yell' });

    const token = await createShareLink(owner, tripId, 'read');
    expect(token).toBeTruthy();

    const shared = await getSharedTrip(token!);
    expect(shared?.role).toBe('read');
    expect(shared?.trip.name).toBe('Shared Loop');
    expect((shared?.trip.stops ?? []).filter(Boolean)).toHaveLength(1);

    await revokeShareLink(owner, tripId, token!);
    expect(await getSharedTrip(token!)).toBeNull();
  });

  it('collective intelligence surfaces anonymized picks from similar opted-in travelers', async () => {
    await writePreferenceBridge({ userId: me, category: 'activity', value: 'stargazing' });
    await writePreferenceBridge({ userId: other, category: 'activity', value: 'stargazing' });
    await setCollectiveOptIn(me, true);
    await setCollectiveOptIn(other, true);
    await considerPark(other, 'grca'); // other loved Grand Canyon

    const picks = await travelersAlsoLoved(me);
    const grca = picks.find((p) => p.parkCode === 'grca');
    expect(grca).toBeTruthy();
    expect(grca!.travelers).toBeGreaterThanOrEqual(1);
    expect(Object.keys(grca!)).toEqual(expect.arrayContaining(['parkCode', 'name', 'travelers']));
    expect(grca).not.toHaveProperty('userId'); // anonymized — counts only
  });

  it('does not expose collective data to users who have not opted in', async () => {
    await setCollectiveOptIn(me, false);
    expect(await travelersAlsoLoved(me)).toEqual([]);
  });
});
