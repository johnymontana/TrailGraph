import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { layers, labels, namedTheme } from 'protomaps-themes-base';

/**
 * MapLibre basemap (§2.10). When `NEXT_PUBLIC_MAP_TILES_URL` is set we use a real vector basemap:
 *  - a `.pmtiles` URL → self-hosted Protomaps (registered via the `pmtiles://` protocol) styled with
 *    `protomaps-themes-base` (topo/outdoor-ish "light" theme), no per-request key;
 *  - a `…style.json` URL → used directly (any MapLibre-compatible style).
 * With nothing set we fall back to MapLibre's demo tiles so local dev still renders.
 *
 * OPS: generate a US `.pmtiles` extract and host it, then set NEXT_PUBLIC_MAP_TILES_URL to its URL.
 */
let protocolRegistered = false;
export function registerMapProtocols() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

/**
 * Glyph (label-font) PBF URL. Self-hosted **same-origin** by default so the map's labels never depend on a
 * third-party path: the old hard-coded `https://protomaps.github.io/basemaps-assets/fonts/...` has been
 * observed to 404, which silently drops every symbol layer → a map with no labels. `scripts/build-glyphs.ts`
 * vendors the Noto Sans PBFs under `public/basemap/fonts/`, which Next serves same-origin (the request path
 * `…/Noto%20Sans%20Regular/0-255.pbf` decodes to the on-disk dir). Override with NEXT_PUBLIC_MAP_GLYPHS_URL
 * (e.g. a CDN) — read at module load like the other NEXT_PUBLIC_MAP_* vars (prod needs a redeploy to change).
 */
const DEFAULT_GLYPHS = '/basemap/fonts/{fontstack}/{range}.pbf';
export function glyphsUrl(): string {
  return process.env.NEXT_PUBLIC_MAP_GLYPHS_URL ?? DEFAULT_GLYPHS;
}

/**
 * Basemap families the switcher offers (S1). Satellite/terrain are deferred to a later phase; today both
 * options are protomaps themes: `topo` follows the app color mode (the original behavior), `dark` is always
 * the dark theme (an on-brand "night" map). New families (satellite raster + label-only, terrain) slot in
 * here + in `basemapStyle` without touching callers.
 */
export type Basemap = 'topo' | 'dark';
export const BASEMAPS: { key: Basemap; label: string }[] = [
  { key: 'topo', label: 'Topo' },
  { key: 'dark', label: 'Dark' },
];

/** Resolve the protomaps named theme for a (basemap, colorMode) pair. */
function themeFor(basemap: Basemap, colorMode: 'light' | 'dark'): 'light' | 'dark' {
  if (basemap === 'dark') return 'dark';
  return colorMode === 'dark' ? 'dark' : 'light';
}

