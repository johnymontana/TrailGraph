import { readGraph } from './neo4j';
import { embedQuery } from './embed-cache';
import { labelColor, type ParkNodeNav } from './graph-nvl';
import { normalizeCrowdCurve, type CrowdCurvePoint } from './datasources/visitation';
import { parseOperatingHours, openStateOn, summarizeClosures, type DayState } from './sync/hours';
import { isFeeFreeDay } from './datasources/feefree';
import type { Node as NvlNode, Relationship as NvlRel } from '@neo4j-nvl/base';

/**
 * Domain read queries (AD-4): discovery/map/detail go straight to Neo4j, no agent hop.
 * These power Explore (A1-A3), the map (B1-B2), and A4 vibe search.
 */

export interface ParkSummary {
  parkCode: string;
  name: string;
  designation: string;
  states: string;
  lat: number | null;
  lng: number | null;
  image: string | null;
  // At-a-glance facets surfaced as card badges (ADR-039). Derived from already-synced §5 props.
  darkSky: boolean;
  accessible: boolean;
  feeFree: boolean; // F2: park charges no entrance fee
}

export const PARK_SUMMARY_RETURN = `
  p.parkCode AS parkCode, p.fullName AS name, p.designation AS designation, p.states AS states,
  p.location.latitude AS lat, p.location.longitude AS lng,
  CASE WHEN size(coalesce(p.images, [])) > 0 THEN p.images[0] ELSE null END AS image,
  (coalesce(p.darkSkyCertified, false) OR coalesce(p.bortleScale, 99) <= 3) AS darkSky,
  EXISTS { (cg:Campground)-[:IN_PARK]->(p) WHERE cg.wheelchairAccessible = true } AS accessible,
  coalesce(p.feeFree, false) AS feeFree
`;

