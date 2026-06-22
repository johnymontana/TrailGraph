import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { greatCircleMiles, approxDriveMinutes, routing } from './routing';

beforeAll(() => {
  process.env.ORS_API_KEY = 'test-ors-key';
});

describe('greatCircleMiles', () => {
  it('is 0 for identical points', () => {
    expect(greatCircleMiles({ latitude: 40, longitude: -100 }, { latitude: 40, longitude: -100 })).toBe(0);
  });

  it('matches a known distance (NYC→LA ≈ 2450mi) within tolerance', () => {
    const miles = greatCircleMiles(
      { latitude: 40.7128, longitude: -74.006 },
      { latitude: 34.0522, longitude: -118.2437 },
    );
    expect(miles).toBeGreaterThan(2400);
    expect(miles).toBeLessThan(2500);
  });
});

describe('approxDriveMinutes', () => {
  it('converts miles to minutes at the assumed speed', () => {
    expect(approxDriveMinutes(45, 45)).toBeCloseTo(60, 5);
  });
});

describe('routing.driveSegments', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns [] for fewer than 2 stops', async () => {
    expect(await routing.driveSegments([{ latitude: 1, longitude: 1 }])).toEqual([]);
  });

  it('falls back to great_circle when ORS is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const segs = await routing.driveSegments([
      { latitude: 44.6, longitude: -110.5 },
      { latitude: 43.7, longitude: -110.7 },
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].source).toBe('great_circle');
    expect(segs[0].miles).toBeGreaterThan(0);
    expect(segs[0].fromIndex).toBe(0);
    expect(segs[0].toIndex).toBe(1);
  });

  it('uses ORS matrix results when available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          distances: [
            [0, 120],
            [120, 0],
          ],
          durations: [
            [0, 7200],
            [7200, 0],
          ],
        }),
      }),
    );
    const segs = await routing.driveSegments([
      { latitude: 44.6, longitude: -110.5 },
      { latitude: 43.7, longitude: -110.7 },
    ]);
    expect(segs[0].source).toBe('ors');
    expect(segs[0].miles).toBe(120);
    expect(segs[0].minutes).toBe(120);
  });
});
