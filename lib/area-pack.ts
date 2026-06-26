import {
  parksInBBox,
  campgroundsInBBox,
  visitorCentersInBBox,
  thingsToDoInBBox,
  alertParksInBBox,
  type BBox,
} from './queries';
import { fetchParkBoundary } from './parkboundary';
import { POI_ORDER, type PoiKey } from './mapLegend';

/**
 * Field/offline area pack (#10): gather everything in the current map viewport — parks, the enabled POI
 * layers, and per-park boundary GeoJSON — into one structured brief the offline ZIP route + the printable
 * field sheet render. `parksInBBox` has no LIMIT and NPS boundary fetches fan out, so we CAP both (a dense
 * national view shouldn't pull hundreds of parks or hammer NPS) and flag when we did, so the artifact is
 * honest about truncation rather than silently partial.
 */
const MAX_PARKS = 60;
const MAX_BOUNDARIES = 15;
const MAX_POIS = 400;

export interface AreaPark {
  parkCode: string;
  name: string;
  designation: string | null;
  lat: number | null;
  lng: number | null;
  darkSky?: boolean;
  accessible?: boolean;
  feeFree?: boolean;
}
export interface AreaPoi {
  layer: PoiKey;
  name: string;
  lat: number | null;
  lng: number | null;
  parkCode: string | null;
}
export interface AreaBrief {
  box: BBox;
  parks: AreaPark[];
  pois: AreaPoi[];
  boundaries: { parkCode: string; geojson: unknown }[];
  layers: PoiKey[];
  capped: { parks: boolean; boundaries: boolean };
}

export async function areaBrief(box: BBox, layers: PoiKey[]): Promise<AreaBrief> {
  const allParks = await parksInBBox(box);
  const parks: AreaPark[] = allParks.slice(0, MAX_PARKS).map((p) => ({
    parkCode: p.parkCode,
    name: p.name,
    designation: p.designation ?? null,
    lat: p.lat,
    lng: p.lng,
    darkSky: p.darkSky,
    accessible: p.accessible,
    feeFree: p.feeFree,
  }));

  const want = (k: PoiKey) => layers.includes(k);
  const [cgs, vcs, ttd, alerts] = await Promise.all([
    want('campgrounds') ? campgroundsInBBox(box) : Promise.resolve([]),
    want('visitorcenters') ? visitorCentersInBBox(box) : Promise.resolve([]),
    want('thingstodo') ? thingsToDoInBBox(box) : Promise.resolve([]),
    want('alerts') ? alertParksInBBox(box) : Promise.resolve([]),
  ]);
  const pois: AreaPoi[] = [
    ...cgs.map((p) => ({ layer: 'campgrounds' as const, name: p.name, lat: p.lat, lng: p.lng, parkCode: p.parkCode })),
    ...vcs.map((p) => ({ layer: 'visitorcenters' as const, name: p.name, lat: p.lat, lng: p.lng, parkCode: p.parkCode })),
    ...ttd.map((p) => ({ layer: 'thingstodo' as const, name: p.name, lat: p.lat, lng: p.lng, parkCode: p.parkCode })),
    ...alerts.map((a) => ({ layer: 'alerts' as const, name: a.name, lat: a.lat, lng: a.lng, parkCode: a.parkCode })),
  ].slice(0, MAX_POIS);

  const codes = parks.map((p) => p.parkCode).filter((c): c is string => !!c).slice(0, MAX_BOUNDARIES);
  const boundaries = await Promise.all(
    codes.map(async (parkCode) => ({ parkCode, geojson: await fetchParkBoundary(parkCode) })),
  );

  return {
    box,
    parks,
    pois,
    boundaries,
    layers,
    capped: { parks: allParks.length > MAX_PARKS, boundaries: parks.length > MAX_BOUNDARIES },
  };
}

type FeatureCollection = { type: 'FeatureCollection'; features: unknown[] };
const pointFeature = (lng: number, lat: number, props: Record<string, unknown>) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point' as const, coordinates: [lng, lat] },
  properties: props,
});

/** Parks as a GeoJSON FeatureCollection (for the offline pack — drops the unlocated few). */
export function areaParksGeoJSON(brief: AreaBrief): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: brief.parks
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => pointFeature(p.lng as number, p.lat as number, {
        parkCode: p.parkCode, name: p.name, designation: p.designation,
        darkSky: !!p.darkSky, accessible: !!p.accessible, feeFree: !!p.feeFree,
      })),
  };
}

/** Enabled POIs as a GeoJSON FeatureCollection (layer baked into each feature's properties). */
export function areaPoisGeoJSON(brief: AreaBrief): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: brief.pois
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => pointFeature(p.lng as number, p.lat as number, { layer: p.layer, name: p.name, parkCode: p.parkCode })),
  };
}

/** Parse the bbox query params shared by the offline + field routes. Returns null if missing/invalid. */
export function parseAreaBox(url: URL): BBox | null {
  const n = (k: string): number | null => {
    const raw = url.searchParams.get(k);
    if (raw == null || raw.trim() === '') return null; // a MISSING param must be null, not Number(null)===0
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  const minLat = n('minLat'), minLng = n('minLng'), maxLat = n('maxLat'), maxLng = n('maxLng');
  if (minLat == null || minLng == null || maxLat == null || maxLng == null) return null;
  if (minLat > maxLat || minLng > maxLng) return null;
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) return null;
  return { minLat, minLng, maxLat, maxLng };
}

/** Parse + allowlist the `layers` query param (comma-separated PoiKeys). */
export function parseAreaLayers(url: URL): PoiKey[] {
  const raw = url.searchParams.get('layers');
  if (!raw) return [];
  return [...new Set(raw.split(',').filter((k): k is PoiKey => (POI_ORDER as readonly string[]).includes(k)))];
}