/** Faceted + full-text park search (A1, A3) with paging + accurate total (§2.9). */
export async function searchParks(opts: {
  q?: string;
  stateCode?: string;
  activity?: string;
  topic?: string;
  amenity?: string;
  designation?: string;
  darkSky?: boolean;
  // F2/F3/F9/F10 discovery facets (plan P0-3) — each is a no-op when falsy.
  feeFree?: boolean;
  evParking?: boolean;
  hookups?: boolean;
  firstCome?: boolean;
  groupSites?: boolean;
  region?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ParkSummary[]; total: number }> {
  const { q, stateCode, activity, topic, amenity, designation, darkSky, feeFree, evParking, hookups, firstCome, groupSites, region, limit = 24, offset = 0 } = opts;
  const where: string[] = [];
  if (stateCode) where.push('(p)-[:LOCATED_IN]->(:State {code:$stateCode})');
  if (activity) where.push('(p)-[:OFFERS]->(:Activity {name:$activity})');
  if (topic) where.push('(p)-[:HAS_TOPIC]->(:Topic {name:$topic})');
  // An amenity lives on a park's Place/VisitorCenter/Campground (NPS-expansion P1 #5) — a park
  // "has" it if any of its child nodes does.
  if (amenity)
    where.push(
      `(EXISTS { (p)-[:HAS_PLACE]->(:Place)-[:HAS_AMENITY]->(:Amenity {name:$amenity}) }
        OR EXISTS { (vc:VisitorCenter)-[:IN_PARK]->(p) WHERE (vc)-[:HAS_AMENITY]->(:Amenity {name:$amenity}) }
        OR EXISTS { (cg:Campground)-[:IN_PARK]->(p) WHERE (cg)-[:HAS_AMENITY]->(:Amenity {name:$amenity}) })`,
    );
  if (designation) where.push('p.designation = $designation');
  if (darkSky) where.push('p.darkSkyCertified = true');
  if (feeFree) where.push('coalesce(p.feeFree, false) = true'); // F2
  if (evParking) where.push('EXISTS { (p)<-[:IN_PARK]-(pl:ParkingLot) WHERE pl.hasEvCharging = true }'); // F10
  if (hookups) where.push('EXISTS { (p)<-[:IN_PARK]-(cg:Campground) WHERE cg.hasHookups = true }'); // F3
  if (firstCome) where.push('EXISTS { (p)<-[:IN_PARK]-(cg:Campground) WHERE cg.sitesFirstCome > 0 }'); // F3
  if (groupSites) where.push('EXISTS { (p)<-[:IN_PARK]-(cg:Campground) WHERE cg.groupSites > 0 }'); // F3
  if (region) where.push('(p)-[:IN_REGION]->(:Region {name:$region})'); // F9
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const source = q
    ? `CALL db.index.fulltext.queryNodes('park_fulltext', $q) YIELD node AS p, score ${whereClause}`
    : `MATCH (p:Park) ${whereClause} WITH p, 0.0 AS score`;
  const order = q ? 'ORDER BY score DESC, name ASC' : 'ORDER BY name ASC';

  const params = {
    q: q ?? null,
    stateCode: stateCode ?? null,
    activity: activity ?? null,
    topic: topic ?? null,
    amenity: amenity ?? null,
    designation: designation ?? null,
    region: region ?? null,
    limit,
    offset,
  };

  const items = await readGraph<ParkSummary>(
    `${source} RETURN ${PARK_SUMMARY_RETURN}, score ${order} SKIP toInteger($offset) LIMIT toInteger($limit)`,
    params,
  );
  const totalRows = await readGraph<{ total: number }>(`${source} RETURN count(p) AS total`, params);
  return { items, total: totalRows[0]?.total ?? items.length };
}

/** Full park detail (A2) — nested JSON props parsed back to objects. */
/**
 * Hero/gallery images for a park. Prefer the rich `imagesFull` records (`{url,caption,...}`); when those
 * are absent, lift the plain `p.images` URL list (what cards render) into `{url}` records so the hero
 * isn't a gradient placeholder while the card shows a real photo (ADR-039).
 */
export function imagesWithFallback(full: unknown, plain: unknown): { url: string }[] {
  const rich = Array.isArray(full) ? full.filter((x) => x && typeof (x as { url?: unknown }).url === 'string') : [];
  if (rich.length > 0) return rich as { url: string }[];
  if (Array.isArray(plain)) {
    return plain
      .map((x) => (typeof x === 'string' ? { url: x } : x && typeof (x as { url?: unknown }).url === 'string' ? (x as { url: string }) : null))
      .filter((x): x is { url: string } => x != null);
  }
  return [];
}

export async function parkDetail(parkCode: string) {
  const rows = await readGraph<{
    p: Record<string, unknown>;
    lat: number | null;
    lng: number | null;
    activities: string[];
    topics: string[];
    states: { code: string; name: string }[];
    alerts: { id: string; category: string; title: string; url: string | null; description: string }[];
    campgrounds: {
      id: string;
      name: string;
      reservationUrl: string | null;
      totalSites: number | null;
      sitesFirstCome: number | null;
      hasHookups: boolean | null;
      hasDumpStation: boolean | null;
    }[];
    visitorCenters: { id: string; name: string }[];
    thingsToDo: {
      id: string;
      title: string;
      difficulty: string | null;
      length: number | null;
      elevationGain: number | null;
      durationText: string | null;
      petsAllowed: boolean | null;
      timeOfDay: string[];
      season: string[];
    }[];
    openSeasons: string[];
  }>(
    // Each list is its own CALL subquery to avoid a cartesian product across relationship types.
    `
    MATCH (p:Park {parkCode: $parkCode})
    CALL { WITH p OPTIONAL MATCH (p)-[:OFFERS]->(a:Activity) RETURN collect(DISTINCT a.name) AS activities }
    CALL { WITH p OPTIONAL MATCH (p)-[:HAS_TOPIC]->(t:Topic) RETURN collect(DISTINCT t.name) AS topics }
    CALL { WITH p OPTIONAL MATCH (p)-[:LOCATED_IN]->(s:State) RETURN collect(DISTINCT {code: s.code, name: coalesce(s.name, s.code)}) AS states }
    CALL { WITH p OPTIONAL MATCH (al:Alert)-[:AFFECTS]->(p) WHERE al.active = true
           RETURN collect(DISTINCT {id: al.id, category: al.category, title: al.title, url: al.url, description: al.description}) AS alerts }
    CALL { WITH p OPTIONAL MATCH (c:Campground)-[:IN_PARK]->(p)
           RETURN collect(DISTINCT {id: c.id, name: c.name, reservationUrl: c.reservationUrl, totalSites: c.totalSites, sitesFirstCome: c.sitesFirstCome, hasHookups: c.hasHookups, hasDumpStation: c.hasDumpStation}) AS campgrounds }
    CALL { WITH p OPTIONAL MATCH (v:VisitorCenter)-[:IN_PARK]->(p) RETURN collect(DISTINCT {id: v.id, name: v.name}) AS visitorCenters }
    CALL { WITH p OPTIONAL MATCH (n:ThingToDo)-[:AT_PARK]->(p) RETURN collect(DISTINCT {id: n.id, title: n.title, difficulty: n.difficulty, length: n.lengthMiles, elevationGain: n.elevationGainFt, durationText: n.durationText, petsAllowed: n.petsAllowed, timeOfDay: coalesce(n.timeOfDay, []), season: coalesce(n.season, [])}) AS thingsToDo }
    CALL { WITH p OPTIONAL MATCH (p)-[:OPEN_IN]->(s:Season) RETURN collect(DISTINCT s.name) AS openSeasons }
    RETURN p{.*} AS p, p.location.latitude AS lat, p.location.longitude AS lng,
      activities, topics, states, alerts, campgrounds, visitorCenters, thingsToDo, openSeasons
    `,
    { parkCode },
  );
  if (!rows.length) return null;
  const r = rows[0];
  const p = r.p as Record<string, unknown>;
  const parse = (s: unknown) => {
    try {
      return typeof s === 'string' ? JSON.parse(s) : s;
    } catch {
      return null;
    }
  };
  return {
    parkCode: p.parkCode,
    name: p.fullName,
    designation: p.designation,
    description: p.description,
    states: r.states.filter((s) => s.code),
    url: p.url,
    directionsUrl: p.directionsUrl,
    weatherInfo: p.weatherInfo,
    phone: (p.phone as string) ?? null, // bonus: queryable contacts
    email: (p.email as string) ?? null,
    lat: r.lat,
    lng: r.lng,
    // The hero reads `images[0].url`. `imagesFull` (rich JSON) is the primary source, but it's empty for
    // some parks whose `p.images` (the URL list the cards use) is populated — fall back so the hero
    // shows the same photo the card does instead of a gradient placeholder (ADR-039, friction #7).
    images: imagesWithFallback(parse(p.imagesFull), p.images),
    entranceFees: parse(p.entranceFees) ?? [],
    operatingHours: parse(p.operatingHours) ?? [],
    contacts: parse(p.contacts) ?? {},
    activities: r.activities.filter(Boolean),
    topics: r.topics.filter(Boolean),
    alerts: r.alerts.filter((a) => a.id),
    campgrounds: r.campgrounds.filter((c) => c.id),
    visitorCenters: r.visitorCenters.filter((v) => v.id),
    thingsToDo: r.thingsToDo.filter((n) => n.id),
    // §5 conditions (from the data-source adapters; null/empty until `pnpm datasources:sync`).
    darkSkyCertified: (p.darkSkyCertified as boolean) ?? false,
    bortleScale: (p.bortleScale as number) ?? null,
    crowdLevel: (p.crowdLevel as string) ?? null,
    bestMonths: (p.bestMonths as number[]) ?? [],
    monthlyVisits: (p.monthlyVisits as number[]) ?? [],
    annualVisits: (p.annualVisits as number) ?? null,
    timedEntry: (p.timedEntry as boolean) ?? false,
    permitUrl: (p.permitUrl as string) ?? null,
    // F1: seasonal access — denormalized closure summary + the open seasons derived at sync.
    seasonalClosureSummary: (p.seasonalClosureSummary as string) ?? null,
    openSeasons: (r.openSeasons ?? []).filter(Boolean),
  };
}

export interface OpenCheck {
  parkCode: string;
  name: string;
  date: string;
  state: DayState; // 'open' | 'closed' | 'unknown'
  closureSummary: string | null;
  feeFree: { name: string } | null;
}

/**
 * F1: is a park open on a given ISO date? Reuses the stored operatingHours JSON + the pure
 * `lib/sync/hours.ts` logic (the graph nodes power cross-park date filtering; this point check is cheap
 * and DRY). `state` is 'unknown' (never falsely 'closed') when the park reports no hours. Also flags a
 * national fee-free day on that date (F2).
 */
export async function checkOpen(parkCode: string, isoDate: string): Promise<OpenCheck | null> {
  const rows = await readGraph<{ name: string; hours: string | null; summary: string | null }>(
    `MATCH (p:Park {parkCode: $parkCode})
     RETURN p.fullName AS name, p.operatingHours AS hours, p.seasonalClosureSummary AS summary`,
    { parkCode },
  );
  if (!rows.length) return null;
  let raw: unknown = [];
  try {
    raw = rows[0].hours ? JSON.parse(rows[0].hours) : [];
  } catch {
    raw = [];
  }
  const schedules = parseOperatingHours(raw, parkCode);
  const ff = isFeeFreeDay(isoDate);
  return {
    parkCode,
    name: rows[0].name,
    date: isoDate,
    state: openStateOn(schedules, isoDate),
    closureSummary: rows[0].summary ?? summarizeClosures(schedules),
    feeFree: ff ? { name: ff.name } : null,
  };
}

export interface ClosureWarning {
  parkCode: string;
  name: string;
  state: DayState; // open/closed/unknown on the checked date
  summary: string | null; // dated seasonal closures (date-independent)
}

/**
 * F1 (plan P0-1): for a set of trip parks + a travel date, return the parks that are closed on that date
 * or carry a dated seasonal closure — so the planner can flag "this stop's road is closed in winter."
 * One query (operatingHours JSON) + the pure `lib/sync/hours.ts` logic, reused from `checkOpen`.
 */
export async function closureWarningsForTrip(parkCodes: string[], isoDate: string): Promise<ClosureWarning[]> {
  if (!parkCodes.length) return [];
  const rows = await readGraph<{ parkCode: string; name: string; hours: string | null; summary: string | null }>(
    `UNWIND $parkCodes AS pc MATCH (p:Park {parkCode: pc})
     RETURN p.parkCode AS parkCode, p.fullName AS name, p.operatingHours AS hours, p.seasonalClosureSummary AS summary`,
    { parkCodes },
  );
  const out: ClosureWarning[] = [];
  for (const r of rows) {
    let raw: unknown = [];
    try {
      raw = r.hours ? JSON.parse(r.hours) : [];
    } catch {
      raw = [];
    }
    const schedules = parseOperatingHours(raw, r.parkCode);
    const state = openStateOn(schedules, isoDate);
    const summary = r.summary ?? summarizeClosures(schedules);
    if (state === 'closed' || summary) out.push({ parkCode: r.parkCode, name: r.name, state, summary });
  }
  return out;
}

export interface TripBudget {
  unit: string;
  parks: { parkCode: string; name: string; fee: number | null; feeFree: boolean }[];
  total: number;
  atbCost: number;
  atbSaves: boolean; // does the America-the-Beautiful annual pass beat paying per-park?
}

/**
 * F2: total entrance cost for a set of parks for one billing unit (vehicle/person/motorcycle), and
 * whether the $80 America-the-Beautiful annual pass is cheaper. Sums the per-park `EntranceFee` of that
 * unit (cheapest when a park lists several). Parks with no fee of that unit (or feeFree) contribute 0.
 */
export async function tripBudget(parkCodes: string[], unit = 'vehicle'): Promise<TripBudget> {
  const rows = await readGraph<{ parkCode: string; name: string; fee: number | null; feeFree: boolean }>(
    `UNWIND $parkCodes AS pc
     MATCH (p:Park {parkCode: pc})
     OPTIONAL MATCH (p)-[:CHARGES]->(f:EntranceFee {unit: $unit})
     WITH p, min(f.cost) AS fee
     RETURN p.parkCode AS parkCode, p.fullName AS name,
            CASE WHEN coalesce(p.feeFree, false) THEN 0.0 ELSE coalesce(fee, 0.0) END AS fee,
            coalesce(p.feeFree, false) AS feeFree
     ORDER BY name ASC`,
    { parkCodes, unit },
  );
  const total = rows.reduce((s, r) => s + (r.fee ?? 0), 0);
  const atb = await readGraph<{ cost: number | null }>(
    `MATCH (e:EntrancePass {id: 'atb-annual'}) RETURN e.cost AS cost`,
  );
  const atbCost = atb[0]?.cost ?? 80;
  return { unit, parks: rows, total, atbCost, atbSaves: total > atbCost };
}

export interface AccessibilityScorecard {
  parkCode: string;
  name: string;
  features: string[]; // distinct accessibility amenity names present across the park's child nodes
  accessibleCampgrounds: number;
  audioDescribedPlaces: number;
}

/**
 * F5: a park's accessibility scorecard — the distinct accessibility amenities reported across its
 * places/campgrounds/visitor-centers/things-to-do/parking, plus accessible-campground and
 * audio-described-place counts. Data is self-reported by the park ("reported, verify with the park").
 */
export async function accessibilityScorecard(parkCode: string): Promise<AccessibilityScorecard | null> {
  const rows = await readGraph<{
    name: string;
    features: string[];
    accessibleCampgrounds: number;
    audioDescribedPlaces: number;
  }>(
    `MATCH (p:Park {parkCode: $parkCode})
     CALL {
       WITH p
       MATCH (child)-[:HAS_AMENITY]->(am:Amenity {accessibility: true})
       WHERE EXISTS { (p)-[:HAS_PLACE]->(child) } OR EXISTS { (child)-[:IN_PARK]->(p) } OR EXISTS { (child)-[:AT_PARK]->(p) }
       RETURN collect(DISTINCT am.name) AS features
     }
     CALL { WITH p OPTIONAL MATCH (cg:Campground)-[:IN_PARK]->(p) WHERE cg.wheelchairAccessible = true RETURN count(DISTINCT cg) AS accessibleCampgrounds }
     CALL { WITH p OPTIONAL MATCH (p)-[:HAS_PLACE]->(pl:Place) WHERE pl.audioDescription IS NOT NULL AND pl.audioDescription <> '' RETURN count(DISTINCT pl) AS audioDescribedPlaces }
     RETURN p.fullName AS name, features, accessibleCampgrounds, audioDescribedPlaces`,
    { parkCode },
  );
  if (!rows.length) return null;
  return {
    parkCode,
    name: rows[0].name,
    features: (rows[0].features ?? []).filter(Boolean),
    accessibleCampgrounds: rows[0].accessibleCampgrounds ?? 0,
    audioDescribedPlaces: rows[0].audioDescribedPlaces ?? 0,
  };
}

/** Proximity (B2) — great-circle via point index (ADR-004). */
export async function parksNear(lat: number, lng: number, radiusMiles = 150, limit = 20) {
  return readGraph<ParkSummary & { miles: number }>(
    `MATCH (p:Park) WHERE p.location IS NOT NULL
       AND point.distance(p.location, point({latitude:$lat, longitude:$lng})) < $meters
     RETURN ${PARK_SUMMARY_RETURN},
       point.distance(p.location, point({latitude:$lat, longitude:$lng}))/1609.344 AS miles
     ORDER BY miles ASC LIMIT toInteger($limit)`,
    { lat, lng, meters: radiusMiles * 1609.344, limit },
  );
}

/** Viewport load for the map (B1, §12.4) — lazy per-bbox. */
export async function parksInBBox(box: {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}) {
  return readGraph<ParkSummary>(
    `MATCH (p:Park) WHERE p.location IS NOT NULL
       AND point.withinBBox(p.location,
             point({latitude:$minLat, longitude:$minLng}),
             point({latitude:$maxLat, longitude:$maxLng}))
     RETURN ${PARK_SUMMARY_RETURN}`,
    { minLat: box.minLat, minLng: box.minLng, maxLat: box.maxLat, maxLng: box.maxLng },
  );
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}
export interface PoiMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  parkCode: string | null;
}

