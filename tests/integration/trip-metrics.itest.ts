import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { createTrip, addStop, deleteTrip } from '../../lib/trips';
import { tripMetrics } from '../../lib/trip-lab';

/**
 * tripMetrics is the live running-total the build-on-map canvas + the trip mutation responses surface (#9).
 * skipAlerts avoids the one external NPS call so this stays a pure graph + ephemeris + cost computation.
 */
const userId = 'itest-trip-metrics-user';

describeIntegration('tripMetrics live running-total (#9)', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId });
    await closeDriver();
  });

  it('aggregates stops / parks / drive distance after adding parks', async () => {
    const tripId = await createTrip(userId, { name: 'Metrics Trip' });
    try {
      await addStop(userId, tripId, { kind: 'park', refId: 'yell' });
      await addStop(userId, tripId, { kind: 'park', refId: 'glac' });
      const m = await tripMetrics(userId, tripId, { skipAlerts: true });
      expect(m).not.toBeNull();
      expect(m!.stops).toBe(2);
      expect(m!.parks).toBe(2);
      expect(m!.driveMiles).toBeGreaterThan(0); // great-circle fallback drive yell↔glac when ORS is absent
    } finally {
      await deleteTrip(userId, tripId);
    }
  });
});
