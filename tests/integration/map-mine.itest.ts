import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { considerPark, collectStamp } from '../../lib/bridges';
import { consideredParksGeo, collectedStampParksGeo, consideredBounds } from '../../lib/memory-graph';

/** The "your map" overlay (#6) memory reads behind /api/map/mine. Isolated by a fixed userId, cleaned up. */
const userId = 'itest-map-mine-user';

describeIntegration('map "your map" overlay memory reads (#6)', () => {
  beforeAll(async () => {
    await seedTestData();
    await considerPark(userId, 'yell');
    await collectStamp(userId, 'stamp-yell-canyon'); // seeded stamp IN_PARK yell
  });
  afterAll(async () => {
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('consideredParksGeo returns the user\'s located considered parks', async () => {
    const yell = (await consideredParksGeo(userId)).find((p) => p.parkCode === 'yell');
    expect(yell).toBeTruthy();
    expect(yell!.lat).toBeCloseTo(44.6, 1);
    expect(yell!.lng).toBeCloseTo(-110.5, 1);
  });

  it('collectedStampParksGeo returns parks behind collected passport stamps', async () => {
    expect((await collectedStampParksGeo(userId)).map((p) => p.parkCode)).toContain('yell');
  });

  it('consideredBounds frames the considered set [[w,s],[e,n]]', async () => {
    const bounds = await consideredBounds(userId);
    expect(bounds).not.toBeNull();
    const [[west, south], [east, north]] = bounds!;
    expect(west).toBeLessThanOrEqual(-110.5);
    expect(east).toBeGreaterThanOrEqual(-110.5);
    expect(south).toBeLessThanOrEqual(44.6);
    expect(north).toBeGreaterThanOrEqual(44.6);
  });
});
