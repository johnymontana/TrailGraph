import { describe, it, expect } from 'vitest';
import { getAstro, moonPhaseName, sqmFromBortle } from './astro';

// Grand Canyon — a known dark-sky park with a stable lat/lng.
const GC = { lat: 36.1069, lng: -112.1129 };

describe('moonPhaseName', () => {
  it('bins the principal phases', () => {
    expect(moonPhaseName(0).name).toBe('New');
    expect(moonPhaseName(90).name).toBe('First quarter');
    expect(moonPhaseName(180).name).toBe('Full');
    expect(moonPhaseName(270).name).toBe('Last quarter');
  });
  it('wraps negatives and >360', () => {
    expect(moonPhaseName(-10).name).toBe('New');
    expect(moonPhaseName(360).name).toBe('New');
  });
});

describe('sqmFromBortle', () => {
  it('is monotonic (darker Bortle → higher SQM) and always a labeled estimate', () => {
    expect(sqmFromBortle(1).sqm).toBeGreaterThan(sqmFromBortle(9).sqm);
    expect(sqmFromBortle(2).sqm).toBeGreaterThan(sqmFromBortle(4).sqm);
    for (const b of [1, 2, 5, 9]) {
      const e = sqmFromBortle(b);
      expect(e.estimate).toBe(true);
      expect(e.label).toMatch(/Bortle/);
    }
  });
  it('clamps out-of-range input', () => {
    expect(sqmFromBortle(0).sqm).toBe(sqmFromBortle(1).sqm);
    expect(sqmFromBortle(99).sqm).toBe(sqmFromBortle(9).sqm);
  });
});

describe('getAstro golden values', () => {
  it('reports ~0% illumination at a new moon (2024-04-08)', () => {
    const m = getAstro(GC.lat, GC.lng, '2024-04-08').moon;
    expect(m.illuminationPct).toBeLessThanOrEqual(2);
    expect(['New', 'Waning crescent', 'Waxing crescent']).toContain(m.phaseName);
  });
  it('reports ~100% illumination at a full moon (2024-04-23)', () => {
    const m = getAstro(GC.lat, GC.lng, '2024-04-23').moon;
    expect(m.illuminationPct).toBeGreaterThanOrEqual(98);
    expect(m.phaseName).toBe('Full');
  });
  it('has a real dark window and sunrise before sunset in spring', () => {
    const a = getAstro(GC.lat, GC.lng, '2024-04-08');
    expect(a.darkHours.hours).not.toBeNull();
    expect(a.darkHours.hours!).toBeGreaterThan(4);
    expect(a.sun.rise! < a.sun.set!).toBe(true); // ISO timestamps compare lexicographically
  });
  it('places the galactic core in the SE and above the horizon (Arizona spring)', () => {
    const c = getAstro(GC.lat, GC.lng, '2024-04-08').galacticCore;
    expect(c.visible).toBe(true);
    expect(c.maxAltitudeDeg!).toBeGreaterThan(0);
    expect(c.riseAzimuthDeg!).toBeGreaterThan(100);
    expect(c.riseAzimuthDeg!).toBeLessThan(150);
  });
  it('is deterministic for identical inputs', () => {
    const a = getAstro(GC.lat, GC.lng, '2024-04-08');
    const b = getAstro(GC.lat, GC.lng, '2024-04-08');
    expect(a).toEqual(b);
  });
  it('returns null dark hours under the midnight sun (70°N, summer solstice)', () => {
    const a = getAstro(70, 20, '2024-06-21');
    expect(a.darkHours.hours).toBeNull();
    expect(a.twilight.astronomicalDusk).toBeNull();
  });
});
