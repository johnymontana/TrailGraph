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

  it('falls back to great_circle on a non-OK ORS response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const segs = await routing.driveSegments([
      { latitude: 44.6, longitude: -110.5 },
      { latitude: 43.7, longitude: -110.7 },
    ]);
    expect(segs[0].source).toBe('great_circle');
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

describe('routing.geocode (ADR-074 — home-location entry)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps the first Pelias feature to {latitude, longitude, label}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          { geometry: { coordinates: [-111.0429, 45.6793] }, properties: { label: 'Bozeman, MT, USA' } },
          { geometry: { coordinates: [0, 0] }, properties: { label: 'Wrong one' } },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const hit = await routing.geocode('Bozeman, MT');
    expect(hit).toEqual({ latitude: 45.6793, longitude: -111.0429, label: 'Bozeman, MT, USA' });
    // US-biased, single result, GET with api_key as a query param (unlike the POST matrix header).
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toContain('/geocode/search');
    expect(url.searchParams.get('text')).toBe('Bozeman, MT');
    expect(url.searchParams.get('boundary.country')).toBe('US');
    expect(url.searchParams.get('size')).toBe('1');
    expect(url.searchParams.get('api_key')).toBeTruthy();
  });

  it('falls back to the query text when the feature has no label', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [{ geometry: { coordinates: [-100, 40] }, properties: {} }] }),
    }));
    const hit = await routing.geocode('Somewhere');
    expect(hit?.label).toBe('Somewhere');
  });

  it('returns null when nothing matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) }));
    expect(await routing.geocode('xyzzy-nowhere')).toBeNull();
  });

  it('returns null on a non-OK response and on a network error (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await routing.geocode('Bozeman')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await routing.geocode('Bozeman')).toBeNull();
  });
});

describe('routing.reverseGeocode (ADR-074 — geolocation labeling)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the first feature label for coordinates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [{ properties: { label: 'Bozeman, MT, USA' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await routing.reverseGeocode({ latitude: 45.68, longitude: -111.04 })).toBe('Bozeman, MT, USA');
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toContain('/geocode/reverse');
    expect(url.searchParams.get('point.lat')).toBe('45.68');
    expect(url.searchParams.get('point.lon')).toBe('-111.04');
  });

  it('returns null on no match / error (caller degrades to a generic label)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) }));
    expect(await routing.reverseGeocode({ latitude: 0, longitude: 0 })).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await routing.reverseGeocode({ latitude: 0, longitude: 0 })).toBeNull();
  });
});
