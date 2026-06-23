import { describe, it, expect } from 'vitest';
import { generateGPX } from './gpx';

const META = { name: 'Big Sky Loop', time: '2026-06-23T00:00:00Z' };

describe('generateGPX (ADR-048)', () => {
  it('emits a valid GPX 1.1 envelope with metadata', () => {
    const gpx = generateGPX(META, [], []);
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('<gpx version="1.1" creator="TrailGraph" xmlns="http://www.topografix.com/GPX/1/1">');
    expect(gpx).toContain('<name>Big Sky Loop</name>');
    expect(gpx).toContain('<time>2026-06-23T00:00:00Z</time>');
    expect(gpx.trimEnd().endsWith('</gpx>')).toBe(true);
  });

  it('writes one <wpt> per waypoint with name/type/desc and 6-dp coordinates', () => {
    const gpx = generateGPX(META, [{ lat: 44.6, lon: -110.5, name: '1. Yellowstone', type: 'park', desc: 'Drive to next: 84 mi / 95 min' }], []);
    expect(gpx).toContain('<wpt lat="44.600000" lon="-110.500000">');
    expect(gpx).toContain('<name>1. Yellowstone</name>');
    expect(gpx).toContain('<type>park</type>');
    expect(gpx).toContain('<desc>Drive to next: 84 mi / 95 min</desc>');
  });

  it('writes a single <trk>/<trkseg> with trackpoints in order', () => {
    const gpx = generateGPX(META, [], [{ name: 'route', points: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] }]);
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(2);
    const first = gpx.indexOf('lat="1.000000"');
    const second = gpx.indexOf('lat="3.000000"');
    expect(first).toBeLessThan(second); // order preserved
  });

  it('XML-escapes names and is deterministic for a fixed time', () => {
    const a = generateGPX({ name: 'Tom & Jerry <Park>', time: META.time }, [], []);
    expect(a).toContain('Tom &amp; Jerry &lt;Park&gt;');
    expect(a).toEqual(generateGPX({ name: 'Tom & Jerry <Park>', time: META.time }, [], []));
  });

  it('omits an empty track', () => {
    const gpx = generateGPX(META, [{ lat: 1, lon: 2, name: 'only stop' }], [{ name: 'route', points: [] }]);
    expect(gpx).not.toContain('<trk>');
  });
});
