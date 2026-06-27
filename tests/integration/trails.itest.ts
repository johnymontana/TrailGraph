import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver } from '../../lib/neo4j';
import { searchTrails, trailFacets, trailDetail, parksWithTrails, trailheadsInBBox } from '../../lib/queries';

/**
 * Real hiking trails (ADR-066) — the finder + detail reads against the seeded :Trail fixtures
 * (grca: Bright Angel + South Kaibab; yell: Storm Point; glac: Avalanche Lake + Highline;
 * zion: Angels Landing [permit]). Self-skips without RUN_INTEGRATION=1 + a reachable Neo4j.
 */
describeIntegration('Trail finder (Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await closeDriver();
  });

  const codes = (r: { items: { id: string }[] }) => r.items.map((t) => t.id).sort();

  it('searchTrails() returns all seeded trails, longest-first', async () => {
    const r = await searchTrails({ limit: 50 });
    expect(r.total).toBe(6);
    expect(r.items[0].name).toBe('Highline Trail'); // 11.8 mi, longest
    expect(r.items[0].parkName).toBe('Glacier National Park');
  });

  it('filters by difficulty, length, gain', async () => {
    expect(codes(await searchTrails({ difficulty: 'easy' }))).toEqual(['nps:yell:storm-point-trail']);
    expect(codes(await searchTrails({ maxMiles: 3 }))).toEqual(['nps:yell:storm-point-trail']);
    expect(codes(await searchTrails({ maxGainFt: 500 }))).toEqual(['nps:yell:storm-point-trail']);
  });

  it('maxDifficulty is a CEILING (this band or easier), unlike exact difficulty (ADR-071)', async () => {
    // easy ceiling == only easy trails (here, the same single easy trail).
    expect(codes(await searchTrails({ maxDifficulty: 'easy' }))).toEqual(['nps:yell:storm-point-trail']);
    // moderate ceiling includes easy + moderate but NOT the strenuous trails.
    const upToModerate = codes(await searchTrails({ maxDifficulty: 'moderate' }));
    expect(upToModerate).toContain('nps:yell:storm-point-trail'); // easy
    expect(upToModerate).not.toContain('nps:grca:bright-angel-trail'); // strenuous
    expect(upToModerate).not.toContain('nps:zion:angels-landing-trail'); // strenuous
    // strenuous ceiling admits everything (all 6 seeded trails are ranked).
    expect((await searchTrails({ maxDifficulty: 'strenuous' })).total).toBe(6);
  });

  it('filters by park, allowed use, route type, and permit', async () => {
    expect(codes(await searchTrails({ parkCode: 'grca' }))).toEqual([
      'nps:grca:bright-angel-trail',
      'nps:grca:south-kaibab-trail',
    ]);
    expect(codes(await searchTrails({ allowedUse: 'horse' }))).toEqual(['nps:grca:south-kaibab-trail']);
    expect(codes(await searchTrails({ routeType: 'loop' }))).toEqual(['nps:yell:storm-point-trail']);
    expect(codes(await searchTrails({ permitRequired: true }))).toEqual(['nps:zion:angels-landing-trail']);
  });

  it('full-text search matches the trail name', async () => {
    const r = await searchTrails({ q: 'angels' });
    expect(r.items.some((t) => t.id === 'nps:zion:angels-landing-trail')).toBe(true);
  });

  it('full-text search tolerates Lucene metacharacters without throwing (no 500)', async () => {
    // Raw punctuation used to throw a ParseException and crash the finder; now sanitized → never throws.
    await expect(searchTrails({ q: 'angels (loop / 5mi *' })).resolves.toBeTruthy();
    await expect(searchTrails({ q: '~:?[]' })).resolves.toBeTruthy();
  });

  it('trailFacets surfaces parks-with-trails + distinct route types', async () => {
    const f = await trailFacets();
    expect(f.parks.map((p) => p.parkCode).sort()).toEqual(['glac', 'grca', 'yell', 'zion']);
    expect(f.routeTypes).toEqual(expect.arrayContaining(['loop', 'point-to-point']));
  });

  it('parksWithTrails returns a per-park trail count', async () => {
    const parks = await parksWithTrails(50);
    const byCode = Object.fromEntries(parks.map((p) => [p.parkCode, p.trailCount]));
    expect(byCode.grca).toBe(2);
    expect(byCode.glac).toBe(2);
    expect(byCode.yell).toBe(1);
    expect(byCode.zion).toBe(1);
  });

  it('trailDetail returns metadata + logistics for a permit trail', async () => {
    const t = await trailDetail('nps:zion:angels-landing-trail');
    expect(t).not.toBeNull();
    expect(t!.name).toBe('Angels Landing Trail');
    expect(t!.parkName).toBe('Zion National Park');
    expect(t!.permitRequired).toBe(true);
    expect(t!.difficulty).toBe('strenuous');
    expect(t!.allowedUses).toEqual(['hike']);
    expect(Array.isArray(t!.trailheads)).toBe(true); // no parking seeded near it → []
    expect(t!.elevationGainFt).toBe(1500);
  });

  it('trailDetail returns null for an unknown id', async () => {
    expect(await trailDetail('nps:nope:nothing')).toBeNull();
  });

  it('trailheadsInBBox returns trailheads within a viewport (the map trails layer)', async () => {
    // bbox around the Grand Canyon (seeded trailheads ~36.05, -112.1); Zion (37.26) is outside.
    const items = await trailheadsInBBox({ minLat: 35.5, minLng: -113, maxLat: 36.5, maxLng: -111.5 });
    const ids = items.map((t) => t.id);
    expect(ids).toContain('nps:grca:bright-angel-trail');
    expect(ids).toContain('nps:grca:south-kaibab-trail');
    expect(ids).not.toContain('nps:zion:angels-landing-trail');
    expect(items[0]).toHaveProperty('lat');
    expect(items[0]).toHaveProperty('lng');
  });
});
