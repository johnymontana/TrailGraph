import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// maplibre-gl / pmtiles / protomaps-themes-base expect a browser; stub them for node.
vi.mock('maplibre-gl', () => ({ default: { addProtocol: vi.fn() } }));
vi.mock('pmtiles', () => ({ Protocol: class { tile = vi.fn(); } }));
vi.mock('protomaps-themes-base', () => ({
  layers: () => [{ id: 'water', type: 'fill' }],
  namedTheme: () => ({}),
}));

import { mapStyle, US_CENTER, US_BOUNDS } from './mapStyle';

describe('mapStyle', () => {
  const orig = process.env.NEXT_PUBLIC_MAP_TILES_URL;
  beforeEach(() => delete process.env.NEXT_PUBLIC_MAP_TILES_URL);
  afterEach(() => {
    if (orig === undefined) delete process.env.NEXT_PUBLIC_MAP_TILES_URL;
    else process.env.NEXT_PUBLIC_MAP_TILES_URL = orig;
  });

  it('falls back to the MapLibre demo style when no tiles URL is set', () => {
    expect(mapStyle()).toBe('https://demotiles.maplibre.org/style.json');
  });

  it('passes a style.json URL through unchanged', () => {
    process.env.NEXT_PUBLIC_MAP_TILES_URL = 'https://cdn.example/style.json';
    expect(mapStyle()).toBe('https://cdn.example/style.json');
  });

  it('builds a Protomaps vector style object for a .pmtiles URL', () => {
    process.env.NEXT_PUBLIC_MAP_TILES_URL = 'https://cdn.example/us.pmtiles';
    const style = mapStyle();
    expect(typeof style).toBe('object');
    const s = style as Exclude<ReturnType<typeof mapStyle>, string>;
    expect(s.version).toBe(8);
    expect(s.sources.protomaps).toMatchObject({ type: 'vector', url: 'pmtiles://https://cdn.example/us.pmtiles' });
    expect(Array.isArray(s.layers)).toBe(true);
  });
});

describe('US viewport constants', () => {
  it('centers on the continental US and bounds enclose it', () => {
    expect(US_CENTER).toEqual([-98.5, 39.8]);
    const [[w, s], [e, n]] = US_BOUNDS;
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
  });
});