/** Map layer POIs by viewport (B3). `label` ∈ Campground | VisitorCenter | ThingToDo. */
async function poisInBBox(label: 'Campground' | 'VisitorCenter' | 'ThingToDo', box: BBox): Promise<PoiMarker[]> {
  const nameField = label === 'ThingToDo' ? 'n.title' : 'n.name';
  return readGraph<PoiMarker>(
    `MATCH (n:\`${label}\`) WHERE n.location IS NOT NULL
       AND point.withinBBox(n.location, point({latitude:$minLat, longitude:$minLng}), point({latitude:$maxLat, longitude:$maxLng}))
     OPTIONAL MATCH (n)-[:IN_PARK|AT_PARK]->(p:Park)
     RETURN n.id AS id, ${nameField} AS name,
            n.location.latitude AS lat, n.location.longitude AS lng, p.parkCode AS parkCode`,
    { minLat: box.minLat, minLng: box.minLng, maxLat: box.maxLat, maxLng: box.maxLng },
  );
}

export const campgroundsInBBox = (box: BBox) => poisInBBox('Campground', box);
export const visitorCentersInBBox = (box: BBox) => poisInBBox('VisitorCenter', box);
export const thingsToDoInBBox = (box: BBox) => poisInBBox('ThingToDo', box);

/** Parks with an active Closure/Danger alert in the viewport (B3 alerts layer). */
export async function alertParksInBBox(box: BBox) {
  return readGraph<{ parkCode: string; name: string; lat: number; lng: number; alerts: number }>(
    `MATCH (a:Alert)-[:AFFECTS]->(p:Park)
     WHERE a.active = true AND a.category IN ['Closure','Danger'] AND p.location IS NOT NULL
       AND point.withinBBox(p.location, point({latitude:$minLat, longitude:$minLng}), point({latitude:$maxLat, longitude:$maxLng}))
     RETURN p.parkCode AS parkCode, p.fullName AS name,
            p.location.latitude AS lat, p.location.longitude AS lng, count(a) AS alerts`,
    { minLat: box.minLat, minLng: box.minLng, maxLat: box.maxLat, maxLng: box.maxLng },
  );
}

