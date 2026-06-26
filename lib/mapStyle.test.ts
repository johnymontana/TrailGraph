import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// maplibre-gl / pmtiles / protomaps-themes-base expect a browser; stub them for node.
vi.mock('maplibre-gl', () => ({ default: { addProtocol: vi.fn() } }));
vi.mock('pmtiles', () => ({ Protocol: class { tile = vi.fn(); } }));
const namedTheme = vi.fn((_name: string) => ({}));
const labels = vi.fn((_source: string, _key: string, _lang: string) => [{ id: 'city_label', type: 'symbol' }]);
vi.mock('protomaps-themes-base', () => ({
  layers: () => [{ id: 'water', type: 'fill' }],
  labels: (source: string, key: string, lang: string) => labels(source, key, lang),
  namedTheme: (name: string) => namedTheme(name),
}));

import { mapStyle, basemapStyle, glyphsUrl, BASEMAPS, US_CENTER, US_BOUNDS } from './mapStyle';

type StyleObj = Exclude<ReturnType<typeof mapStyle>, string>;

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

  it('appends label layers so the map actually renders text (the missing-labels root cause)', () => {
    // protomaps-themes-base v4 split labels() out of layers(); without appending it the map has zero text.
    process.env.NEXT_PUBLIC_MAP_TILES_URL = 'https://cdn.example/us.pmtiles';
    labels.mockClear();
    const s = mapStyle('light') as StyleObj;
    expect(labels).toHaveBeenCalledWith('protomaps', 'light', 'en');
    expect(s.layers.some((l) => l.type === 'symbol')).toBe(true);
  });

  it('treats a .pmtiles URL with a query string as pmtiles (range requests), not a style URL', () => {
    // A signed/CDN URL ends in `…?token=…`, so the old `endsWith('.pmtiles')` check missed it and the
    // raw URL was returned as a style URL → MapLibre plain-fetched the whole binary (the bug).
    const signed = 'https://store.public.blob.vercel-storage.com/us.pmtiles?token=abc';
    process.env.NEXT_PUBLIC_MAP_TILES_URL = signed;
    const style = mapStyle();
    expect(typeof style).toBe('object');
    const s = style as Exclude<ReturnType<typeof mapStyle>, string>;
    expect(s.sources.protomaps).toMatchObject({ type: 'vector', url: `pmtiles://${signed}` });
  });

  it('warns for a private/signed Vercel Blob URL (no range support, expiring token)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_MAP_TILES_URL =
      'https://abc.private.blob.vercel-storage.com/us.pmtiles?vercel-blob-delegation=xyz';
    mapStyle();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('private/signed'));
    warn.mockRestore();
  });

  it('does not warn for a public, token-free .pmtiles URL', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_MAP_TILES_URL = 'https://abc.public.blob.vercel-storage.com/us.pmtiles';
    mapStyle();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('selects the protomaps theme matching the color mode (R4 §2.5)', () => {
    process.env.NEXT_PUBLIC_MAP_TILES_URL = 'https://cdn.example/us.pmtiles';
    namedTheme.mockClear();
    mapStyle('dark');
    expect(namedTheme).toHaveBeenCalledWith('dark');
    namedTheme.mockClear();
    mapStyle('light');
    expect(namedTheme).toHaveBeenCalledWith('light');
    namedTheme.mockClear();
    mapStyle(); // default
    expect(namedTheme).toHaveBeenCalledWith('light');
  });

  it('serves glyphs same-origin by default and honors NEXT_PUBLIC_MAP_GLYPHS_URL', () => {
    const orig = process.env.NEXT_PUBLIC_MAP_GLYPHS_URL;
    delete process.env.NEXT_PUBLIC_MAP_GLYPHS_URL;
    expect(glyphsUrl()).toBe('/basemap/fonts/{fontstack}/{range}.pbf');
    process.env.NEXT_PUBLIC_MAP_TILES_URL = 'https://cdn.example/us.pmtiles';
    expect((mapStyle() as StyleObj).glyphs).toBe('/basemap/fonts/{fontstack}/{range}.pbf');
    // No longer the dead third-party path that 404'd.
    expect((mapStyle() as StyleObj).glyphs).not.toContain('protomaps.github.io');

    process.env.NEXT_PUBLIC_MAP_GLYPHS_URL = 'https://cdn.example/fonts/{fontstack}/{range}.pbf';
    expect(glyphsUrl()).toBe('https://cdn.example/fonts/{fontstack}/{range}.pbf');
    expect((mapStyle() as StyleObj).glyphs).toBe('https://cdn.example/fonts/{fontstack}/{range}.pbf');
    if (orig === undefined) delete process.env.NEXT_PUBLIC_MAP_GLYPHS_URL;
    else process.env.NEXT_PUBLIC_MAP_GLYPHS_URL = orig;
  });
});

describe('basemapStyle', () => {
  const orig = process.env.NEXT_PUBLIC_MAP_TILES_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MAP_TILES_URL = 'https://cdn.example/us.pmtiles';
    namedTheme.mockClear();
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.NEXT_PUBLIC_MAP_TILES_URL;
    else process.env.NEXT_PUBLIC_MAP_TILES_URL = orig;
  });

  it("'topo' follows the color mode", () => {
    basemapStyle('topo', 'dark');
    expect(namedTheme).toHaveBeenCalledWith('dark');
    namedTheme.mockClear();
    basemapStyle('topo', 'light');
    expect(namedTheme).toHaveBeenCalledWith('light');
  });

  it("'dark' is always the dark theme regardless of color mode", () => {
    basemapStyle('dark', 'light');
    expect(namedTheme).toHaveBeenCalledWith('dark');
  });

  it('exposes a non-empty basemap registry for the switcher', () => {
    expect(BASEMAPS.map((b) => b.key)).toContain('topo');
    expect(BASEMAPS.length).toBeGreaterThanOrEqual(2);
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
