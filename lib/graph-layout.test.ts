import { describe, it, expect } from 'vitest';
import { mercatorXY, geographicPositions, radialPositions } from './graph-layout';

describe('mercatorXY', () => {
  it('maps the prime meridian / equator to the center', () => {
    const { x, y } = mercatorXY(0, 0, 1000);
    expect(x).toBeCloseTo(500, 5);
    expect(y).toBeCloseTo(500, 5);
  });

  it('is north-up (positive latitude → smaller y)', () => {
    expect(mercatorXY(45, 0).y).toBeLessThan(mercatorXY(0, 0).y);
    expect(mercatorXY(-45, 0).y).toBeGreaterThan(mercatorXY(0, 0).y);
  });

  it('east is +x', () => {
    expect(mercatorXY(0, 90).x).toBeGreaterThan(mercatorXY(0, -90).x);
  });

  it('clamps latitude past the Mercator limit (no Infinity at the poles)', () => {
    expect(Number.isFinite(mercatorXY(90, 0).y)).toBe(true);
    expect(Number.isFinite(mercatorXY(-90, 0).y)).toBe(true);
    expect(mercatorXY(89.9, 0).y).toBeCloseTo(mercatorXY(85.05112878, 0).y, 5);
  });
});

describe('geographicPositions', () => {
  it('projects nodes with coordinates and skips those without', () => {
    const out = geographicPositions([
      { id: 'a', lat: 40, lng: -100 },
      { id: 'b', lat: null, lng: -100 },
      { id: 'c', lat: 40 },
      { id: 'd', lat: 35, lng: -110 },
    ]);
    expect(out.map((p) => p.id)).toEqual(['a', 'd']);
    expect(out[0]).toMatchObject({ id: 'a' });
    expect(typeof out[0].x).toBe('number');
  });
});

describe('radialPositions', () => {
  it('places ids evenly on a ring with the first at angle 0', () => {
    const out = radialPositions(['a', 'b', 'c', 'd'], 400);
    expect(out).toHaveLength(4);
    expect(out[0].x).toBeCloseTo(400, 5);
    expect(out[0].y).toBeCloseTo(0, 5);
    // all on the same radius
    for (const p of out) expect(Math.hypot(p.x, p.y)).toBeCloseTo(400, 5);
  });

  it('handles an empty / single id without dividing by zero', () => {
    expect(radialPositions([])).toEqual([]);
    expect(radialPositions(['solo'], 100)[0]).toMatchObject({ id: 'solo' });
  });
});
