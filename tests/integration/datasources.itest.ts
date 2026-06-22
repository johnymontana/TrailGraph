import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph, readGraph } from '../../lib/neo4j';
import { parkDetail, searchParks } from '../../lib/queries';
import { writePreferenceBridge, setPreferenceWeight } from '../../lib/bridges';
import { forYou } from '../../lib/recommend';
import { applyTrailDifficulty } from '../../lib/datasources/trails';
import { applyDarkSky } from '../../lib/datasources/darksky';
import { applyReservations } from '../../lib/datasources/recreation';
import { applyPermits } from '../../lib/datasources/permits';

/**
 * §5 data sources + weighted recommendations against a real Neo4j (gated by RUN_INTEGRATION=1). The
 * seed sets dark-sky/crowd/difficulty fixtures on yell/grca/glac (see scripts/seed-test-data.ts).
 */
describeIntegration('§5 data sources + personalization', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await closeDriver();
  });

  it('parkDetail surfaces dark-sky + crowd conditions and thing-to-do difficulty', async () => {
    const grca = await parkDetail('grca');
    expect(grca?.darkSkyCertified).toBe(true);
    expect(grca?.bortleScale).toBe(2);
    // seeded ThingToDo "Easy rim walk" → derived difficulty 'easy'
    expect((grca?.thingsToDo as { difficulty: string | null }[]).some((n) => n.difficulty === 'easy')).toBe(true);

    const glac = await parkDetail('glac');
    expect(glac?.crowdLevel).toBe('high');
    expect(glac?.bestMonths).toEqual([5, 9]);
    expect((glac?.monthlyVisits as number[]).length).toBe(12); // feeds the visitation chart (§5b)
  });

  it('searchParks darkSky facet returns only certified parks', async () => {
    const { items } = await searchParks({ darkSky: true, limit: 50 });
    const codes = items.map((p) => p.parkCode);
    expect(codes).toEqual(expect.arrayContaining(['grca', 'glac']));
    expect(codes).not.toContain('yell'); // not dark-sky certified in the fixtures
  });

  it('applyDarkSky / applyTrailDifficulty are idempotent and write to real parks', async () => {
    expect(await applyDarkSky([{ parkCode: 'grca', certified: true, bortle: 2 }])).toBe(1);
    expect(await applyTrailDifficulty()).toBeGreaterThanOrEqual(1);
  });

  it('applyReservations derives a ridbId from the campground recreation.gov URL (§5d)', async () => {
    // Seeded Canyon Campground carries a recreation.gov reservationUrl → ridbId 232449 extracted.
    expect(await applyReservations()).toBeGreaterThanOrEqual(1);
    const rows = await readGraph<{ ridbId: string }>(
      `MATCH (c:Campground {id:'cg-canyon'}) RETURN c.ridbId AS ridbId`,
    );
    expect(rows[0]?.ridbId).toBe('232449');
  });

  it('applyPermits flags timed-entry parks + sets a permit URL (§4)', async () => {
    const n = await applyPermits([{ parkCode: 'grca', url: 'https://www.recreation.gov/timed-entry' }]);
    expect(n).toBe(1);
    const grca = await parkDetail('grca');
    expect(grca?.timedEntry).toBe(true);
    expect(grca?.permitUrl).toBe('https://www.recreation.gov/timed-entry');
  });

  it('forYou ranks by preference weight; muting the only preference falls back to popular', async () => {
    const userId = `itest-weight-${randomUUID()}`;
    await writeGraph(`MERGE (u:User {userId:$userId})`, { userId });
    await writePreferenceBridge({ userId, category: 'activity', value: 'astronomy' });

    const personalized = await forYou(userId, { limit: 10 });
    expect(personalized.source).toBe('personalized');
    expect(personalized.parks.map((p) => p.parkCode)).toEqual(expect.arrayContaining(['grca', 'glac']));

    // Down-rank Astronomy to 0 → no active preferences → popular fallback.
    await setPreferenceWeight(userId, 'activity', 'Astronomy', 0);
    const muted = await forYou(userId, { limit: 10 });
    expect(muted.source).toBe('popular');

    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
  });
});
