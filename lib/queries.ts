import { readGraph } from './neo4j';
import { embed } from './embeddings';
import { labelColor, type ParkNodeNav } from './graph-nvl';
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
}

const PARK_SUMMARY_RETURN = `
  p.parkCode AS parkCode, p.fullName AS name, p.designation AS designation, p.states AS states,
  p.location.latitude AS lat, p.location.longitude AS lng,
  CASE WHEN size(coalesce(p.images, [])) > 0 THEN p.images[0] ELSE null END AS image
`;

/** Faceted + full-text park search (A1, A3) with paging + accurate total (§2.9). */
export async function searchParks(opts: {
  q?: string;
  stateCode?: string;
  activity?: string;
  topic?: string;
  designation?: string;
  darkSky?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ items: ParkSummary[]; total: number }> {
  const { q, stateCode, activity, topic, designation, darkSky, limit = 24, offset = 0 } = opts;
  const where: string[] = [];
  if (stateCode) where.push('(p)-[:LOCATED_IN]->(:State {code:$stateCode})');
  if (activity) where.push('(p)-[:OFFERS]->(:Activity {name:$activity})');
  if (topic) where.push('(p)-[:HAS_TOPIC]->(:Topic {name:$topic})');
  if (designation) where.push('p.designation = $designation');
  if (darkSky) where.push('p.darkSkyCertified = true');
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
    designation: designation ?? null,
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
export async function parkDetail(parkCode: string) {
  const rows = await readGraph<{
    p: Record<string, unknown>;
    lat: number | null;
    lng: number | null;
    activities: string[];
    topics: string[];
    states: { code: string; name: string }[];
    alerts: { id: string; category: string; title: string; url: string | null; description: string }[];
    campgrounds: { id: string; name: string; reservationUrl: string | null }[];
    visitorCenters: { id: string; name: string }[];
    thingsToDo: { id: string; title: string; difficulty: string | null; length: number | null; elevationGain: number | null }[];
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
           RETURN collect(DISTINCT {id: c.id, name: c.name, reservationUrl: c.reservationUrl}) AS campgrounds }
    CALL { WITH p OPTIONAL MATCH (v:VisitorCenter)-[:IN_PARK]->(p) RETURN collect(DISTINCT {id: v.id, name: v.name}) AS visitorCenters }
    CALL { WITH p OPTIONAL MATCH (n:ThingToDo)-[:AT_PARK]->(p) RETURN collect(DISTINCT {id: n.id, title: n.title, difficulty: n.difficulty, length: n.lengthMiles, elevationGain: n.elevationGainFt}) AS thingsToDo }
    RETURN p{.*} AS p, p.location.latitude AS lat, p.location.longitude AS lng,
      activities, topics, states, alerts, campgrounds, visitorCenters, thingsToDo
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
    lat: r.lat,
    lng: r.lng,
    images: parse(p.imagesFull) ?? [],
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
  const rows = await readGraph<{ activities: string[]; topics: string[]; designations: string[]; states: { code: string; name: string }[] }>(
    `
    CALL { MATCH (a:Activity) RETURN collect(DISTINCT a.name) AS activities }
    CALL { MATCH (t:Topic) RETURN collect(DISTINCT t.name) AS topics }
    CALL { MATCH (p:Park) WHERE p.designation <> '' RETURN collect(DISTINCT p.designation) AS designations }
    CALL { MATCH (s:State) RETURN collect(DISTINCT {code: s.code, name: s.name}) AS states }
    RETURN activities, topics, designations, states
    `,
  );
  return rows[0] ?? { activities: [], topics: [], designations: [], states: [] };
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

/** "Vibe" search (A4): vector candidates → graph re-rank (ADR-012). */
export async function vibeSearch(
  query: string,
  opts: { limit?: number; stateCodes?: string[]; activity?: string; topic?: string } = {},
) {
  const { limit = 15, stateCodes, activity, topic } = opts;
  const [vector] = await embed([query]);
  // Pull more vector candidates when facets will prune them, so enough survive the filter (R4 §2.3:
  // intent-aware ranking — semantic candidates narrowed by region/activity/topic, then ranked by score).
  const hasFacets = (stateCodes?.length ?? 0) > 0 || !!activity || !!topic;
  return readGraph<ParkSummary & { score: number }>(
    `CALL db.index.vector.queryNodes('park_embedding', toInteger($k), $vector) YIELD node AS p, score
     WHERE ($stateCodes IS NULL OR EXISTS { (p)-[:LOCATED_IN]->(s:State) WHERE s.code IN $stateCodes })
       AND ($activity IS NULL OR (p)-[:OFFERS]->(:Activity {name:$activity}))
       AND ($topic IS NULL OR (p)-[:HAS_TOPIC]->(:Topic {name:$topic}))
     RETURN ${PARK_SUMMARY_RETURN}, score ORDER BY score DESC LIMIT toInteger($limit)`,
    {
      vector,
      k: limit * (hasFacets ? 6 : 2),
      limit,
      stateCodes: stateCodes?.length ? stateCodes : null,
      activity: activity ?? null,
      topic: topic ?? null,
    },
  );
}
