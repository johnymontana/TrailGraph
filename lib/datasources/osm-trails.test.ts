import { describe, it, expect } from 'vitest';
import { bboxAround, osmUse, sacToDifficulty, osmWayToFeature, type OverpassElement } from './osm-trails';
import { aggregateTrails } from '../sync/trail-aggregate';

describe('bboxAround', () => {
  it('builds a symmetric bbox around a point', () => {
    expect(bboxAround(40, -110, 0.25)).toEqual({ south: 39.75, west: -110.25, north: 40.25, east: -109.75 });
  });
});

describe('osmUse (OSM tags → NPS-style TRLUSE)', () => {
  it('maps highway + access tags to canonical uses', () => {
    expect(osmUse({ highway: 'path' })).toBe('Hiker/Pedestrian');
    expect(osmUse({ highway: 'bridleway' })).toContain('Pack and Saddle');
    expect(osmUse({ highway: 'path', bicycle: 'yes' })).toContain('Bicycle');
    expect(osmUse({ highway: 'path', wheelchair: 'yes' })).toContain('ADA');
  });
  it('defaults to hiker when nothing matches', () => {
    expect(osmUse({})).toBe('Hiker/Pedestrian');
  });
});

describe('sacToDifficulty', () => {
  it('maps T1–T6 / named scales to bands', () => {
    expect(sacToDifficulty('T1')).toBe('easy');
    expect(sacToDifficulty('hiking')).toBe('easy');
    expect(sacToDifficulty('T3')).toBe('moderate');
    expect(sacToDifficulty('demanding_mountain_hiking')).toBe('moderate');
    expect(sacToDifficulty('T5')).toBe('strenuous');
    expect(sacToDifficulty(undefined)).toBeNull();
    expect(sacToDifficulty('weird')).toBeNull();
  });
});

describe('osmWayToFeature', () => {
  const way = (tags: Record<string, string>, geom: { lat: number; lon: number }[]): OverpassElement => ({
    type: 'way',
    id: 1,
    tags,
    geometry: geom,
  });
  it('produces an NPS-shaped feature with name + use', () => {
    const f = osmWayToFeature(way({ name: 'Sky Trail', highway: 'path' }, [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }]), 'PINN')!;
    expect(f.properties?.TRLNAME).toBe('Sky Trail');
    expect(f.properties?.UNITCODE).toBe('PINN');
    expect(f.geometry.type).toBe('LineString');
  });
  it('drops nameless or degenerate ways', () => {
    expect(osmWayToFeature(way({ highway: 'path' }, [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }]), 'PINN')).toBeNull();
    expect(osmWayToFeature(way({ name: 'X', highway: 'path' }, [{ lat: 0, lon: 0 }]), 'PINN')).toBeNull();
  });
});

describe('OSM → aggregateTrails(source:osm) reuse', () => {
  it('merges OSM ways into one osm:* trail through the shared pipeline', () => {
    const f1 = osmWayToFeature({ type: 'way', id: 1, tags: { name: 'Sky Trail', highway: 'path' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.005 }] }, 'PINN')!;
    const f2 = osmWayToFeature({ type: 'way', id: 2, tags: { name: 'Sky Trail', highway: 'path' }, geometry: [{ lat: 0, lon: 0.005 }, { lat: 0, lon: 0.01 }] }, 'PINN')!;
    const trails = aggregateTrails([f1, f2], { parkCode: 'pinn', source: 'osm' });
    expect(trails).toHaveLength(1);
    expect(trails[0].id).toBe('osm:pinn:sky-trail');
    expect(trails[0].source).toBe('osm');
    expect(trails[0].segments).toBe(2);
    expect(trails[0].lengthMiles).toBeGreaterThan(0);
  });
});
