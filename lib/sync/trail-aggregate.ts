import type { Feature, MultiLineString, Position } from 'geojson';
import { contentHash } from '../embeddings';
import { haversineMeters } from '../datasources/elevation';

/**
 * Aggregate NPS Public Trails GIS centerline segments into named `:Trail` entities (ADR-066). The GIS
 * data is SEGMENT-level (split at junctions + attribute changes), so a named hike like "Bright Angel
 * Trail" is many features that all share `TRLNAME`, and many connector segments have a blank `TRLNAME`.
 *
 * This pure, I/O-free module groups by `(park, TRLNAME)`, merges geometry into a MultiLineString, sums
 * the GIS length, parses use/class/surface/status, derives a best-effort route type + bbox + a default
 * trailhead endpoint, and simplifies polylines (Douglas–Peucker). Blank-named connectors are dropped here
 * (they feed the junction network in a later derive step, never a standalone trail). The ingest step
 * (sync-trails) fetches the FeatureCollection, calls this, persists metadata to Neo4j + geometry to Blob.
 */

export interface NpsTrailProps {
  TRLNAME?: string | null;
  UNITCODE?: string | null;
  TRLUSE?: string | null;
  TRLTYPE?: string | null;
  TRLCLASS?: string | null;
  TRLSURFACE?: string | null;
  TRLSTATUS?: string | null;
  SEASONAL?: string | null;
  SEASDESC?: string | null;
  OPENTOPUBLIC?: string | null;
  Shape__Length?: number | null; // GIS length in SOURCE-SR degrees (wkid 6318) — NOT meters; we ignore it
  [k: string]: unknown;
}

export type AllowedUse = 'hike' | 'bike' | 'horse' | 'ada' | 'ski' | 'motorized' | 'water';
export type RouteType = 'loop' | 'point-to-point' | 'network' | null;

export interface AggregatedTrail {
  id: string;
  name: string;
  parkCode: string;
  source: 'nps' | 'osm';
  lengthMiles: number;
  routeType: RouteType;
  trailClass: number | null;
  surface: string | null;
  allowedUses: AllowedUse[];
  dogsAllowed: boolean | null; // unknown from GIS — filled later from :ThingToDo pets via ALONG
  wheelchairAccessible: boolean;
  status: string | null;
  segments: number;
  dataConfidence: 'high' | 'medium' | 'low';
  trailheadPoint: [number, number]; // [lng, lat]; refined to nearest parking by a derive step
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  geometry: MultiLineString; // simplified
  contentHash: string;
}

const METERS_PER_MILE = 1609.344;
const COORD_PRECISION = 5; // ~1m — endpoint coincidence for route type / junctions

export function metersToMiles(m: number): number {
  return Math.round(((m || 0) / METERS_PER_MILE) * 100) / 100;
}

/**
 * Geodesic length of a polyline in meters (sum of great-circle hops). We compute length from the WGS84
 * coordinates rather than the GIS `Shape__Length` field, which the FeatureServer returns in the source SR's
 * units (planar DEGREES, wkid 6318) — using it as meters collapses every trail length to ~0 (ADR-066).
 */
export function lineMeters(line: Position[]): number {
  let m = 0;
  for (let i = 1; i < line.length; i++) m += haversineMeters(line[i - 1], line[i]);
  return m;
}

