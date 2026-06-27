import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import {
  createCampWatch,
  listCampWatches,
  deleteCampWatch,
  usersWithCampWatches,
  expireCampWatches,
  recordCampWatchSnapshot,
  CAMP_WATCH_CAP,
} from '../../lib/camp-watches';

/** Camp Watch (Phase 2): create/list/delete + cap + auto-expire + snapshot + the poller fan-out. */
describeIntegration('Camp Watch (Neo4j)', () => {
  const userId = `test-camp-${randomUUID()}`;

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await writeGraph(`MATCH (u:User {userId:$userId})-[:WATCHING]->(w:CampWatch) DETACH DELETE w`, { userId });
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('creates a camp watch with criteria and lists it', async () => {
    const r = await createCampWatch(userId, {
      campgroundIds: ['cg-canyon'],
      recAreaId: null,
      startDate: '2030-07-03',
      endDate: '2030-07-05',
      nights: 2,
      minNights: 2,
      siteType: 'tent',
      weekendOnly: false,
      hookups: null,
      ada: false,
      label: 'Canyon July',
    });
    expect('id' in r).toBe(true);
    const list = await listCampWatches(userId);
    expect(list).toHaveLength(1);
    expect(list[0].campgroundIds).toEqual(['cg-canyon']);
    expect(list[0].siteType).toBe('tent');
    expect(list[0].active).toBe(true);
    expect(list[0].label).toBe('Canyon July');
  });

  it('appears in the poller fan-out with email opt-in default OFF', async () => {
    const rows = await usersWithCampWatches();
    const mine = rows.filter((x) => x.watch.userId === userId);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0].emailOptIn).toBe(false);
    expect(mine[0].watch.startDate).toBe('2030-07-03');
  });

  it('records a snapshot + throttle stamp', async () => {
    const w = (await listCampWatches(userId))[0];
    await recordCampWatchSnapshot(w.id, JSON.stringify(['cg-canyon|2030-07-03|s1']), true);
    const after = (await listCampWatches(userId)).find((x) => x.id === w.id)!;
    expect(after.lastSnapshot).toContain('cg-canyon|2030-07-03|s1');
    expect(after.lastNotifiedAt).toBeTruthy();
  });

  it('auto-expires a watch whose window has passed', async () => {
    const past = await createCampWatch(userId, {
      campgroundIds: ['cg-canyon'],
      recAreaId: null,
      startDate: '2000-01-01',
      endDate: '2000-01-03',
      nights: 2,
      minNights: null,
      siteType: 'any',
      weekendOnly: false,
      hookups: null,
      ada: false,
      label: 'past',
    });
    expect('id' in past).toBe(true);
    const n = await expireCampWatches();
    expect(n).toBeGreaterThanOrEqual(1);
    // Expired watch drops out of the poller fan-out (active=false) but is still listed.
    const fanout = (await usersWithCampWatches()).filter((x) => x.watch.userId === userId);
    expect(fanout.some((x) => x.watch.label === 'past')).toBe(false);
    const expired = (await listCampWatches(userId)).find((x) => x.label === 'past');
    expect(expired?.active).toBe(false);
  });

  it('caps active camp watches at CAMP_WATCH_CAP', async () => {
    const capUser = `test-camp-cap-${randomUUID()}`;
    try {
      for (let i = 0; i < CAMP_WATCH_CAP; i++) {
        const r = await createCampWatch(capUser, {
          campgroundIds: ['cg-canyon'], recAreaId: null, startDate: '2030-07-01', endDate: '2030-07-02',
          nights: 1, minNights: null, siteType: 'any', weekendOnly: false, hookups: null, ada: false, label: `w${i}`,
        });
        expect('id' in r).toBe(true);
      }
      const blocked = await createCampWatch(capUser, {
        campgroundIds: ['cg-canyon'], recAreaId: null, startDate: '2030-07-01', endDate: '2030-07-02',
        nights: 1, minNights: null, siteType: 'any', weekendOnly: false, hookups: null, ada: false, label: 'too many',
      });
      expect('error' in blocked).toBe(true);
    } finally {
      await writeGraph(`MATCH (u:User {userId:$userId})-[:WATCHING]->(w:CampWatch) DETACH DELETE w`, { userId: capUser });
      await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId: capUser });
    }
  });

  it('delete is user-scoped', async () => {
    const w = (await listCampWatches(userId)).find((x) => x.label === 'Canyon July')!;
    await deleteCampWatch(`other-${randomUUID()}`, w.id);
    expect((await listCampWatches(userId)).some((x) => x.id === w.id)).toBe(true);
    await deleteCampWatch(userId, w.id);
    expect((await listCampWatches(userId)).some((x) => x.id === w.id)).toBe(false);
  });
});
