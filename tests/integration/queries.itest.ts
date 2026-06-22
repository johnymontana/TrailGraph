import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver } from '../../lib/neo4j';
import { searchParks, parkDetail, parksNear, parksInBBox, facets, similarParks } from '../../lib/queries';

describeIntegration('domain read queries (Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await closeDriver();
  });

  it('faceted search filters by activity', async () => {
    const { items: parks, total } = await searchParks({ activity: 'Astronomy' });
    const codes = parks.map((p) => p.parkCode);
    expect(total).toBeGreaterThanOrEqual(2);
    expect(codes).toContain('grca');
    expect(codes).toContain('glac');
    expect(codes).not.toContain('yell'); // Yellowstone offers Hiking, not Astronomy
  });

  it('park detail returns parsed nested fields + active alerts', async () => {
    const park = await parkDetail('yell');
    expect(park).not.toBeNull();
    expect(park!.name).toBe('Yellowstone National Park');
    expect(park!.activities).toContain('Hiking');
    // State names populated (not ", ," — §2.8): seed sets WY/MT names.
    expect((park!.states as { name: string }[]).map((s) => s.name)).toEqual(
      expect.arrayContaining(['Wyoming', 'Montana']),
    );
    expect(Array.isArray(park!.entranceFees)).toBe(true);
    expect((park!.entranceFees as unknown[]).length).toBe(1);
    expect(park!.alerts.some((a) => a.category === 'Closure')).toBe(true);
    // Park-local data surfaced on the page (§7): Yellowstone has a seeded campground + visitor center.
    expect((park!.campgrounds as { name: string }[]).some((c) => c.name === 'Canyon Campground')).toBe(true);
    expect((park!.visitorCenters as { name: string }[]).length).toBeGreaterThanOrEqual(1);
  });

  it('similarParks surfaces parks sharing activities/topics (§6)', async () => {
    // Grand Canyon offers Astronomy + Hiking; Glacier shares both.
    const similar = await similarParks('grca');
    const glac = similar.find((p) => p.parkCode === 'glac');
    expect(glac).toBeTruthy();
    expect(glac!.shared).toBeGreaterThanOrEqual(1);
    expect(similar.some((p) => p.parkCode === 'grca')).toBe(false); // excludes self
  });

  it('proximity returns parks within radius ordered by distance', async () => {
    const near = await parksNear(44.6, -110.5, 300); // near Yellowstone
    expect(near[0].parkCode).toBe('yell');
    expect(near[0].miles).toBeLessThan(1);
  });

  it('bbox returns parks inside the box only', async () => {
    const box = { minLat: 40, minLng: -116, maxLat: 50, maxLng: -108 }; // NW US: yell + glac, not grca
    const codes = (await parksInBBox(box)).map((p) => p.parkCode);
    expect(codes).toContain('yell');
    expect(codes).toContain('glac');
    expect(codes).not.toContain('grca');
  });

  it('facets expose activities and topics', async () => {
    const f = await facets();
    expect(f.activities).toContain('Astronomy');
    expect(f.topics).toContain('Lakes');
  });
});