export function slugify(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

export function trailId(parkCode: string, name: string, source = 'nps'): string {
  return `${source}:${parkCode}:${slugify(name)}`;
}

/** Map the NPS `TRLUSE` string (often a delimited list) to canonical allowed uses. Pure. */
export function parseAllowedUses(trluse: string | null | undefined): AllowedUse[] {
  const t = (trluse ?? '').toLowerCase();
  const uses = new Set<AllowedUse>();
  if (/hik|pedestrian|foot|walk/.test(t)) uses.add('hike');
  if (/bicycle|\bbike|cycl/.test(t)) uses.add('bike');
  if (/saddle|pack|horse|equestrian|stock/.test(t)) uses.add('horse');
  if (/\bada\b|wheelchair|accessible/.test(t)) uses.add('ada');
  if (/\bski\b|snowshoe|nordic/.test(t)) uses.add('ski');
  if (/motor|\batv\b|\bohv\b|snowmobile/.test(t)) uses.add('motorized');
  if (/paddle|canoe|kayak|\bboat/.test(t)) uses.add('water');
  // A named NPS trail with no parsed use is assumed hikeable.
  if (uses.size === 0) uses.add('hike');
  return [...uses];
}

/** Parse a `TRLCLASS` value ("Class 3", "3", "TC3") into 1–5, or null. Pure. */
export function parseTrailClass(s: string | null | undefined): number | null {
  const m = /([1-5])/.exec(s ?? '');
  return m ? Number(m[1]) : null;
}

function lineStringsOf(geom: Feature['geometry']): Position[][] {
  if (!geom) return [];
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}

function key(p: Position): string {
  return `${p[0].toFixed(COORD_PRECISION)},${p[1].toFixed(COORD_PRECISION)}`;
}

/**
 * Best-effort route type from the topology of the merged segments. `loop` = no dead-ends; `network` =
 * any junction (degree ≥ 3) or >2 termini; `point-to-point` = exactly two termini, no junctions; else
 * null. We never claim `out-and-back` — geometry can't distinguish it from point-to-point. Pure.
 */
export function deriveRouteType(lines: Position[][]): RouteType {
  const segs = lines.filter((l) => l.length >= 2);
  if (segs.length === 0) return null;
  const deg = new Map<string, number>();
  for (const line of segs) {
    for (const p of [line[0], line[line.length - 1]]) {
      const k = key(p);
      deg.set(k, (deg.get(k) ?? 0) + 1);
    }
  }
  const degrees = [...deg.values()];
  const termini = degrees.filter((d) => d === 1).length;
  const junctions = degrees.filter((d) => d >= 3).length;
  if (junctions > 0 || termini > 2) return 'network';
  if (termini === 0) return 'loop';
  if (termini === 2) return 'point-to-point';
  return null;
}

/** A deterministic default trailhead: the southern/western-most terminus (else the first vertex). Pure. */
export function defaultTrailhead(lines: Position[][]): [number, number] {
  const segs = lines.filter((l) => l.length >= 2);
  const deg = new Map<string, { p: Position; d: number }>();
  for (const line of segs) {
    for (const p of [line[0], line[line.length - 1]]) {
      const k = key(p);
      const e = deg.get(k);
      if (e) e.d += 1;
      else deg.set(k, { p, d: 1 });
    }
  }
  const termini = [...deg.values()].filter((e) => e.d === 1).map((e) => e.p);
  const candidates = termini.length ? termini : segs[0] ? [segs[0][0]] : [];
  candidates.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const c = candidates[0] ?? [0, 0];
  return [c[0], c[1]];
}

function perpDist(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

/** Douglas–Peucker line simplification (tolerance in degrees). Pure, no external dep. */
export function simplifyLine(coords: Position[], tolerance: number): Position[] {
  if (coords.length <= 2 || tolerance <= 0) return coords;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const d = perpDist(coords[i], coords[0], coords[coords.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > tolerance) {
    const left = simplifyLine(coords.slice(0, idx + 1), tolerance);
    const right = simplifyLine(coords.slice(idx), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [coords[0], coords[coords.length - 1]];
}

function bboxOf(lines: Position[][]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const line of lines) {
    for (const [lng, lat] of line) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

function confidence(
  segments: number,
  lengthMiles: number,
  trailClass: number | null,
): 'high' | 'medium' | 'low' {
  if (lengthMiles < 0.1) return 'low';
  if (trailClass != null && lengthMiles >= 0.25 && segments >= 1) return 'high';
  return 'medium';
}

/**
 * Aggregate a park's GIS trail features into named `:Trail`s. Features with a blank `TRLNAME` are
 * dropped (ADR-066). Returns trails sorted longest-first.
 */
export function aggregateTrails(
  features: Feature[],
  opts: { parkCode: string; simplifyTolerance?: number; source?: 'nps' | 'osm' },
): AggregatedTrail[] {
  const tol = opts.simplifyTolerance ?? 0.00008; // ~9m in degrees at mid-latitudes
  const src = opts.source ?? 'nps';
  const groups = new Map<string, Feature[]>();
  for (const f of features) {
    const name = ((f.properties as NpsTrailProps | null)?.TRLNAME ?? '').trim();
    if (!name) continue;
    // Key by the SLUG (the identity key), not raw lowercase: 'Rim-to-Rim' and 'Rim to Rim' must aggregate
    // into one trail, else they'd form two groups with the same id and collide on MERGE (ADR-066).
    const k = slugify(name);
    if (!k) continue;
    let arr = groups.get(k);
    if (!arr) {
      arr = [];
      groups.set(k, arr);
    }
    arr.push(f);
  }

  const trails: AggregatedTrail[] = [];
  for (const group of groups.values()) {
    const props0 = (group[0].properties ?? {}) as NpsTrailProps;
    const name = (props0.TRLNAME ?? '').trim();
    const rawLines = group.flatMap((f) => lineStringsOf(f.geometry)).filter((l) => l.length >= 2);
    if (rawLines.length === 0) continue;

    // Geodesic length from the WGS84 geometry (NOT Shape__Length, which is in source-SR degrees — ADR-066).
    const lengthMiles = metersToMiles(rawLines.reduce((s, l) => s + lineMeters(l), 0));
    const allowedUses = parseAllowedUses(
      group.map((f) => (f.properties as NpsTrailProps)?.TRLUSE ?? '').join(' '),
    );
    const trailClass = parseTrailClass(props0.TRLCLASS);
    const surface = (props0.TRLSURFACE ?? '').trim() || null;
    const status = (props0.TRLSTATUS ?? props0.OPENTOPUBLIC ?? '').trim() || null;
    const routeType = deriveRouteType(rawLines);
    const bbox = bboxOf(rawLines);
    const trailheadPoint = defaultTrailhead(rawLines);
    const geometry: MultiLineString = {
      type: 'MultiLineString',
      coordinates: rawLines.map((l) => simplifyLine(l, tol)),
    };
    const wheelchairAccessible =
      allowedUses.includes('ada') || /paved|boardwalk/i.test(surface ?? '');
    const id = trailId(opts.parkCode, name, src);
    const hash = contentHash(
      JSON.stringify({ id, lengthMiles, routeType, trailClass, surface, status, allowedUses, coords: geometry.coordinates }),
    );

    trails.push({
      id,
      name,
      parkCode: opts.parkCode,
      source: src,
      lengthMiles,
      routeType,
      trailClass,
      surface,
      allowedUses,
      dogsAllowed: null,
      wheelchairAccessible,
      status,
      segments: group.length,
      dataConfidence: confidence(group.length, lengthMiles, trailClass),
      trailheadPoint,
      bbox,
      geometry,
      contentHash: hash,
    });
  }

  return trails.sort((a, b) => b.lengthMiles - a.lengthMiles);
}