/** Facet values for the Explore sidebar (A1). */
export async function facets() {
  const rows = await readGraph<{
    activities: string[];
    topics: string[];
    amenities: string[];
    designations: string[];
    states: { code: string; name: string }[];
    regions: string[];
  }>(
    `
    CALL { MATCH (a:Activity) RETURN collect(DISTINCT a.name) AS activities }
    CALL { MATCH (t:Topic) RETURN collect(DISTINCT t.name) AS topics }
    // Only amenities actually wired to a child node are useful as park filters. Exclude the synthetic
    // accessibility/campground amenities (id 'amen:*') — those are surfaced by dedicated facets, not the
    // generic Amenity dropdown (plan P0-4).
    CALL { MATCH (am:Amenity) WHERE EXISTS { ()-[:HAS_AMENITY]->(am) } AND NOT coalesce(am.id, '') STARTS WITH 'amen:'
           RETURN collect(DISTINCT am.name) AS amenities }
    CALL { MATCH (p:Park) WHERE p.designation <> '' RETURN collect(DISTINCT p.designation) AS designations }
    CALL { MATCH (s:State) RETURN collect(DISTINCT {code: s.code, name: s.name}) AS states }
    CALL { MATCH (r:Region) RETURN collect(DISTINCT r.name) AS regions } // F9
    RETURN activities, topics, amenities, designations, states, regions
    `,
  );
  return rows[0] ?? { activities: [], topics: [], amenities: [], designations: [], states: [], regions: [] };
}

/**
 * Related parks (§6) — the graph made visible. Three relationship lenses, each returning ParkSummary
 * cards (reusing PARK_SUMMARY_RETURN by aliasing the related park to `p`).
 */
export async function similarParks(parkCode: string, limit = 6): Promise<(ParkSummary & { shared: number })[]> {
  return readGraph(
    `MATCH (src:Park {parkCode:$parkCode})-[:OFFERS|HAS_TOPIC]->(shared)<-[:OFFERS|HAS_TOPIC]-(other:Park)
     WHERE other.parkCode <> $parkCode
     WITH other AS p, count(DISTINCT shared) AS shared
     RETURN ${PARK_SUMMARY_RETURN}, shared
     ORDER BY shared DESC, name ASC LIMIT toInteger($limit)`,
    { parkCode, limit },
  );
}

export async function nearbyParks(parkCode: string, radiusMiles = 200, limit = 6): Promise<(ParkSummary & { miles: number })[]> {
  return readGraph(
    `MATCH (src:Park {parkCode:$parkCode}) WHERE src.location IS NOT NULL
     MATCH (p:Park) WHERE p.parkCode <> $parkCode AND p.location IS NOT NULL
       AND point.distance(p.location, src.location) < $meters
     RETURN ${PARK_SUMMARY_RETURN}, point.distance(p.location, src.location)/1609.344 AS miles
     ORDER BY miles ASC LIMIT toInteger($limit)`,
    { parkCode, meters: radiusMiles * 1609.344, limit },
  );
}

/**
 * F9: parks linked by a materialized NEAR edge (nearest-N within radius), ordered by drive-line distance.
 * Use for tight multi-park trip-candidate seeding ("what else is near Mesa Verde?"). Falls back to the
 * runtime `nearbyParks` shape when NEAR edges aren't built yet (returns []).
 */
export async function nearParks(parkCode: string, limit = 8): Promise<(ParkSummary & { miles: number })[]> {
  return readGraph(
    `MATCH (src:Park {parkCode: $parkCode})-[r:NEAR]->(p:Park)
     RETURN ${PARK_SUMMARY_RETURN}, r.miles AS miles
     ORDER BY miles ASC LIMIT toInteger($limit)`,
    { parkCode, limit },
  );
}

/** F9: parks in a curated region, for regional discovery on Explore. */
export async function parksInRegion(region: string, limit = 60): Promise<ParkSummary[]> {
  return readGraph(
    `MATCH (p:Park)-[:IN_REGION]->(:Region {name: $region})
     RETURN ${PARK_SUMMARY_RETURN} ORDER BY name ASC LIMIT toInteger($limit)`,
    { region, limit },
  );
}

export async function oftenPlannedTogether(parkCode: string, limit = 6): Promise<(ParkSummary & { together: number })[]> {
  return readGraph(
    `MATCH (:Park {parkCode:$parkCode})<-[:OF_PARK]-(:Stop)<-[:HAS_STOP]-(t:Trip)-[:HAS_STOP]->(:Stop)-[:OF_PARK]->(p:Park)
     WHERE p.parkCode <> $parkCode
     WITH p, count(DISTINCT t) AS together
     RETURN ${PARK_SUMMARY_RETURN}, together
     ORDER BY together DESC, name ASC LIMIT toInteger($limit)`,
    { parkCode, limit },
  );
}

/**
 * Graph neighborhood for the constellation view (R2 §P3): National Parks as nodes, linked when they
 * share ≥`minShared` topics. Returns a {nodes, links} shape ready for a force-directed graph.
 */
export async function graphNeighborhood(minShared = 3, limit = 250) {
  const rows = await readGraph<{
    a: string;
    aName: string;
    b: string;
    bName: string;
    shared: number;
    topics: string[];
  }>(
    `MATCH (p:Park)-[:HAS_TOPIC]->(t:Topic)<-[:HAS_TOPIC]-(q:Park)
     WHERE p.designation CONTAINS 'National Park' AND q.designation CONTAINS 'National Park'
       AND elementId(p) < elementId(q)
     WITH p, q, collect(DISTINCT t.name) AS topics
     WITH p, q, topics, size(topics) AS shared
     WHERE shared >= toInteger($minShared)
     RETURN p.parkCode AS a, p.fullName AS aName, q.parkCode AS b, q.fullName AS bName, shared, topics
     ORDER BY shared DESC LIMIT toInteger($limit)`,
    { minShared, limit },
  );
  // Track node degree so the view can persistently label hub parks (R3 §4.3); links carry the shared
  // topic names so an edge can explain *why* two parks connect ("linked by: Night Sky, Geology").
  const nodes = new Map<string, { id: string; name: string; degree: number }>();
  const bump = (id: string, name: string) => {
    const n = nodes.get(id) ?? { id, name, degree: 0 };
    n.degree += 1;
    nodes.set(id, n);
  };
  const links = rows.map((r) => {
    bump(r.a, r.aName);
    bump(r.b, r.bName);
    return { source: r.a, target: r.b, value: r.shared, topics: r.topics ?? [] };
  });
  return { nodes: [...nodes.values()], links };
}

/** A per-park graph node carries `nav` (for click routing) + `label` alongside the NVL fields. */
export type ParkGraphNode = NvlNode & { label: string; nav: ParkNodeNav };
export interface ParkGraphData {
  nodes: ParkGraphNode[];
  relationships: NvlRel[];
}

/**
 * One-hop graph neighborhood of a park (§NVL): the center :Park plus its directly-connected
 * Activity/Topic/State (out) and Campground/VisitorCenter/ThingToDo/active-Alert (in) nodes, NVL-shaped
 * and color-coded by label. With `includeRelated`, also appends the top similar parks as clickable
 * nodes via a synthetic SIMILAR edge (technically 2 hops, but the navigable payoff users expect).
 */
