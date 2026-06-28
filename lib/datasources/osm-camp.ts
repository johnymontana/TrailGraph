import '../server-guard'; // network egress; keep out of the client bundle

/**
 * AD-3 adapter for OpenStreetMap campgrounds via the Overpass API (Campgrounds feature, Phase 4 reach).
 * Extends coverage where the federal APIs stop — **state, private, and dispersed/wild** sites — via
 * `tourism=camp_site|caravan_site` (areas) + `tourism=camp_pitch` (individual pitches). **ODbL** —
 * attribution required, surfaced via `:Campground.source='osm'`. OSM-origin campgrounds are upserted as
 * SEPARATE `osm:<id>` nodes (never auto-merged); the gated `resolve-campgrounds` step dedups them against
 * the federal canon. Degrades to `[]` on any error. Pure mappers are unit-tested.
 */

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

export interface OsmBBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function bboxAround(lat: number, lng: number, deltaDeg = 0.4): OsmBBox {
  return { south: lat - deltaDeg, west: lng - deltaDeg, north: lat + deltaDeg, east: lng + deltaDeg };
}

export interface OsmCampElement {
  type: string; // node | way | relation
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number }; // ways/relations with `out center`
  tags?: Record<string, string>;
}

export interface OsmCampRecord {
  osmId: string; // "osm:node/123"
  name: string;
  lat: number;
  lng: number;
  dispersed: boolean;
  reservable: boolean | null;
  fcfs: boolean | null;
  feeUSD: number | null;
  petsAllowed: boolean | null;
  amenityIds: string[]; // canonical amen:* ids that overlap the federal set
}

const truthy = (v: string | undefined): boolean => v != null && !['no', 'false', '0', 'none'].includes(v.toLowerCase());

/** Whether an OSM camp is dispersed/primitive (no reservation, stay-limits, LNT). Pure. */
export function isDispersed(tags: Record<string, string>): boolean {
  const cs = (tags.camp_site ?? '').toLowerCase();
  return (
    cs === 'basic' ||
    cs === 'wild' ||
    tags.backcountry === 'yes' ||
    tags['tourism'] === 'wilderness_hut' ||
    (tags.fee === 'no' && tags.reservation == null && tags.operator == null)
  );
}

/** Map OSM camp tags → canonical `amen:*` ids (only those that overlap the federal amenity set). Pure. */
export function osmCampAmenities(tags: Record<string, string>): string[] {
  const out: string[] = [];
  if (truthy(tags.drinking_water) || truthy(tags['drinking_water:legal'])) out.push('amen:potable-water');
  if (truthy(tags.shower)) out.push('amen:shower');
  if (truthy(tags.sanitary_dump_station)) out.push('amen:dump-station');
  const power = (tags.power_supply ?? '').toLowerCase();
  if (truthy(tags.power_supply)) out.push(power.includes('50') ? 'amen:hookup-50amp' : 'amen:hookup-30amp');
  return [...new Set(out)];
}

/** Parse a `charge`/`fee` tag into a USD number (best-effort). Pure. */
export function osmFeeUSD(tags: Record<string, string>): number | null {
  if (tags.fee === 'no') return 0;
  const m = /(\d+(?:\.\d+)?)/.exec(tags.charge ?? '');
  return m ? Math.round(Number(m[1])) : null;
}

/**
 * Convert an Overpass element into a campground record. Pure; null when it has no resolvable coordinate.
 * Unnamed primitive sites get a generic name so dispersed coverage isn't dropped.
 */
export function osmCampToRecord(el: OsmCampElement): OsmCampRecord | null {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat ?? null;
  const lng = el.lon ?? el.center?.lon ?? null;
  if (lat == null || lng == null) return null;
  const dispersed = isDispersed(tags);
  const name = (tags.name ?? '').trim() || (dispersed ? 'Dispersed campsite' : tags.tourism === 'caravan_site' ? 'RV / caravan site' : 'Campground');
  const reservable = tags.reservation == null ? null : truthy(tags.reservation);
  return {
    osmId: `osm:${el.type}/${el.id}`,
    name,
    lat,
    lng,
    dispersed,
    reservable,
    fcfs: reservable == null ? (dispersed ? true : null) : !reservable,
    feeUSD: osmFeeUSD(tags),
    petsAllowed: tags.dog == null && tags.dogs == null ? null : truthy(tags.dog ?? tags.dogs),
    amenityIds: osmCampAmenities(tags),
  };
}

/** Fetch OSM campgrounds in a bbox → records. Degrades to `[]` on any error. */
export async function fetchCampgroundsOSM(box: OsmBBox): Promise<OsmCampRecord[]> {
  const sel = `["tourism"~"^(camp_site|caravan_site|camp_pitch)$"]`;
  const b = `(${box.south},${box.west},${box.north},${box.east})`;
  const query =
    `[out:json][timeout:60];` +
    `(node${sel}${b};way${sel}${b};relation${sel}${b};);` +
    `out center tags;`;
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { elements?: OsmCampElement[] };
    return (json.elements ?? []).map(osmCampToRecord).filter((r): r is OsmCampRecord => r != null);
  } catch {
    return [];
  }
}
