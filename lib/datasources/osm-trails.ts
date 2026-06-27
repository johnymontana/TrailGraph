import '../server-guard'; // network egress; keep out of the client bundle
import type { Feature, Position } from 'geojson';

/**
 * AD-3 adapter for OpenStreetMap hiking trails via the Overpass API (ADR-072, Phase-2 OSM-fill). Used ONLY
 * to FILL parks with no NPS GIS trails (never to merge), so there's no NPS↔OSM dedup. OSM ways are
 * transformed into the SAME NPS-shaped GeoJSON features `lib/sync/trail-aggregate.ts` already consumes, so
 * the named-aggregate + geodesic-length + simplify pipeline is reused as-is. **ODbL** — attribution required
 * (surfaced via `:Trail.source='osm'`). Degrades to `[]` on any error.
 */

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

export interface OsmBBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** A rough bbox around a park point (NPS-empty units are mostly small). Pure. */
export function bboxAround(lat: number, lng: number, deltaDeg = 0.25): OsmBBox {
  return { south: lat - deltaDeg, west: lng - deltaDeg, north: lat + deltaDeg, east: lng + deltaDeg };
}

/** Map OSM tags → an NPS-style `TRLUSE` string so `parseAllowedUses` reuses unchanged. Pure. */
export function osmUse(tags: Record<string, string>): string {
  const hw = tags.highway ?? '';
  const uses: string[] = [];
  if (/path|footway|track|steps/.test(hw) || tags.foot === 'yes') uses.push('Hiker/Pedestrian');
  if (tags.bicycle === 'yes' || hw === 'cycleway' || tags['mtb:scale'] != null) uses.push('Bicycle');
  if (tags.horse === 'yes' || hw === 'bridleway') uses.push('Pack and Saddle');
  if (tags.wheelchair === 'yes') uses.push('ADA Accessible');
  if (tags.ski === 'yes' || hw === 'piste') uses.push('Cross-Country Ski');
  return uses.join('; ') || 'Hiker/Pedestrian';
}

/** OSM `sac_scale` (T1–T6 / named) → easy/moderate/strenuous. Pure. Null when absent/unknown. */
export function sacToDifficulty(sac: string | null | undefined): 'easy' | 'moderate' | 'strenuous' | null {
  switch ((sac ?? '').trim()) {
    case 'hiking':
    case 'T1':
      return 'easy';
    case 'mountain_hiking':
    case 'T2':
    case 'demanding_mountain_hiking':
    case 'T3':
      return 'moderate';
    case 'alpine_hiking':
    case 'T4':
    case 'demanding_alpine_hiking':
    case 'T5':
    case 'difficult_alpine_hiking':
    case 'T6':
      return 'strenuous';
    default:
      return null;
  }
}

export interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/** Convert an OSM way (Overpass `out geom`) into an NPS-shaped Feature for `aggregateTrails`. Pure; null
 *  when it has no name or < 2 points. `_sacScale`/`_osmcSymbol` ride along for later difficulty enrichment. */
export function osmWayToFeature(el: OverpassElement, unitCode: string): Feature | null {
  const tags = el.tags ?? {};
  const name = (tags.name ?? '').trim();
  if (!name) return null;
  const coords: Position[] = (el.geometry ?? []).map((g) => [g.lon, g.lat]);
  if (coords.length < 2) return null;
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: {
      TRLNAME: name,
      UNITCODE: unitCode,
      TRLUSE: osmUse(tags),
      TRLSURFACE: tags.surface ?? null,
      TRLSTATUS: tags.access === 'no' || tags.access === 'private' ? 'Closed' : 'Existing',
      _sacScale: tags.sac_scale ?? null,
      _osmcSymbol: tags['osmc:symbol'] ?? null,
    },
  };
}

/** Fetch named OSM hiking ways in a bbox → NPS-shaped features. Degrades to `[]` on any error. */
export async function fetchParkTrailsOSM(box: OsmBBox, unitCode: string): Promise<Feature[]> {
  const filter = `["highway"~"^(path|footway|bridleway|track|steps)$"]["name"]`;
  const query =
    `[out:json][timeout:60];` +
    `way${filter}(${box.south},${box.west},${box.north},${box.east});` +
    `out geom;`;
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { elements?: OverpassElement[] };
    return (json.elements ?? [])
      .map((el) => osmWayToFeature(el, unitCode))
      .filter((f): f is Feature => f != null);
  } catch {
    return [];
  }
}
