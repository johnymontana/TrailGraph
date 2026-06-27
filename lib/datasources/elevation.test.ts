import { describe, it, expect } from 'vitest';
import {
  decodeElevationM,
  metersToFeet,
  resamplePolyline,
  computeProfile,
} from './elevation';

describe('decodeElevationM (DEM pixel → meters, ADR-068)', () => {
  it('decodes terrarium encoding', () => {
    expect(decodeElevationM(128, 0, 0, 'terrarium')).toBe(0); // 128*256 - 32768
    expect(decodeElevationM(129, 0, 0, 'terrarium')).toBe(256); // 129*256 - 32768
  });
  it('decodes mapbox terrain-rgb encoding', () => {
    expect(decodeElevationM(0, 0, 0, 'mapbox')).toBe(-10000);
    expect(decodeElevationM(0, 0, 1, 'mapbox')).toBeCloseTo(-9999.9, 5);
  });
});

describe('metersToFeet', () => {
  it('converts', () => {
    expect(metersToFeet(1000)).toBeCloseTo(3280.84, 1);
  });
});

describe('resamplePolyline', () => {
  it('starts at distance 0, increases monotonically, includes the last vertex', () => {
    const pts = resamplePolyline([[0, 0], [0, 0.01]], 100); // ~1.11 km N–S
    expect(pts[0].distMi).toBe(0);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].distMi).toBeGreaterThan(pts[i - 1].distMi);
    }
    expect(pts.length).toBeGreaterThan(5);
    // last sample sits at the final vertex
    expect(pts[pts.length - 1].lat).toBeCloseTo(0.01, 6);
  });
  it('handles degenerate input', () => {
    expect(resamplePolyline([])).toEqual([]);
    expect(resamplePolyline([[1, 2]])).toEqual([{ lng: 1, lat: 2, distMi: 0 }]);
  });
});

describe('computeProfile (gain/loss with noise hysteresis)', () => {
  it('accumulates gain and loss above the noise threshold', () => {
    const p = computeProfile(
      [
        { distMi: 0, elevFt: 0 },
        { distMi: 1, elevFt: 10 },
        { distMi: 2, elevFt: 20 },
        { distMi: 3, elevFt: 15 },
        { distMi: 4, elevFt: 30 },
      ],
      { noiseThresholdFt: 5 },
    );
    expect(p.gainFt).toBe(35); // +10 +10 (+ +15) = 35
    expect(p.lossFt).toBe(5); // -5
    expect(p.minFt).toBe(0);
    expect(p.maxFt).toBe(30);
  });
  it('suppresses sub-threshold jitter', () => {
    const p = computeProfile(
      [
        { distMi: 0, elevFt: 0 },
        { distMi: 1, elevFt: 2 },
        { distMi: 2, elevFt: 0 },
        { distMi: 3, elevFt: 2 },
      ],
      { noiseThresholdFt: 5 },
    );
    expect(p.gainFt).toBe(0);
    expect(p.lossFt).toBe(0);
  });
  it('downsamples a long profile to the target length', () => {
    const samples = Array.from({ length: 500 }, (_, i) => ({ distMi: i / 100, elevFt: i }));
    const p = computeProfile(samples, { downsampleTo: 64 });
    expect(p.profile).toHaveLength(64);
    expect(p.profile[0].distMi).toBe(0);
  });
  it('returns zeros for empty input', () => {
    expect(computeProfile([])).toEqual({ gainFt: 0, lossFt: 0, minFt: 0, maxFt: 0, profile: [] });
  });
});