export async function parkGraph(
  parkCode: string,
  opts: { parkName?: string; includeRelated?: boolean } = {},
): Promise<ParkGraphData> {
  const { parkName, includeRelated = true } = opts;
  const rows = await readGraph<{
    label: string;
    caption: string | null;
    natId: string | null;
    parkCode: string | null;
    stateCode: string | null;
    name: string | null;
    relType: string;
    dir: 'out' | 'in';
  }>(
    `
    MATCH (p:Park {parkCode: $parkCode})
    CALL {
      WITH p MATCH (p)-[r:OFFERS|HAS_TOPIC|LOCATED_IN]->(nb) RETURN nb, type(r) AS relType, 'out' AS dir
      UNION
      WITH p MATCH (nb)-[r:IN_PARK|AT_PARK|AFFECTS]->(p)
        WHERE (NOT nb:Alert) OR nb.active = true
        RETURN nb, type(r) AS relType, 'in' AS dir
    }
    RETURN head(labels(nb)) AS label,
           coalesce(nb.fullName, nb.name, nb.title) AS caption,
           coalesce(nb.parkCode, nb.id, nb.code, nb.name) AS natId,
           nb.parkCode AS parkCode, nb.code AS stateCode, nb.name AS name,
           relType, dir
    `,
    { parkCode },
  );

  const nodes: ParkGraphNode[] = [
    { id: parkCode, caption: parkName ?? parkCode, color: labelColor('Park'), size: 28, label: 'Park', nav: { kind: 'none' } },
  ];
  const seen = new Set([parkCode]);
  const relationships: NvlRel[] = [];

  const navFor = (label: string, r: { parkCode: string | null; stateCode: string | null; name: string | null }): ParkNodeNav => {
    if (label === 'Park' && r.parkCode) return { kind: 'park', parkCode: r.parkCode };
    if (label === 'Activity' && r.name) return { kind: 'activity', name: r.name };
    if (label === 'Topic' && r.name) return { kind: 'topic', name: r.name };
    if (label === 'State' && r.stateCode) return { kind: 'state', code: r.stateCode };
    return { kind: 'none' };
  };

  for (const r of rows) {
    if (!r.label || !r.natId) continue;
    const nid = `${r.label}:${r.natId}`;
    if (!seen.has(nid)) {
      seen.add(nid);
      nodes.push({
        id: nid,
        caption: r.caption ?? r.natId,
        color: labelColor(r.label),
        size: 16,
        label: r.label,
        nav: navFor(r.label, r),
      });
    }
    relationships.push(
      r.dir === 'out'
        ? { id: `${parkCode}->${nid}:${r.relType}`, from: parkCode, to: nid, caption: r.relType }
        : { id: `${nid}->${parkCode}:${r.relType}`, from: nid, to: parkCode, caption: r.relType },
    );
  }

  if (includeRelated) {
    const related = await similarParks(parkCode, 3).catch(() => []);
    for (const rp of related) {
      const nid = `Park:${rp.parkCode}`;
      if (seen.has(nid)) continue;
      seen.add(nid);
      nodes.push({
        id: nid,
        caption: rp.name,
        color: labelColor('Park'),
        size: 20,
        label: 'Park',
        nav: { kind: 'park', parkCode: rp.parkCode },
      });
      relationships.push({ id: `${parkCode}~${nid}:SIMILAR`, from: parkCode, to: nid, caption: 'SIMILAR' });
    }
  }

  return { nodes, relationships };
}

/**
 * Thematic cross-park trail (NPS-expansion P0 #2): the parks connected by a historical Person
 * (`ASSOCIATED_WITH`) or a Topic (`HAS_TOPIC`) — a multi-hop traversal no single park page reveals.
 */
export async function thematicTrail(
  opts: { person?: string; topic?: string },
  limit = 12,
): Promise<(ParkSummary & { via: string })[]> {
  if (opts.person) {
    return readGraph(
      `MATCH (per:Person)-[:ASSOCIATED_WITH]->(p:Park)
       WHERE toLower(per.title) CONTAINS toLower($person)
       RETURN ${PARK_SUMMARY_RETURN}, per.title AS via
       ORDER BY name ASC LIMIT toInteger($limit)`,
      { person: opts.person, limit },
    );
  }
  if (opts.topic) {
    return readGraph(
      `MATCH (t:Topic) WHERE toLower(t.name) = toLower($topic)
       MATCH (p:Park)-[:HAS_TOPIC]->(t)
       RETURN ${PARK_SUMMARY_RETURN}, t.name AS via
       ORDER BY name ASC LIMIT toInteger($limit)`,
      { topic: opts.topic, limit },
    );
  }
  return [];
}

/**
 * Browse-able thematic trails (NPS-expansion P0 #2, `/trails`): historical figures who span ≥2 parks
 * and the topics shared across the most parks — each is a ready-made cross-park traversal.
 */
export async function trailThemes(limit = 24): Promise<{
  people: { title: string; parks: number }[];
  topics: { name: string; parks: number }[];
}> {
  const rows = await readGraph<{
    people: { title: string; parks: number }[];
    topics: { name: string; parks: number }[];
  }>(
    `
    CALL {
      MATCH (per:Person)-[:ASSOCIATED_WITH]->(p:Park)
      WITH per, count(DISTINCT p) AS parks WHERE parks >= 2
      RETURN collect({title: per.title, parks: parks})[..toInteger($limit)] AS people
    }
    CALL {
      MATCH (t:Topic)<-[:HAS_TOPIC]-(p:Park)
      WITH t, count(DISTINCT p) AS parks WHERE parks >= 3
      RETURN collect({name: t.name, parks: parks})[..toInteger($limit)] AS topics
    }
    RETURN people, topics
    `,
    { limit },
  );
  const r = rows[0] ?? { people: [], topics: [] };
  // Cypher collect() doesn't order; sort by spread (most parks first) for the most striking trails.
  return {
    people: [...r.people].sort((a, b) => b.parks - a.parks),
    topics: [...r.topics].sort((a, b) => b.parks - a.parks),
  };
}

/** Historical figures associated with a park (for the park-page "People & stories" section). */
export async function peopleForPark(
  parkCode: string,
  limit = 8,
): Promise<{ id: string; title: string; tags: string[] }[]> {
  return readGraph(
    `MATCH (per:Person)-[:ASSOCIATED_WITH]->(:Park {parkCode:$parkCode})
     RETURN per.id AS id, per.title AS title, coalesce(per.tags, []) AS tags
     ORDER BY title ASC LIMIT toInteger($limit)`,
    { parkCode, limit },
  );
}

/** Official NPS tours anchored in a park (P1 #3) — each is a ready-made ordered itinerary path. */
export async function toursForPark(
  parkCode: string,
  limit = 8,
): Promise<{ id: string; title: string; description: string | null; stops: number }[]> {
  return readGraph(
    `MATCH (tr:Tour)-[:IN_PARK]->(:Park {parkCode: $parkCode})
     OPTIONAL MATCH (tr)-[:HAS_STOP]->(ts:TourStop)
     WITH tr, count(ts) AS stops
     RETURN tr.id AS id, tr.title AS title, tr.description AS description, stops
     ORDER BY stops DESC, title ASC LIMIT toInteger($limit)`,
    { parkCode, limit },
  );
}

/**
 * Active events at a park (NPS-expansion P2 #7), optionally intersected with the user's travel window
 * (`window.start`/`window.end`, ISO dates) — `inWindow` flags those that fall inside it. Events are
 * synced as `(:Event)-[:HELD_AT]->(:Park)` on the fast tier.
 */
export async function eventsForPark(
  parkCode: string,
  window: { start: string | null; end: string | null } = { start: null, end: null },
  limit = 12,
): Promise<
  {
    id: string;
    title: string;
    dateStart: string | null;
    dateEnd: string | null;
    inWindow: boolean;
    category: string | null;
    isFree: boolean | null;
    regRequired: boolean | null;
    types: string[];
  }[]