/** A URL's path with any `?query`/`#hash` stripped, so extension checks survive CDN/signed params. */
function urlPathname(url: string): string {
  return url.split(/[?#]/)[0];
}
/** Detect a `.pmtiles` basemap even when the URL carries a query string (e.g. a signed Blob URL). */
function isPmtilesUrl(url: string): boolean {
  return urlPathname(url).endsWith('.pmtiles');
}

/**
 * A `.private.blob.vercel-storage.com` host or a signed (`?vercel-blob-delegation=…`) URL is served
 * through Vercel Blob's auth proxy: it answers Range requests with the full object (200, not 206) —
 * so the pmtiles reader downloads the *entire* file — and the signed token expires (~12h), 403ing
 * for users after a deploy. The fix is the public `*.public.blob.vercel-storage.com` URL. Warn so a
 * misconfigured NEXT_PUBLIC_MAP_TILES_URL is obvious in the console.
 */
function warnIfNonRangeBlobUrl(url: string): void {
  if (/\.private\.blob\.vercel-storage\.com/.test(url) || /[?&](vercel-blob-delegation|vercel-blob-signature)=/.test(url)) {
    console.warn(
      '[basemap] NEXT_PUBLIC_MAP_TILES_URL is a private/signed Vercel Blob URL — it does not support ' +
        'HTTP range requests (the whole .pmtiles downloads) and the signed token expires. Use the public ' +
        'URL instead: https://<store>.public.blob.vercel-storage.com/<path>.pmtiles (no query string).',
    );
  }
}

/**
 * Build the MapLibre style for a chosen basemap family + color mode. `topo` follows the app color mode;
 * `dark` is always the dark protomaps theme. Same URL handling as before: a `.json` passes through, a
 * `.pmtiles` becomes a protomaps vector style (self-hosted glyphs), and anything missing/odd falls back to
 * the MapLibre demo tiles so the map still renders.
 */
export function basemapStyle(basemap: Basemap = 'topo', colorMode: 'light' | 'dark' = 'light'): string | StyleSpecification {
  const url = process.env.NEXT_PUBLIC_MAP_TILES_URL;
  if (!url) return 'https://demotiles.maplibre.org/style.json';
  const path = urlPathname(url);
  if (path.endsWith('.json')) return url;
  if (path.endsWith('.pmtiles')) {
    warnIfNonRangeBlobUrl(url);
    try {
      // protomaps-themes-base ships light + dark themes; the basemap family + color mode pick which (R4 §2.5).
      const themeName = themeFor(basemap, colorMode);
      return {
        version: 8,
        glyphs: glyphsUrl(),
        sources: {
          protomaps: { type: 'vector', url: `pmtiles://${url}`, attribution: '© OpenStreetMap, © Protomaps' },
        },
        // In protomaps-themes-base v4, layers() is base geometry ONLY (background/fill/line) — labels() is a
        // SEPARATE export. Appending it is what makes city/state/road/place names render; without it the map
        // has zero text regardless of glyphs (the real root cause of the missing-labels bug). Labels use the
        // self-hosted Noto Sans glyphs (glyphsUrl).
        layers: [...layers('protomaps', namedTheme(themeName)), ...labels('protomaps', themeName, 'en')],
      } as StyleSpecification;
    } catch {
      return 'https://demotiles.maplibre.org/style.json';
    }
  }
  return url;
}

/** Back-compat shim for the original color-mode-driven topo style. Equivalent to `basemapStyle('topo', colorMode)`. */
export function mapStyle(colorMode: 'light' | 'dark' = 'light'): string | StyleSpecification {
  return basemapStyle('topo', colorMode);
}

const DEMO_STYLE = 'https://demotiles.maplibre.org/style.json';

/**
 * Graceful fallback for the self-hosted basemap (R3 §3.2): when `NEXT_PUBLIC_MAP_TILES_URL` is a
 * `.pmtiles` that hasn't been built/hosted yet, the protomaps source 404s and the map would render
 * blank. Listen once for that source error and swap to the demo style so the map still draws. Scoped
 * to the `.pmtiles` case so a working `style.json` is never swapped on a transient tile hiccup.
 */
export function attachBasemapFallback(map: maplibregl.Map): void {
  const url = process.env.NEXT_PUBLIC_MAP_TILES_URL;
  if (!url || !isPmtilesUrl(url)) return;
  let swapped = false;
  map.on('error', (e: { sourceId?: string; error?: { message?: string } }) => {
    if (swapped) return;
    const msg = String(e?.error?.message ?? '');
    if (e?.sourceId !== 'protomaps' && !/pmtiles|404|range|fetch/i.test(msg)) return;
    swapped = true;
    console.warn('[basemap] pmtiles unavailable — using demo tiles. Run `pnpm build:basemap` (R3 §3.2).');
    try {
      map.setStyle(DEMO_STYLE);
    } catch {
      /* ignore — map will keep the (empty) protomaps style */
    }
  });
}

/**
 * 3D terrain (Phase 5 / #11). Opt-in via `NEXT_PUBLIC_MAP_TERRAIN_URL` — a raster-DEM tile template
 * (`…/{z}/{x}/{y}.png`) or a TileJSON URL (e.g. AWS/Mapzen Terrarium elevation tiles, or a MapTiler/Mapbox
 * terrain-RGB source). Encoding defaults to `terrarium`; override with `NEXT_PUBLIC_MAP_TERRAIN_ENCODING`.
 * When the env is unset every hook is a graceful no-op so the fly-throughs (#11) still run as flat, pitched
 * 2D camera moves — the 3D "lights up" the moment a DEM is configured (read at module load; prod redeploy).
 */
const TERRAIN_SOURCE = 'terrain-dem';
export function terrainConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_MAP_TERRAIN_URL;
}

/** Add the raster-DEM source (once) + enable 3D terrain + an atmospheric sky. Returns true if terrain is live. */
export function enableTerrain(map: maplibregl.Map, exaggeration = 1.4): boolean {
  const url = process.env.NEXT_PUBLIC_MAP_TERRAIN_URL;
  if (!url) return false;
  try {
    if (!map.getSource(TERRAIN_SOURCE)) {
      const encoding = (process.env.NEXT_PUBLIC_MAP_TERRAIN_ENCODING as 'terrarium' | 'mapbox' | 'custom') ?? 'terrarium';
      const attribution = process.env.NEXT_PUBLIC_MAP_TERRAIN_ATTRIBUTION ?? 'Elevation';
      const isTemplate = /\{z\}/.test(url);
      map.addSource(TERRAIN_SOURCE, isTemplate
        ? { type: 'raster-dem', tiles: [url], tileSize: 256, maxzoom: 14, encoding, attribution }
        : { type: 'raster-dem', url, encoding, attribution });
    }
    map.setTerrain({ source: TERRAIN_SOURCE, exaggeration });
    applySky(map);
    return true;
  } catch (err) {
    console.warn('[terrain] could not enable 3D terrain:', (err as Error).message);
    return false;
  }
}

/** Turn off 3D terrain (back to flat). Safe to call when terrain was never enabled. */
export function disableTerrain(map: maplibregl.Map): void {
  try {
    map.setTerrain(null);
  } catch {
    /* terrain was never set — no-op */
  }
}

/** A light atmospheric sky so a pitched 3D camera has a believable horizon (MapLibre v5 `setSky`). */
export function applySky(map: maplibregl.Map): void {
  const m = map as unknown as { setSky?: (s: Record<string, unknown>) => void };
  try {
    m.setSky?.({
      'sky-color': '#9ec1e0',
      'horizon-color': '#eaeff3',
      'fog-color': '#ffffff',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.5,
      'fog-ground-blend': 0.4,
    });
  } catch {
    /* setSky unsupported on this build — skip the atmosphere */
  }
}

export const US_CENTER: [number, number] = [-98.5, 39.8];
/** Continental-US bounds for a sensible default fit (§2.11). */
export const US_BOUNDS: [[number, number], [number, number]] = [
  [-125, 24],
  [-66.9, 49.5],
];
