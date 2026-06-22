import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { layers, namedTheme } from 'protomaps-themes-base';

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

const GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';

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

export function mapStyle(theme: 'light' | 'dark' = 'light'): string | StyleSpecification {
  const url = process.env.NEXT_PUBLIC_MAP_TILES_URL;
  if (!url) return 'https://demotiles.maplibre.org/style.json';
  const path = urlPathname(url);
  if (path.endsWith('.json')) return url;
  if (path.endsWith('.pmtiles')) {
    warnIfNonRangeBlobUrl(url);
    try {
      return {
        version: 8,
        glyphs: GLYPHS,
        sources: {
          protomaps: { type: 'vector', url: `pmtiles://${url}`, attribution: '© OpenStreetMap, © Protomaps' },
        },
        // Match the app's color mode (R4 §2.5) — protomaps-themes-base ships light + dark themes.
        layers: layers('protomaps', namedTheme(theme === 'dark' ? 'dark' : 'light')),
      } as StyleSpecification;
    } catch {
      return 'https://demotiles.maplibre.org/style.json';
    }
  }
  return url;
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

export const US_CENTER: [number, number] = [-98.5, 39.8];
/** Continental-US bounds for a sensible default fit (§2.11). */
export const US_BOUNDS: [[number, number], [number, number]] = [
  [-125, 24],
  [-66.9, 49.5],
];