> {
  return readGraph(
    `MATCH (e:Event)-[:HELD_AT]->(:Park {parkCode: $parkCode})
     WHERE e.active = true
     OPTIONAL MATCH (e)-[:OF_TYPE]->(et:EventType)
     WITH e, collect(DISTINCT et.name) AS types
     RETURN e.id AS id, e.title AS title, e.dateStart AS dateStart, e.dateEnd AS dateEnd,
            e.category AS category, e.isFree AS isFree, e.regRequired AS regRequired, types,
            ($start IS NOT NULL AND $end IS NOT NULL AND e.dateStart IS NOT NULL
             AND e.dateStart <= $end AND coalesce(e.dateEnd, e.dateStart) >= $start) AS inWindow
     ORDER BY inWindow DESC, e.dateStart ASC LIMIT toInteger($limit)`,
    { parkCode, start: window.start, end: window.end, limit },
  );
}

/**
 * F4: parks with an event on a specific date (via materialized OCCURS_ON), optionally filtered to an
 * event type (e.g. "Astronomy" near a new-moon window). One-hop traversal, no RRULE math at query time.
 */
export async function parksWithEventOn(
  isoDate: string,
  eventType: string | null = null,
  limit = 25,
): Promise<{ parkCode: string; name: string; title: string; type: string | null }[]> {
  // Fixed query shape (plan P1-5) — eventType is a parameter, never interpolated into the structure.
  return readGraph(
    `MATCH (e:Event)-[:OCCURS_ON]->(:CalendarDate {date: date($isoDate)})
     WHERE e.active = true AND ($eventType IS NULL OR EXISTS { (e)-[:OF_TYPE]->(:EventType {name: $eventType}) })
     MATCH (e)-[:HELD_AT]->(p:Park)
     OPTIONAL MATCH (e)-[:OF_TYPE]->(et:EventType)
     RETURN p.parkCode AS parkCode, p.fullName AS name, e.title AS title, head(collect(et.name)) AS type
     ORDER BY name ASC LIMIT toInteger($limit)`,
    { isoDate, eventType: eventType ?? null, limit },
  );
}

/**
 * Passport stamps at a park + whether the current user has collected each (NPS-expansion P2 #8). When
 * `userId` is null (anonymous), `collected` is always false. Powers the park-page collection toggle.
 */
export async function stampsForPark(
  parkCode: string,
  userId: string | null,
): Promise<{ id: string; label: string; collected: boolean }[]> {
  return readGraph(
    `MATCH (st:PassportStamp)-[:IN_PARK]->(:Park {parkCode: $parkCode})
     OPTIONAL MATCH (u:User {userId: $userId})-[c:COLLECTED]->(st)
     RETURN st.id AS id, coalesce(st.label, 'Passport stamp') AS label, c IS NOT NULL AS collected
     ORDER BY label ASC`,
    { parkCode, userId: userId ?? '__anon__' },
  );
}

/** POIs at a park (NPS-expansion P3): real place images + audio descriptions for accessibility. */
export async function placesForPark(
  parkCode: string,
  limit = 12,
): Promise<{ id: string; title: string; image: string | null; audioDescription: string | null; isStamp: boolean }[]> {
  return readGraph(
    `MATCH (:Park {parkCode: $parkCode})-[:HAS_PLACE]->(pl:Place)
     RETURN pl.id AS id, pl.title AS title,
            CASE WHEN size(coalesce(pl.images, [])) > 0 THEN pl.images[0] ELSE null END AS image,
            pl.audioDescription AS audioDescription, coalesce(pl.isStamp, false) AS isStamp
     ORDER BY title ASC LIMIT toInteger($limit)`,
    { parkCode, limit },
  );
}

/** Articles about a park (NPS-expansion P3): "learn more" content depth. */
export async function articlesForPark(
  parkCode: string,
  limit = 8,
): Promise<{ id: string; title: string; url: string | null; description: string | null }[]> {
  return readGraph(
    `MATCH (ar:Article)-[:ABOUT]->(:Park {parkCode: $parkCode})
     RETURN ar.id AS id, ar.title AS title, ar.url AS url, ar.description AS description
     ORDER BY title ASC LIMIT toInteger($limit)`,
    { parkCode, limit },
  );
}

/** F8: latest news releases about a park, most recent first (releaseDate returned as ISO via toString). */
export async function newsForPark(
  parkCode: string,
  limit = 5,
): Promise<{ id: string; title: string; abstract: string | null; url: string | null; releaseDate: string | null }[]> {
  return readGraph(
    `MATCH (nr:NewsRelease)-[:ABOUT]->(:Park {parkCode: $parkCode})
     RETURN nr.id AS id, nr.title AS title, nr.abstract AS abstract, nr.url AS url,
            CASE WHEN nr.releaseDate IS NULL THEN null ELSE toString(nr.releaseDate) END AS releaseDate
     ORDER BY nr.releaseDate DESC LIMIT toInteger($limit)`,
    { parkCode, limit },
  );
}

/**
 * F8: full-text article search — now that `Article.body` is populated, the `article_fulltext` index
 * returns meaningful results (it was empty before). Returns the matched article + its parks.
 */
export async function searchArticles(
  query: string,
  limit = 10,
): Promise<{ id: string; title: string; url: string | null; parks: string[]; score: number }[]> {
  return readGraph(
    `CALL db.index.fulltext.queryNodes('article_fulltext', $q) YIELD node AS ar, score
     OPTIONAL MATCH (ar)-[:ABOUT]->(p:Park)
     WITH ar, score, [x IN collect(DISTINCT p.parkCode) WHERE x IS NOT NULL] AS parks
     RETURN ar.id AS id, ar.title AS title, ar.url AS url, parks, score
     ORDER BY score DESC LIMIT toInteger($limit)`,
    { q: query, limit },
  );
}

export interface ParkMedia {
  audio: { id: string; title: string; durationMs: number | null; url: string | null; hasTranscript: boolean }[];
  galleries: { id: string; title: string; assetCount: number | null; url: string | null }[];
  videos: { id: string; title: string; durationMs: number | null; url: string | null }[];
}

/** F6: self-guided audio, galleries, and videos for a park (only populated when SYNC_MULTIMEDIA=1). */
export async function mediaForPark(parkCode: string, limit = 8): Promise<ParkMedia> {
  const rows = await readGraph<ParkMedia>(
    `MATCH (p:Park {parkCode: $parkCode})
     CALL { WITH p OPTIONAL MATCH (a:AudioFile)-[:ABOUT]->(p)
       RETURN collect({id: a.id, title: a.title, durationMs: a.durationMs, url: a.url, hasTranscript: a.transcript IS NOT NULL})[0..toInteger($limit)] AS audio }
     CALL { WITH p OPTIONAL MATCH (g:Gallery)-[:ABOUT]->(p)
       RETURN collect({id: g.id, title: g.title, assetCount: g.assetCount, url: g.url})[0..toInteger($limit)] AS galleries }
     CALL { WITH p OPTIONAL MATCH (v:Video)-[:ABOUT]->(p)
       RETURN collect({id: v.id, title: v.title, durationMs: v.durationMs, url: v.url})[0..toInteger($limit)] AS videos }
     RETURN audio, galleries, videos`,
    { parkCode, limit },
  );
  return rows[0] ?? { audio: [], galleries: [], videos: [] };
}

export interface LessonPlanSummary {
  id: string;
  title: string;
  url: string | null;
  subject: string | null;
  gradeLevel: string | null;
  objective: string | null;
  durationMin: number | null;
  image: string | null;
  topics: string[];
}

