// fetchParkBoundary reads env.nps.baseUrl; ensure the key is present so the env doesn't throw (the NPS
// boundary fetch itself degrades to an empty FeatureCollection on any network/404 error in CI).
process.env.NPS_API_KEY ||= 'integration-test';

import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver } from '../../lib/neo4j';
import { areaBrief } from '../../lib/area-pack';

/** The offline/field area pack (#10) over a real graph. NW box contains yell + glac (+ their POIs), not grca. */
const NW = { minLat: 40, minLng: -116, maxLat: 50, maxLng: -108 };

describeIntegration('areaBrief offline pack (Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await closeDriver();
  });

  it('gathers parks + the requested POIs + a boundary entry per located park', async () => {
    const brief = await areaBrief(NW, ['campgrounds', 'visitorcenters']);
    const codes = brief.parks.map((p) => p.parkCode);
    expect(codes).toContain('yell');
    expect(codes).toContain('glac');
    expect(codes).not.toContain('grca');

    // Yellowstone's seeded campground (cg-canyon) + visitor center (vc-canyon) fall in the box.
    expect(brief.pois.some((p) => p.layer === 'campgrounds' && p.parkCode === 'yell')).toBe(true);
    expect(brief.pois.some((p) => p.layer === 'visitorcenters' && p.parkCode === 'yell')).toBe(true);
    // Things-to-do was NOT requested → not fetched.
    expect(brief.pois.some((p) => p.layer === 'thingstodo')).toBe(false);

    // One boundary entry per located park (geojson may be an empty FC when NPS is unreachable — fine).
    expect(brief.boundaries.map((b) => b.parkCode).sort()).toEqual([...codes].sort());
    expect(brief.layers).toEqual(['campgrounds', 'visitorcenters']);
    expect(brief.capped.parks).toBe(false);
  });
});
