import { POI_ORDER, type PoiKey } from './mapLegend';
import { MAP_LENSES, type LensKey } from './mapLenses';

/**
 * "Share this view" deep-link codec (#10): round-trip the map's camera + active instrument settings through
 * a compact, validated query string so a link reopens the exact view. Pure + unit-tested. Kept free of the
 * maplibre/protomaps deps (no `lib/mapStyle` import) so it stays cheap to test and import on the server too;
 * the basemap allowlist below mirrors `lib/mapStyle`'s `Basemap` union (deferred 'satellite' isn't shareable yet).
 */
export const MAP_BASEMAPS = ['topo', 'dark'] as const;
export type MapBasemap = (typeof MAP_BASEMAPS)[number];

/** The POI layers a link can toggle (same set + order the panel checkboxes use). */
export const MAP_LAYER_KEYS: readonly PoiKey[] = POI_ORDER;
const LENS_KEYS: readonly string[] = MAP_LENSES.map((l) => l.key);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface MapView {
  lat?: number;
  lng?: number;
  zoom?: number;
  basemap?: MapBasemap;
  layers?: PoiKey[];
  lens?: LensKey;
  conditions?: string | null; // ISO yyyy-mm-dd, or null/absent for off
  mode?: 'all' | 'mine';
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Encode a view into a query string (no leading '?'). Defaults/empties are omitted to keep links short. */
export function encodeMapView(v: MapView): string {
  const p = new URLSearchParams();
  if (Number.isFinite(v.lat) && Number.isFinite(v.lng)) {
    p.set('lat', String(round(v.lat as number, 4)));
    p.set('lng', String(round(v.lng as number, 4)));
  }
  if (Number.isFinite(v.zoom)) p.set('z', String(round(v.zoom as number, 2)));
  if (v.basemap && v.basemap !== 'topo') p.set('base', v.basemap);
  if (v.layers && v.layers.length) p.set('layers', [...new Set(v.layers)].join(','));
  if (v.lens && v.lens !== 'none') p.set('lens', v.lens);
  if (v.conditions && ISO_DATE.test(v.conditions)) p.set('cond', v.conditions);
  if (v.mode && v.mode !== 'all') p.set('mode', v.mode);
  return p.toString();
}

/**
 * Decode + validate a deep-link into a partial MapView. Accepts a `URLSearchParams` OR the plain object the
 * Next 16 RSC gets from awaited `searchParams`. Unknown/out-of-range fields are dropped — never throws (so a
 * hand-edited or stale link degrades to "ignore the bad bits" rather than 500ing the map page).
 */
export function decodeMapView(params: URLSearchParams | Record<string, string | string[] | undefined>): MapView {
  const get = (k: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(k) ?? undefined;
    const raw = params[k];
    return Array.isArray(raw) ? raw[0] : raw;
  };
  const out: MapView = {};
  const lat = Number(get('lat'));
  const lng = Number(get('lng'));
  if (Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180) {
    out.lat = lat;
    out.lng = lng;
  }
  const z = Number(get('z'));
  if (Number.isFinite(z) && z >= 0 && z <= 22) out.zoom = z;
  const base = get('base');
  if (base && (MAP_BASEMAPS as readonly string[]).includes(base)) out.basemap = base as MapBasemap;
  const layers = get('layers');
  if (layers) {
    const valid = layers.split(',').filter((k): k is PoiKey => (POI_ORDER as readonly string[]).includes(k));
    if (valid.length) out.layers = [...new Set(valid)];
  }
  const lens = get('lens');
  if (lens && LENS_KEYS.includes(lens)) out.lens = lens as LensKey;
  const cond = get('cond');
  if (cond && ISO_DATE.test(cond)) out.conditions = cond;
  const mode = get('mode');
  if (mode === 'mine' || mode === 'all') out.mode = mode;
  return out;
}

/** Does the decoded view carry a camera target? (lets the page choose jumpTo vs the memory-default fitBounds.) */
export function hasCamera(v: MapView): boolean {
  return v.lat != null && v.lng != null;
}