/**
 * Lesson plans for a park ("Ranger School" courseware foundation): `(:LessonPlan)-[:ABOUT]->(:Park)` with
 * the essential question, grade band, duration, and topics. The full courseware (modules/lessons/quizzes +
 * the agentic tutor) is designed in docs/RANGER_SCHOOL_DESIGN.md; this is the read foundation.
 */
export async function lessonPlansForPark(parkCode: string, limit = 12): Promise<LessonPlanSummary[]> {
  return readGraph(
    `MATCH (lp:LessonPlan)-[:ABOUT]->(:Park {parkCode: $parkCode})
     OPTIONAL MATCH (lp)-[:RELATES_TO_TOPIC]->(t:Topic)
     WITH lp, collect(DISTINCT t.name) AS topics
     RETURN lp.id AS id, lp.title AS title, lp.url AS url, lp.subject AS subject,
            lp.gradeLevel AS gradeLevel, lp.objective AS objective, lp.durationMin AS durationMin,
            lp.image AS image, [x IN topics WHERE x IS NOT NULL] AS topics
     ORDER BY title ASC LIMIT toInteger($limit)`,
    { parkCode, limit },
  );
}

export interface LessonPlanContext {
  lessonPlan: LessonPlanSummary;
  park: { parkCode: string; fullName: string } | null;
  media: ParkMedia; // F6 audio/galleries/videos ABOUT the lesson's park
  events: Awaited<ReturnType<typeof eventsForPark>>; // F4, with inWindow for field-trip alignment
  openWindow: OpenCheck | null; // F1 feasibility on window.start (null if no date given)
}

/**
 * The "park-grounded lesson" join (Ranger School, docs/RANGER_SCHOOL_DESIGN.md §4): a lesson plan + its
 * anchor park + the park's NPS media (F6), events (F4, optionally intersected with a field-trip window),
 * and open/closed feasibility (F1) — in one struct. Reuses `mediaForPark`/`eventsForPark`/`checkOpen`
 * verbatim (no new data), so it answers "teach this lesson with the park's audio tour, and is the park
 * open for my Oct 1–15 field trip?". Returns null if the lesson plan doesn't exist.
 */
export async function lessonPlanContext(
  lessonPlanId: string,
  window: { start: string | null; end: string | null } = { start: null, end: null },
): Promise<LessonPlanContext | null> {
  const rows = await readGraph<{
    id: string;
    title: string;
    url: string | null;
    subject: string | null;
    gradeLevel: string | null;
    objective: string | null;
    durationMin: number | null;
    image: string | null;
    topics: string[];
    parkCode: string | null;
    parkName: string | null;
  }>(
    `MATCH (lp:LessonPlan {id: $id})
     OPTIONAL MATCH (lp)-[:ABOUT]->(p:Park)
     OPTIONAL MATCH (lp)-[:RELATES_TO_TOPIC]->(t:Topic)
     WITH lp, collect(DISTINCT p)[0] AS park, collect(DISTINCT t.name) AS topics
     RETURN lp.id AS id, lp.title AS title, lp.url AS url, lp.subject AS subject,
            lp.gradeLevel AS gradeLevel, lp.objective AS objective, lp.durationMin AS durationMin,
            lp.image AS image, [x IN topics WHERE x IS NOT NULL] AS topics,
            park.parkCode AS parkCode, park.fullName AS parkName`,
    { id: lessonPlanId },
  );
  if (!rows.length) return null;
  const r = rows[0];
  const lessonPlan: LessonPlanSummary = {
    id: r.id,
    title: r.title,
    url: r.url,
    subject: r.subject,
    gradeLevel: r.gradeLevel,
    objective: r.objective,
    durationMin: r.durationMin,
    image: r.image,
    topics: r.topics,
  };
  if (!r.parkCode) {
    return { lessonPlan, park: null, media: { audio: [], galleries: [], videos: [] }, events: [], openWindow: null };
  }
  // Anchor the lesson on its park and reuse the shipped F6/F4/F1 read layer.
  const [media, events, openWindow] = await Promise.all([
    mediaForPark(r.parkCode),
    eventsForPark(r.parkCode, window),
    window.start ? checkOpen(r.parkCode, window.start) : Promise.resolve(null),
  ]);
  return { lessonPlan, park: { parkCode: r.parkCode, fullName: r.parkName ?? r.parkCode }, media, events, openWindow };
}

/** Parking lots at a park (NPS-expansion P3): arrival logistics + accessibility. */
export async function parkingForPark(
  parkCode: string,
  limit = 12,
): Promise<{ id: string; name: string; wheelchairAccessible: boolean; accessibleSpaces: number | null; hasEvCharging: boolean; hasLiveData: boolean }[]> {
  return readGraph(
    `MATCH (pl:ParkingLot)-[:IN_PARK]->(:Park {parkCode: $parkCode})
     RETURN pl.id AS id, pl.name AS name, coalesce(pl.wheelchairAccessible, false) AS wheelchairAccessible,
            pl.accessibleSpaces AS accessibleSpaces, coalesce(pl.hasEvCharging, false) AS hasEvCharging,
            coalesce(pl.hasLiveData, false) AS hasLiveData
     ORDER BY name ASC LIMIT toInteger($limit)`,
    { parkCode, limit },
  );
}

export interface SemanticHit {
  id: string;
  title: string;
  parks: { parkCode: string; parkName: string }[];
  image: string | null;
  isStamp: boolean;
  tags: string[];
  score: number;
}

/**
 * Semantic search over the NPS-expansion nodes (Place/Person) via their vector index. Returns the
 * matched node + up to 3 related parks (the navigable target — no place/person detail route exists) and
 * card-ready fields (image/stamp flag for places, tags for both). Requires the `place_embedding`/
 * `person_embedding` indexes (migration 004) and embeddings written by `embed-nodes.ts`.
 */
export async function semanticSearch(
  kind: 'place' | 'person',
  query: string,
  limit = 10,
  // Pass a precomputed query vector to embed once and reuse across searches (audit C5: /search embeds
  // the same text for parks + places + people). Omit it and the cached embedding is used.
  vector?: number[],
): Promise<SemanticHit[]> {
  const index = kind === 'place' ? 'place_embedding' : 'person_embedding';
  const rel = kind === 'place' ? 'HAS_PLACE' : 'ASSOCIATED_WITH';
  const v = vector ?? (await embedQuery(query));
  return readGraph(
    `CALL db.index.vector.queryNodes($index, toInteger($k), $vector) YIELD node AS n, score
     OPTIONAL MATCH (n)-[:${rel}]-(p:Park)
     WITH n, score, [x IN collect(DISTINCT {parkCode: p.parkCode, parkName: p.fullName}) WHERE x.parkCode IS NOT NULL][0..3] AS parks
     RETURN n.id AS id, n.title AS title, parks,
            CASE WHEN size(coalesce(n.images, [])) > 0 THEN n.images[0] ELSE null END AS image,
            coalesce(n.isStamp, false) AS isStamp, coalesce(n.tags, []) AS tags, score
     ORDER BY score DESC LIMIT toInteger($limit)`,
    { index, k: limit, vector: v, limit },
  );
}

export interface ArticleHit {
  id: string;
  title: string;
  url: string | null;
  image: string | null;
  parks: { parkCode: string; parkName: string }[];
  score: number;
}

/**
 * F8: semantic search over articles via the `article_embedding` vector index (now populated from the
 * full `Article.body`). Returns the matched article + up to 3 related parks (the navigable target).
 * Empty until the `EMBED_ARTICLES=1` pass runs — degrades to [] gracefully.
 */
