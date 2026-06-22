import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver } from '../../lib/neo4j';
import {
  campgroundsInBBox,
  visitorCentersInBBox,
  thingsToDoInBBox,
  alertParksInBBox,
  type BBox,
} from '../../lib/queries';

/** B3 map-layer viewport queries. */
describeIntegration('map layers by bbox (Neo4j)', () => {
  // Box around Yellowstone (campground + visitor center + closure alert live here).
  const yellBox: BBox = { minLat: 44, minLng: -111, maxLat: 45, maxLng: -110 };
  // Box around Grand Canyon (thing-to-do).
  const grcaBox: BBox = { minLat: 35.5, minLng: -113, maxLat: 36.5, maxLng: -111.5 };

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await closeDriver();
  });

  it('campgrounds layer returns campgrounds in the viewport, linked to their park', async () => {
    const cgs = await campgroundsInBBox(yellBox);
    const canyon = cgs.find((c) => c.id === 'cg-canyon');
    expect(canyon).toBeTruthy();
    expect(canyon!.parkCode).toBe('yell');
    expect(canyon!.lat).toBeGreaterThan(44);
  });

  it('visitor centers layer returns VCs in the viewport', async () => {
    const vcs = await visitorCentersInBBox(yellBox);
    expect(vcs.some((v) => v.id === 'vc-canyon')).toBe(true);
  });

  it('things-to-do layer returns POIs in the viewport, not outside it', async () => {
    const ttds = await thingsToDoInBBox(grcaBox);
    expect(ttds.some((t) => t.id === 'ttd-rim' && t.name === 'Hike the South Rim')).toBe(true);
    // The Grand Canyon thing-to-do is NOT in the Yellowstone box.
    const inYell = await thingsToDoInBBox(yellBox);
    expect(inYell.some((t) => t.id === 'ttd-rim')).toBe(false);
  });

  it('alerts layer returns parks with active Closure/Danger alerts in the viewport', async () => {
    const alertParks = await alertParksInBBox(yellBox);
    const yell = alertParks.find((p) => p.parkCode === 'yell');
    expect(yell).toBeTruthy();
    expect(yell!.alerts).toBeGreaterThanOrEqual(1);
  });
});
