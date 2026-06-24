import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { submitReading, skyLeaderboard, myReadings } from '../../lib/readings';
import { setCollectiveOptIn } from '../../lib/collective';
import { crowdCurve, landingStats } from '../../lib/queries';

/** Collective Intelligence v2 (ADR-053): UGC SQM readings, anonymized median leaderboard, crowd curves. */
describeIntegration('Collective Intelligence v2 (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  const optedOut = `test-${randomUUID()}`;
  const NIGHT = '2026-06-20';

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    for (const u of [userId, optedOut]) {
      await writeGraph(`MATCH (r:UserReading {userId:$u}) DETACH DELETE r`, { u });
      await writeGraph(`MATCH (n:User {userId:$u}) DETACH DELETE n`, { u });
    }
    await closeDriver();
  });

  it('rejects out-of-range SQM and unknown parks', async () => {
    expect((await submitReading(userId, 'grca', 10)).ok).toBe(false);
    expect((await submitReading(userId, 'grca', 25)).ok).toBe(false);
    expect((await submitReading(userId, 'zzzz', 21)).ok).toBe(false); // no such park
  });

  it('submits a reading and dedupes per park per night (re-submit updates)', async () => {
    expect((await submitReading(userId, 'grca', 21.5, NIGHT)).ok).toBe(true);
    expect((await submitReading(userId, 'grca', 21.8, NIGHT)).ok).toBe(true); // same night → update
    const mine = await myReadings(userId);
    const grca = mine.filter((m) => m.parkCode === 'grca');
    expect(grca).toHaveLength(1); // not duplicated
    expect(grca[0].sqm).toBe(21.8); // value updated
  });

  it('leaderboard ranks by median, counts only opted-in users, and is anonymized', async () => {
    await setCollectiveOptIn(userId, true);
    await submitReading(userId, 'grca', 21.8, NIGHT);
    // An opted-OUT user's low reading must NOT drag the median down.
    await setCollectiveOptIn(optedOut, false);
    await submitReading(optedOut, 'grca', 16.5, NIGHT);

    const lb = await skyLeaderboard();
    const grca = lb.find((e) => e.parkCode === 'grca');
    expect(grca).toBeTruthy();
    expect(grca!.medianSqm).toBeCloseTo(21.8, 1); // opted-out reading excluded
    expect(grca!.contributors).toBe(1);
    expect((grca as unknown as Record<string, unknown>).userId).toBeUndefined(); // no identities leaked
  });

  it('crowdCurve returns a 12-point normalized seasonality for a seeded park', async () => {
    const c = await crowdCurve('glac'); // glac has monthlyVisits in the seed
    expect(c).not.toBeNull();
    expect(c!.points).toHaveLength(12);
    expect(Math.max(...c!.points.map((p) => p.pct))).toBe(100);
    expect(c!.points.every((p) => p.pct >= 0 && p.pct <= 100)).toBe(true);
  });

  it('crowdCurve is null for a park without visitation data', async () => {
    expect(await crowdCurve('zzzz')).toBeNull();
  });

  it('landingStats returns positive graph counts incl. dark-sky parks', async () => {
    const s = await landingStats();
    expect(s.parks).toBeGreaterThan(0);
    expect(s.darkSky).toBeGreaterThanOrEqual(2); // grca + glac are certified in the seed
  });
});
