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

export function mapStyle(theme: 'light' | 'dark' = 'light'): string | StyleSpecification {
  const url = process.env.NEXT_PUBLIC_MAP_TILES_URL;
  if (!url) return 'https://demotiles.maplibre.org/style.json';
  if (url.endsWith('.json')) return url;
  if (url.endsWith('.pmtiles')) {
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
  if (!url || !url.endsWith('.pmtiles')) return;
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
