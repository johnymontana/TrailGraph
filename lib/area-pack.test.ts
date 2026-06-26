import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the I/O deps so areaBrief is exercised as pure orchestration (caps, layer-gating, capped flags).
vi.mock('./queries', () => ({
  parksInBBox: vi.fn(),
  campgroundsInBBox: vi.fn(),
  visitorCentersInBBox: vi.fn(),
  thingsToDoInBBox: vi.fn(),
  alertParksInBBox: vi.fn(),
}));
vi.mock('./parkboundary', () => ({ fetchParkBoundary: vi.fn() }));

import { areaBrief, areaParksGeoJSON, areaPoisGeoJSON, parseAreaBox, parseAreaLayers, type AreaBrief } from './area-pack';
import * as queries from './queries';
import { fetchParkBoundary } from './parkboundary';

const q = queries as unknown as Record<string, ReturnType<typeof vi.fn>>;
const park = (parkCode: string, lat: number | null, lng: number | null, extra: Record<string, unknown> = {}) => ({ parkCode, name: parkCode.toUpperCase(), designation: 'National Park', states: 'WY', image: null, darkSky: false, accessible: false, feeFree: false, lat, lng, ...extra });
const box = { minLat: 40, minLng: -116, maxLat: 50, maxLng: -108 };

const briefBase = (over: Partial<AreaBrief> = {}): AreaBrief => ({
  box, parks: [], pois: [], boundaries: [], layers: [], capped: { parks: false, boundaries: false }, ...over,
});

describe('parseAreaBox', () => {
  const url = (qs: string) => new URL(`https://x/api/map/offline?${qs}`);
  it('parses a valid bbox', () => {
    expect(parseAreaBox(url('minLat=40&minLng=-116&maxLat=50&maxLng=-108'))).toEqual(box);
  });
  it('returns null when a param is missing or non-numeric', () => {
    expect(parseAreaBox(url('minLat=40&minLng=-116&maxLat=50'))).toBeNull();
    expect(parseAreaBox(url('minLat=x&minLng=-116&maxLat=50&maxLng=-108'))).toBeNull();
  });
  it('rejects an inverted box (min > max)', () => {
    expect(parseAreaBox(url('minLat=50&minLng=-116&maxLat=40&maxLng=-108'))).toBeNull();
  });
  it('rejects out-of-range coordinates', () => {
    expect(parseAreaBox(url('minLat=-100&minLng=-116&maxLat=50&maxLng=-108'))).toBeNull();
    expect(parseAreaBox(url('minLat=40&minLng=-200&maxLat=50&maxLng=-108'))).toBeNull();
  });
});

describe('parseAreaLayers', () => {
  const url = (qs: string) => new URL(`https://x/api/map/offline?${qs}`);
  it('keeps only allowlisted POI keys + dedupes', () => {
    expect(parseAreaLayers(url('layers=campgrounds,alerts,campgrounds,bogus'))).toEqual(['campgrounds', 'alerts']);
  });
  it('returns [] when absent or all invalid', () => {
    expect(parseAreaLayers(url(''))).toEqual([]);
    expect(parseAreaLayers(url('layers=nope,,'))).toEqual([]);
  });
});

describe('areaParksGeoJSON / areaPoisGeoJSON', () => {
  it('builds a parks FeatureCollection, dropping unlocated parks + baking facets', () => {
    const fc = areaParksGeoJSON(briefBase({ parks: [
      { parkCode: 'yell', name: 'Yellowstone', designation: 'National Park', lat: 44.6, lng: -110.5, darkSky: true, accessible: false, feeFree: true },
      { parkCode: 'nope', name: 'No coords', designation: null, lat: null, lng: null },
    ] }));
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0] as { geometry: { coordinates: number[] }; properties: Record<string, unknown> };
    expect(f.geometry.coordinates).toEqual([-110.5, 44.6]); // [lng, lat]
    expect(f.properties).toMatchObject({ parkCode: 'yell', darkSky: true, feeFree: true });
  });
  it('builds a POIs FeatureCollection with the layer baked in', () => {
    const fc = areaPoisGeoJSON(briefBase({ pois: [
      { layer: 'campgrounds', name: 'Canyon', lat: 44.7, lng: -110.5, parkCode: 'yell' },
      { layer: 'alerts', name: 'Bad', lat: null, lng: null, parkCode: 'yell' },
    ] }));
    expect(fc.features).toHaveLength(1);
    expect((fc.features[0] as { properties: { layer: string } }).properties.layer).toBe('campgrounds');
  });
});

describe('areaBrief', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    q.parksInBBox.mockResolvedValue([park('yell', 44.6, -110.5), park('glac', 48.7, -113.8)]);
    q.campgroundsInBBox.mockResolvedValue([{ id: 'cg1', name: 'Canyon', lat: 44.7, lng: -110.5, parkCode: 'yell' }]);
    q.visitorCentersInBBox.mockResolvedValue([{ id: 'vc1', name: 'VC', lat: 44.7, lng: -110.5, parkCode: 'yell' }]);
    q.thingsToDoInBBox.mockResolvedValue([{ id: 't1', name: 'Hike', lat: 44.7, lng: -110.5, parkCode: 'yell' }]);
    q.alertParksInBBox.mockResolvedValue([{ parkCode: 'yell', name: 'Yellowstone', lat: 44.6, lng: -110.5, alerts: [] }]);
    (fetchParkBoundary as ReturnType<typeof vi.fn>).mockImplementation(async (code: string) => ({ type: 'FeatureCollection', features: [], _code: code }));
  });

  it('only fetches the requested POI layers (layer gating)', async () => {
    await areaBrief(box, ['campgrounds']);
    expect(q.campgroundsInBBox).toHaveBeenCalledOnce();
    expect(q.visitorCentersInBBox).not.toHaveBeenCalled();
    expect(q.thingsToDoInBBox).not.toHaveBeenCalled();
    expect(q.alertParksInBBox).not.toHaveBeenCalled();
  });

  it('aggregates parks + the enabled POIs and fetches a boundary per located park', async () => {
    const brief = await areaBrief(box, ['campgrounds', 'visitorcenters']);
    expect(brief.parks.map((p) => p.parkCode)).toEqual(['yell', 'glac']);
    expect(brief.pois.map((p) => p.layer).sort()).toEqual(['campgrounds', 'visitorcenters']);
    expect(brief.boundaries.map((b) => b.parkCode).sort()).toEqual(['glac', 'yell']);
    expect(brief.layers).toEqual(['campgrounds', 'visitorcenters']);
    expect(brief.capped).toEqual({ parks: false, boundaries: false });
  });

  it('caps parks at 60 + boundaries at 15 and flags the truncation', async () => {
    q.parksInBBox.mockResolvedValue(Array.from({ length: 80 }, (_, i) => park(`p${i}`, 40 + i * 0.01, -110)));
    const brief = await areaBrief(box, []);
    expect(brief.parks).toHaveLength(60);
    expect(brief.boundaries).toHaveLength(15); // boundary fan-out capped well below the park cap
    expect(brief.capped).toEqual({ parks: true, boundaries: true });
  });

  it('caps the POI list at 400', async () => {
    q.campgroundsInBBox.mockResolvedValue(Array.from({ length: 600 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, lat: 44, lng: -110, parkCode: 'yell' })));
    const brief = await areaBrief(box, ['campgrounds']);
    expect(brief.pois).toHaveLength(400);
  });
});
