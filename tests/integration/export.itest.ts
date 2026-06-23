import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver } from '../../lib/neo4j';
import { createTrip, addStop, deleteTrip, getTrip } from '../../lib/trips';
import { tripToGpx } from '../../lib/trip-gpx';
import { tripToIcs } from '../../lib/trip-ics';

/**
 * Trip export end-to-end against real Neo4j (ADR-048): build a real trip (reified :Stop + :DRIVE_TO
 * segments), hydrate via getTrip, and serialize. Exercises the full read-side path the unit tests mock.
 */
describeIntegration('trip export (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  let tripId: string;

  beforeAll(async () => {
    await seedTestData();
    tripId = await createTrip(userId, { name: 'Export Trip', startDate: '2026-07-01' });
    await addStop(userId, tripId, { kind: 'park', refId: 'yell' });
    await addStop(userId, tripId, { kind: 'park', refId: 'glac' });
  });
  afterAll(async () => {
    await deleteTrip(userId, tripId).catch(() => {});
    await closeDriver();
  });

  it('tripToGpx emits a waypoint per located stop + a connector track, with the drive leg in the desc', async () => {
    const trip = await getTrip(userId, tripId);
    const gpx = tripToGpx(trip!, { time: '2026-06-23T00:00:00Z' });
    expect(gpx).toContain('<gpx version="1.1"');
    expect((gpx.match(/<wpt /g) ?? []).length).toBe(2);
    expect(gpx).toContain('Yellowstone');
    expect(gpx).toContain('Glacier');
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(2);
    expect(gpx).toMatch(/Drive to next: \d+ mi \/ \d+ min/); // ORS or great-circle fallback
    expect(gpx).toContain('straight stop-to-stop connector'); // honesty caveat in metadata
  });

  it('tripToIcs emits a VEVENT per stop and bakes twilight from the injected sun (stops have coords)', async () => {
    const trip = await getTrip(userId, tripId);
    const ics = tripToIcs(trip!, {
      baseDate: '20260701',
      stamp: '20260101T000000Z',
      sun: () => ({ moonIllumination: 30, darkHours: 7.5 }),
    });
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect(ics).toContain('Yellowstone');
    expect(ics).toContain('Moon 30% illuminated');
    expect(ics).toContain('7.5h of astronomical darkness');
  });
});