export async function semanticArticles(query: string, limit = 8, vector?: number[]): Promise<ArticleHit[]> {
  const v = vector ?? (await embedQuery(query));
  return readGraph(
    `CALL db.index.vector.queryNodes('article_embedding', toInteger($k), $vector) YIELD node AS ar, score
     OPTIONAL MATCH (ar)-[:ABOUT]->(p:Park)
     WITH ar, score, [x IN collect(DISTINCT {parkCode: p.parkCode, parkName: p.fullName}) WHERE x.parkCode IS NOT NULL][0..3] AS parks
     RETURN ar.id AS id, ar.title AS title, ar.url AS url, ar.image AS image, parks, score
     ORDER BY score DESC LIMIT toInteger($limit)`,
    { index: 'article_embedding', k: limit, vector: v, limit },
  );
}

/** "Vibe" search (A4): vector candidates → graph re-rank (ADR-012). */
export async function vibeSearch(
  query: string,
  opts: {
    limit?: number;
    stateCodes?: string[];
    activity?: string;
    topic?: string;
    // Travel constraints (ADR-046): make candidate retrieval respect what the ranger already knows, so
    // the cards it surfaces don't drift from a constrained final itinerary (Friction #2).
    rvMaxLengthFt?: number | null;
    wheelchairAccessible?: boolean;
    requiredAmenities?: string[];
    maxBortle?: number | null;
    // Hard point-proximity (P0.2): when nearLat/nearLng are set, parks must be within radiusMiles of the
    // anchor — a HARD WHERE clause ANDed with the amenity/region filters so a "near X" ask can never
    // return a far-away park (the Yellowstone-for-DC bug). Reuses the point.distance pattern from nearbyParks.
    nearLat?: number | null;
    nearLng?: number | null;
    radiusMiles?: number | null;
    // Soft de-prioritization of monuments/memorials when the user explicitly wants a "national park".
    preferNationalParks?: boolean;
    // Precomputed query vector to embed once and reuse across searches (audit C5). Omit to use the cache.
    vector?: number[];
  } = {},
) {
  const {
    limit = 15,
    stateCodes,
    activity,
    topic,
    rvMaxLengthFt = null,
    wheelchairAccessible = false,
    requiredAmenities = [],
    maxBortle = null,
    nearLat = null,
    nearLng = null,
    radiusMiles = null,
    preferNationalParks = false,
  } = opts;
  const vector = opts.vector ?? (await embedQuery(query));
  // Pull more vector candidates when facets/constraints will prune them, so enough survive the filter
  // (R4 §2.3: intent-aware ranking — semantic candidates narrowed by region/activity/topic + travel
  // constraints, then ranked by score).
  const hasConstraints = rvMaxLengthFt != null || wheelchairAccessible || requiredAmenities.length > 0 || maxBortle != null;
  const hasProximity = nearLat != null && nearLng != null;
  const hasFacets = (stateCodes?.length ?? 0) > 0 || !!activity || !!topic || hasConstraints || hasProximity;
  // A tight proximity ∩ amenity intersection prunes hard from both sides, so over-fetch even more candidates.
  const k = limit * (hasProximity && hasConstraints ? 10 : hasFacets ? 6 : 2);
  // Soft de-prioritization (P0.2): rank National Parks above monuments/memorials when intent is a "national park".
  const order = preferNationalParks
    ? `ORDER BY (CASE WHEN p.designation CONTAINS 'National Park' THEN 0 ELSE 1 END), score DESC`
    : 'ORDER BY score DESC';
  return readGraph<ParkSummary & { score: number }>(
    `CALL db.index.vector.queryNodes('park_embedding', toInteger($k), $vector) YIELD node AS p, score
     WHERE ($stateCodes IS NULL OR EXISTS { (p)-[:LOCATED_IN]->(s:State) WHERE s.code IN $stateCodes })
       AND ($activity IS NULL OR (p)-[:OFFERS]->(:Activity {name:$activity}))
       AND ($topic IS NULL OR (p)-[:HAS_TOPIC]->(:Topic {name:$topic}))
       AND ($rv IS NULL OR EXISTS { (p)<-[:IN_PARK]-(cg:Campground) WHERE cg.rvMaxLengthFt >= $rv })
       AND (NOT $wheelchair OR EXISTS { (p)<-[:IN_PARK]-(cg:Campground) WHERE cg.wheelchairAccessible = true })
       AND ($maxBortle IS NULL OR coalesce(p.bortleScale, 99) <= $maxBortle)
       AND ($nearLng IS NULL OR (p.location IS NOT NULL AND point.distance(p.location, point({latitude:$nearLat, longitude:$nearLng})) < $radiusMeters))
       AND ALL(req IN $required WHERE
             EXISTS { (p)-[:HAS_PLACE]->(:Place)-[:HAS_AMENITY]->(:Amenity {name: req}) }
             OR EXISTS { (p)<-[:IN_PARK]-(:VisitorCenter)-[:HAS_AMENITY]->(:Amenity {name: req}) }
             OR EXISTS { (p)<-[:IN_PARK]-(:Campground)-[:HAS_AMENITY]->(:Amenity {name: req}) })
     RETURN ${PARK_SUMMARY_RETURN}, score ${order} LIMIT toInteger($limit)`,
    {
      vector,
      k,
      limit,
      stateCodes: stateCodes?.length ? stateCodes : null,
      activity: activity ?? null,
      topic: topic ?? null,
      rv: rvMaxLengthFt,
      wheelchair: wheelchairAccessible,
      required: requiredAmenities,
      maxBortle,
      nearLat,
      nearLng,
      radiusMeters: radiusMiles != null ? radiusMiles * 1609.344 : null,
    },
  );
}

export interface LandingStats {
  parks: number;
  darkSky: number;
  activities: number;
  topics: number;
}

/** Headline graph counts for the landing stats band — parks, dark-sky sites, activities, topics. */
export async function landingStats(): Promise<LandingStats> {
  const rows = await readGraph<LandingStats>(
    `CALL { MATCH (p:Park) RETURN count(p) AS parks }
     CALL { MATCH (d:Park) WHERE d.darkSkyCertified = true RETURN count(d) AS darkSky }
     CALL { MATCH (a:Activity) RETURN count(a) AS activities }
     CALL { MATCH (t:Topic) RETURN count(t) AS topics }
     RETURN parks, darkSky, activities, topics`,
    {},
  );
  return rows[0] ?? { parks: 0, darkSky: 0, activities: 0, topics: 0 };
}

export interface CrowdCurve {
  parkCode: string;
  name: string;
  crowdLevel: string | null;
  points: CrowdCurvePoint[];
}

/**
 * A park's normalized crowd curve (Collective Intelligence v2, ADR-053) — the synced monthly visitation
 * scaled to 0–100, for the "when is it least crowded?" seasonality line. Returns null for unknown parks
 * or parks with no visitation data.
 */
export async function crowdCurve(parkCode: string): Promise<CrowdCurve | null> {
  const rows = await readGraph<{ name: string; monthly: number[]; crowdLevel: string | null }>(
    `MATCH (p:Park {parkCode:$parkCode})
     RETURN p.fullName AS name, coalesce(p.monthlyVisits, []) AS monthly, p.crowdLevel AS crowdLevel`,
    { parkCode },
  );
  if (!rows.length) return null;
  const points = normalizeCrowdCurve(rows[0].monthly ?? []);
  if (!points.length) return null;
  return { parkCode, name: rows[0].name, crowdLevel: rows[0].crowdLevel, points };
}
