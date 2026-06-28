import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the I/O boundary so we can drive deriveTrailElevation deterministically; the pure profile/grade
// cores (../datasources/elevation, ./trail-difficulty) stay real.
const m = vi.hoisted(() => ({
  readGraph: vi.fn(),
  writeGraph: vi.fn(async () => []),
  readParkTrails: vi.fn(),
  putParkTrails: vi.fn(async () => 'https://blob.example/trails/x.geojson'),
}));

vi.mock('../neo4j', () => ({ readGraph: m.readGraph, writeGraph: m.writeGraph }));
vi.mock('../blob-trails', () => ({ readParkTrails: m.readParkTrails, putParkTrails: m.putParkTrails }));
vi.mock('../env', () => ({ env: { trails: { elevationApiUrl: 'https://api.test/v1/ned10m' } } }));

import {
  deriveTrailElevation,
  createApiSampler,
  parseThrottleMs,
  ElevationRateLimitError,
} from './derive-trail-elevation';

const ok = (results: { elevation: number | null }[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ results }),
});
const fill = (n: number, elevation: number) => Array.from({ length: n }, () => ({ elevation }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SYNC_FORCE;
  delete process.env.TRAIL_ELEV_MAX_SAMPLES;
  delete process.env.TRAIL_ELEV_SPACING_M;
  process.env.TRAIL_ELEV_THROTTLE_MS = '0'; // no real delays in tests
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TRAIL_ELEV_THROTTLE_MS;
});

describe('parseThrottleMs', () => {
  it('defaults to 1100 for empty/garbage/negative, honors an explicit 0', () => {
    expect(parseThrottleMs(undefined)).toBe(1100);
    expect(parseThrottleMs('')).toBe(1100);
    expect(parseThrottleMs('abc')).toBe(1100);
    expect(parseThrottleMs('-5')).toBe(1100);
    expect(parseThrottleMs('0')).toBe(0); // self-hosted → full speed
    expect(parseThrottleMs('250')).toBe(250);
  });
});

describe('createApiSampler', () => {
  it('parses results[].elevation for a 200 (opentopodata shape)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([{ elevation: 10 }, { elevation: 20 }])));
    const out = await createApiSampler('https://api.test/v1/ned10m', 0)([
      { lng: -110, lat: 44 },
      { lng: -110.1, lat: 44.1 },
    ]);
    expect(out).toEqual([10, 20]);
  });

  it('nulls a point with no matching result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([{ elevation: 10 }])));
    const out = await createApiSampler('https://api.test/v1/ned10m', 0)([
      { lng: -110, lat: 44 },
      { lng: -110.1, lat: 44.1 },
    ]);
    expect(out).toEqual([10, null]);
  });

  it('THROWS ElevationRateLimitError on HTTP 429 (so the caller can stop + resume)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));
    await expect(
      createApiSampler('https://api.test/v1/ned10m', 0)([{ lng: -110, lat: 44 }]),
    ).rejects.toBeInstanceOf(ElevationRateLimitError);
  });

  it('degrades a non-429 error (e.g. 500) to nulls — no throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const out = await createApiSampler('https://api.test/v1/ned10m', 0)([{ lng: -110, lat: 44 }]);
    expect(out).toEqual([null]);
  });

  it('degrades a network error to nulls — no throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const out = await createApiSampler('https://api.test/v1/ned10m', 0)([{ lng: -110, lat: 44 }]);
    expect(out).toEqual([null]);
  });

  it('batches at 100 points/call', async () => {
    const fetchMock = vi.fn(async () => ok(fill(100, 5)));
    vi.stubGlobal('fetch', fetchMock);
    const pts = Array.from({ length: 150 }, (_, i) => ({ lng: -110 + i * 0.001, lat: 44 }));
    const out = await createApiSampler('https://api.test/v1/ned10m', 0)(pts);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 100 + 50
    expect(out).toHaveLength(150);
  });
});

describe('deriveTrailElevation early-stop on 429', () => {
  const fcFor = (pc: string) => ({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [0, 0.01]]] }, // ~1.1km → ~37 pts, 1 batch
        properties: { id: `nps:${pc}:t1`, lengthMiles: 0.7 },
      },
    ],
  });

  it('stops the crawl, persists graded parks, leaves the 429 trail ungraded for next run', async () => {
    m.readGraph.mockResolvedValue([
      { parkCode: 'a', url: 'https://blob/a' },
      { parkCode: 'b', url: 'https://blob/b' },
    ]);
    m.readParkTrails.mockImplementation(async (pc: string) => fcFor(pc));

    // Park 'a' first batch → 200; park 'b' first batch → 429 (quota hit).
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n += 1;
        return n === 1
          ? ok(fill(200, 1000))
          : { ok: false, status: 429, json: async () => ({}) };
      }),
    );

    const r = await deriveTrailElevation();

    expect(r.rateLimited).toBe(1);
    expect(r.graded).toBe(1); // only park 'a' graded; 'b' hit the 429 before grading
    // Park 'a' was persisted to Blob; park 'b' (no completed feature) was not.
    expect(m.putParkTrails).toHaveBeenCalledTimes(1);
    expect((m.putParkTrails.mock.calls[0] as unknown as [string])[0]).toBe('a');
    // It stopped — it did not keep crawling past the 429 (exactly 2 fetches: a's batch, then b's 429).
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it('no sampler (no ELEVATION_API_URL) is a clean no-op', async () => {
    vi.resetModules();
    vi.doMock('../env', () => ({ env: { trails: { elevationApiUrl: undefined } } }));
    const { deriveTrailElevation: derive } = await import('./derive-trail-elevation');
    const r = await derive();
    expect(r).toEqual({ skipped: 1 });
    vi.doUnmock('../env');
  });
});
