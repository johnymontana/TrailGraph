import { describe, it, expect } from 'vitest';
import { encodeMapView, decodeMapView, hasCamera, type MapView } from './map-deeplink';

describe('map-deeplink', () => {
  it('round-trips a full view', () => {
    const v: MapView = { lat: 44.6, lng: -110.5, zoom: 7.5, basemap: 'dark', layers: ['campgrounds', 'alerts'], lens: 'crowd', conditions: '2026-06-26', mode: 'mine' };
    const decoded = decodeMapView(new URLSearchParams(encodeMapView(v)));
    expect(decoded).toEqual(v);
  });

  it('omits defaults/empties to keep links short', () => {
    const qs = encodeMapView({ lat: 40, lng: -100, zoom: 4, basemap: 'topo', layers: [], lens: 'none', conditions: null, mode: 'all' });
    expect(qs).toBe('lat=40&lng=-100&z=4');
  });

  it('rounds coordinates + zoom to keep the URL compact', () => {
    expect(encodeMapView({ lat: 44.123456, lng: -110.987654, zoom: 7.12345 })).toBe('lat=44.1235&lng=-110.9877&z=7.12');
  });

  it('drops out-of-range lat/lng/zoom', () => {
    expect(decodeMapView({ lat: '120', lng: '-200', z: '40' })).toEqual({});
  });

  it('rejects unknown basemap / lens / layers / mode (allowlist)', () => {
    const d = decodeMapView({ base: 'satellite', lens: 'rainfall', layers: 'campgrounds,bogus', mode: 'sideways' });
    expect(d).toEqual({ layers: ['campgrounds'] }); // only the valid layer survives; bad enums dropped
  });

  it('keeps a valid ISO conditions date but drops a malformed one', () => {
    expect(decodeMapView({ cond: '2026-06-26' })).toEqual({ conditions: '2026-06-26' });
    expect(decodeMapView({ cond: 'tonight' })).toEqual({});
  });

  it('accepts a plain searchParams object (Next 16 RSC) and a URLSearchParams', () => {
    expect(decodeMapView({ lat: '44.6', lng: '-110.5' })).toEqual({ lat: 44.6, lng: -110.5 });
    expect(decodeMapView(new URLSearchParams('lat=44.6&lng=-110.5'))).toEqual({ lat: 44.6, lng: -110.5 });
  });

  it('hasCamera reflects a center target', () => {
    expect(hasCamera({ lat: 1, lng: 2 })).toBe(true);
    expect(hasCamera({ lens: 'crowd' })).toBe(false);
  });

  it('never throws on garbage input', () => {
    expect(() => decodeMapView({ lat: 'NaN', layers: ',,,', cond: '', z: 'abc' })).not.toThrow();
    expect(decodeMapView({ lat: 'NaN', layers: ',,,', cond: '', z: 'abc' })).toEqual({});
  });
});
