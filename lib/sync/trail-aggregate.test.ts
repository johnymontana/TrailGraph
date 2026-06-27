import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import {
  metersToMiles,
  slugify,
  trailId,
  parseAllowedUses,
  parseTrailClass,
  deriveRouteType,
  simplifyLine,
  aggregateTrails,
} from './trail-aggregate';

function line(coords: number[][], props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: props,
  };
}

describe('metersToMiles / slugify / trailId', () => {
  it('converts meters to miles', () => {
    expect(metersToMiles(1609.344)).toBe(1);
    expect(metersToMiles(0)).toBe(0);
  });
  it('slugifies names', () => {
    expect(slugify('Bright Angel Trail')).toBe('bright-angel-trail');
    expect(slugify("Devil's  Garden")).toBe('devils-garden');
  });
  it('builds a stable id', () => {
    expect(trailId('grca', 'Bright Angel Trail')).toBe('nps:grca:bright-angel-trail');
  });
});

describe('parseAllowedUses (TRLUSE → canonical)', () => {
  it('maps a delimited use list', () => {
    expect(parseAllowedUses('Hiker/Pedestrian; Bicycle')).toEqual(
      expect.arrayContaining(['hike', 'bike']),
    );
    expect(parseAllowedUses('Pack and Saddle')).toContain('horse');
    expect(parseAllowedUses('ADA Accessible')).toContain('ada');
  });
  it('defaults an unparseable/empty use to hike (it is still a trail)', () => {
    expect(parseAllowedUses('')).toEqual(['hike']);
    expect(parseAllowedUses(null)).toEqual(['hike']);
  });
});

describe('parseTrailClass', () => {
  it('extracts 1–5', () => {
    expect(parseTrailClass('Class 3')).toBe(3);
    expect(parseTrailClass('5')).toBe(5);
    expect(parseTrailClass('TC2')).toBe(2);
    expect(parseTrailClass(null)).toBeNull();
    expect(parseTrailClass('unknown')).toBeNull();
  });
});

describe('deriveRouteType (topology)', () => {
  it('point-to-point for a single open line', () => {
    expect(deriveRouteType([[[0, 0], [1, 1]]])).toBe('point-to-point');
  });
  it('loop when endpoints all coincide (no termini)', () => {
    expect(
      deriveRouteType([
        [[0, 0], [1, 0]],
        [[1, 0], [1, 1]],
        [[1, 1], [0, 1]],
        [[0, 1], [0, 0]],
      ]),
    ).toBe('loop');
  });
  it('network when a junction (degree ≥ 3) exists', () => {
    expect(
      deriveRouteType([
        [[0, 0], [1, 1]],
        [[1, 1], [2, 2]],
        [[1, 1], [2, 0]],
      ]),
    ).toBe('network');
  });
});

describe('simplifyLine (Douglas–Peucker)', () => {
  it('drops a near-collinear midpoint', () => {
    const out = simplifyLine([[0, 0], [0.5, 0.0000001], [1, 0]], 0.0001);
    expect(out).toEqual([[0, 0], [1, 0]]);
  });
  it('keeps a sharp corner', () => {
    const out = simplifyLine([[0, 0], [0.5, 0.5], [1, 0]], 0.0001);
    expect(out).toHaveLength(3);
  });
});

describe('aggregateTrails (ADR-066 named-aggregate)', () => {
  const features: Feature[] = [
    line([[0, 0], [0.005, 0]], { TRLNAME: 'Bright Angel Trail', UNITCODE: 'GRCA', Shape__Length: 800, TRLCLASS: 'Class 3', TRLSURFACE: 'Dirt' }),
    line([[0.005, 0], [0.01, 0]], { TRLNAME: 'Bright Angel Trail', UNITCODE: 'GRCA', Shape__Length: 809.344, TRLUSE: 'Hiker/Pedestrian' }),
    line([[1, 1], [1.01, 1]], { TRLNAME: '', UNITCODE: 'GRCA', Shape__Length: 500 }), // blank → dropped
    line([[2, 2], [2.02, 2]], { TRLNAME: 'Rim Trail', UNITCODE: 'GRCA', Shape__Length: 3000, TRLSURFACE: 'Paved', TRLUSE: 'ADA Accessible' }),
  ];

  it('merges segments sharing TRLNAME, drops blank-named connectors', () => {
    const trails = aggregateTrails(features, { parkCode: 'grca' });
    expect(trails).toHaveLength(2);
    const ba = trails.find((t) => t.name === 'Bright Angel Trail')!;
    expect(ba.id).toBe('nps:grca:bright-angel-trail');
    expect(ba.segments).toBe(2);
    expect(ba.geometry.type).toBe('MultiLineString');
    expect(ba.geometry.coordinates).toHaveLength(2);
  });

  it('computes length GEODESICALLY from coords, ignoring the (degrees) Shape__Length field', () => {
    const trails = aggregateTrails(features, { parkCode: 'grca' });
    const ba = trails.find((t) => t.name === 'Bright Angel Trail')!;
    // [0,0]→[0.01,0] ≈ 0.69 mi (1112 m). If Shape__Length (800+809=1609) were used as meters it'd be 1.0.
    expect(ba.lengthMiles).toBeGreaterThan(0.6);
    expect(ba.lengthMiles).toBeLessThan(0.75);
  });

  it('marks paved/ADA trails wheelchair-accessible and sorts longest-first', () => {
    const trails = aggregateTrails(features, { parkCode: 'grca' });
    expect(trails[0].name).toBe('Rim Trail'); // longest
    expect(trails[0].wheelchairAccessible).toBe(true);
    expect(trails[0].allowedUses).toContain('ada');
  });

  it('assigns a bbox + a deterministic trailhead point', () => {
    const trails = aggregateTrails(features, { parkCode: 'grca' });
    const ba = trails.find((t) => t.name === 'Bright Angel Trail')!;
    expect(ba.bbox).toEqual([0, 0, 0.01, 0]);
    expect(ba.trailheadPoint).toEqual([0, 0]);
    expect(ba.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('groups by SLUG so punctuation/spacing variants of a name collapse to one trail (no id collision)', () => {
    const variants: Feature[] = [
      line([[0, 0], [0.005, 0]], { TRLNAME: 'Rim-to-Rim', UNITCODE: 'GRCA' }),
      line([[0.005, 0], [0.01, 0]], { TRLNAME: 'Rim to Rim', UNITCODE: 'GRCA' }),
    ];
    const trails = aggregateTrails(variants, { parkCode: 'grca' });
    expect(trails).toHaveLength(1);
    expect(trails[0].id).toBe('nps:grca:rim-to-rim');
    expect(trails[0].segments).toBe(2);
  });

  it('folds status into the content hash (a closure must invalidate the per-park sync hash)', () => {
    const open = aggregateTrails(
      [line([[0, 0], [0.01, 0]], { TRLNAME: 'Test Trail', UNITCODE: 'GRCA', TRLSTATUS: 'Existing' })],
      { parkCode: 'grca' },
    )[0];
    const closed = aggregateTrails(
      [line([[0, 0], [0.01, 0]], { TRLNAME: 'Test Trail', UNITCODE: 'GRCA', TRLSTATUS: 'Closed' })],
      { parkCode: 'grca' },
    )[0];
    expect(open.contentHash).not.toBe(closed.contentHash);
  });
});
