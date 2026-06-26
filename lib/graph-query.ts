import { readGraph } from './neo4j';
import type { SeedNode, SeedLink } from './graph-nvl';
import { NEAR_GRAPH, ensureNearProjection } from './graph-analytics';

/**
 * Pathfinding for the /graph "how are these connected?" feature (#6). Two modes:
 *  - 'topical'  — built-in `shortestPath` over the materialized park-park edges (SHARES_TOPIC /
 *                 SHARES_ACTIVITY / NEAR), capped depth, undirected (SHARES_* stored single-direction,
 *                 NEAR stored directed — `-[...]-` handles both).
 *  - 'driving'  — GDS weighted `gds.shortestPath.dijkstra` over the `parks-near` projection (cost = miles).
 *                 Falls back to the topical path when GDS is unavailable or the parks aren't NEAR-connected.
 * Reused by the chat `how_connected` intent and the on-page Path mode.
 */
export type PathMode = 'topical' | 'driving';
export interface GraphPath {
  narration: string;
  nodes: SeedNode[];
  links: SeedLink[];
  /** Path edge ids in traversal order (for sequential highlight/animation). */
  orderedRelIds: string[];
  hops: number;
  totalMiles: number | null;
  mode: PathMode;
}

interface PathParkRow {
  parkCode: string;
  name: string;
  lat: number | null;
  lng: number | null;
}
const pathNode = (p: PathParkRow): SeedNode => ({ id: p.parkCode, label: 'Park', name: p.name, key: p.parkCode, lat: p.lat, lng: p.lng });
const emptyPath = (narration: string, mode: PathMode): GraphPath => ({ narration, nodes: [], links: [], orderedRelIds: [], hops: 0, totalMiles: null, mode });

function buildPath(parks: PathParkRow[], relCaptions: string[], mode: PathMode, totalMiles: number | null): GraphPath {
  const nodes = parks.map(pathNode);
  const links: SeedLink[] = parks.slice(1).map((p, i) => ({ source: parks[i].parkCode, target: p.parkCode, caption: relCaptions[i] ?? '' }));
  const milesText = totalMiles != null ? `, ~${Math.round(totalMiles)} mi` : '';
  return {
    narration: `${parks[0].name} → ${parks[parks.length - 1].name}: ${links.length} hop${links.length === 1 ? '' : 's'}${milesText} — ${parks.map((p) => p.name).join(' → ')}.`,
    nodes,
    links,
    orderedRelIds: links.map((l) => `${l.source}--${l.target}`),
    hops: links.length,
    totalMiles,
    mode,
  };
}

/** Unweighted shortest path over the materialized park-park edges. */
export async function topicalPath(a: string, b: string): Promise<GraphPath> {
  const rows = await readGraph<{ pathNodes: PathParkRow[]; relTypes: string[] }>(
    `MATCH (a:Park {parkCode: $a}), (b:Park {parkCode: $b}),
       path = shortestPath((a)-[:SHARES_TOPIC|SHARES_ACTIVITY|NEAR*..6]-(b))
     RETURN [n IN nodes(path) | {parkCode: n.parkCode, name: n.fullName, lat: n.location.latitude, lng: n.location.longitude}] AS pathNodes,
            [r IN relationships(path) | type(r)] AS relTypes`,
    { a, b },
  );
  const row = rows[0];
  if (!row?.pathNodes?.length) return emptyPath('No connection found within 6 hops.', 'topical');
  return buildPath(row.pathNodes, row.relTypes, 'topical', null);
}

/** Weighted (by driving-ish NEAR miles) shortest path via GDS Dijkstra; falls back to topical. */
export async function drivingPath(a: string, b: string): Promise<GraphPath> {
  if (!(await ensureNearProjection())) {
    const fb = await topicalPath(a, b);
    return { ...fb, narration: fb.nodes.length ? `(GDS unavailable — topical path) ${fb.narration}` : 'No connection found.' };
  }
  const rows = await readGraph<{ parks: PathParkRow[]; totalCost: number }>(
    `MATCH (a:Park {parkCode: $a}), (b:Park {parkCode: $b})
     CALL gds.shortestPath.dijkstra.stream($g, { sourceNode: a, targetNode: b, relationshipWeightProperty: 'weight' })
     YIELD nodeIds, totalCost
     RETURN [n IN nodeIds | {parkCode: gds.util.asNode(n).parkCode, name: gds.util.asNode(n).fullName,
                             lat: gds.util.asNode(n).location.latitude, lng: gds.util.asNode(n).location.longitude}] AS parks,
            totalCost`,
    { a, b, g: NEAR_GRAPH },
  );
  const row = rows[0];
  if (!row?.parks?.length) {
    const fb = await topicalPath(a, b);
    return { ...fb, narration: fb.nodes.length ? `(No NEAR route — topical path) ${fb.narration}` : 'No driving route found — these parks aren’t connected by nearby parks.' };
  }
  return buildPath(row.parks, row.parks.slice(1).map(() => 'NEAR'), 'driving', row.totalCost);
}

export async function shortestPathBetween(a: string, b: string, mode: PathMode = 'topical'): Promise<GraphPath> {
  if (a === b) return emptyPath('Pick two different parks.', mode);
  return mode === 'driving' ? drivingPath(a, b) : topicalPath(a, b);
}

/**
 * "Trip route" for plan-from-graph (#10c): chain the user's ORDERED selection of parks into one route by
 * connecting each consecutive pair with the shortest NEAR path (`(a)-[:NEAR*..6]-(b)`, undirected — NEAR is
 * stored directed). Pairs that have no nearby route within 6 hops get a single synthetic "direct" edge so the
 * route never breaks. Returns a SeedGraph so it renders through the same result-subgraph override as
 * ask-the-graph / paths / ego. `miles` stay FLOAT (driving distance, never `toInteger`).
 */
export interface TripPath {
  narration: string;
  nodes: SeedNode[];
  links: SeedLink[];
  legs: number;
  totalMiles: number | null;
}
interface TripLegRow {
  leg: number;
  ns: PathParkRow[];
  miles: (number | null)[];
  synthetic: boolean;
}
export async function graphTripPath(parkCodes: string[]): Promise<TripPath> {
  const codes = parkCodes.filter(Boolean);
  if (codes.length < 2) return { narration: 'Pick at least two parks to route a trip.', nodes: [], links: [], legs: 0, totalMiles: null };

  const rows = await readGraph<TripLegRow>(
    `UNWIND range(0, size($codes) - 2) AS i
     MATCH (a:Park {parkCode: $codes[i]}), (b:Park {parkCode: $codes[i + 1]})
     OPTIONAL MATCH path = shortestPath((a)-[:NEAR*..6]-(b))
     RETURN i AS leg,
            CASE WHEN path IS NULL
              THEN [{parkCode: a.parkCode, name: a.fullName, lat: a.location.latitude, lng: a.location.longitude},
                    {parkCode: b.parkCode, name: b.fullName, lat: b.location.latitude, lng: b.location.longitude}]
              ELSE [n IN nodes(path) | {parkCode: n.parkCode, name: n.fullName, lat: n.location.latitude, lng: n.location.longitude}]
            END AS ns,
            CASE WHEN path IS NULL THEN [] ELSE [r IN relationships(path) | r.miles] END AS miles,
            path IS NULL AS synthetic
     ORDER BY leg`,
    { codes },
  );

  const nodeById = new Map<string, SeedNode>();
  const links: SeedLink[] = [];
  const linkSeen = new Set<string>();
  let totalMiles = 0;
  let hasMiles = false;
  for (const leg of rows) {
    for (const p of leg.ns) if (!nodeById.has(p.parkCode)) nodeById.set(p.parkCode, pathNode(p));
    for (let i = 1; i < leg.ns.length; i++) {
      const source = leg.ns[i - 1].parkCode;
      const target = leg.ns[i].parkCode;
      const id = `${source}--${target}`;
      if (linkSeen.has(id)) continue;
      linkSeen.add(id);
      const miles = leg.miles[i - 1];
      if (typeof miles === 'number') {
        totalMiles += miles;
        hasMiles = true;
      }
      links.push({ source, target, caption: leg.synthetic ? 'no nearby route' : typeof miles === 'number' ? `${Math.round(miles)} mi` : 'NEAR' });
    }
  }

  const ordered = codes.map((c) => nodeById.get(c)?.name ?? c);
  const milesText = hasMiles ? `, ~${Math.round(totalMiles)} mi` : '';
  return {
    narration: `Trip route: ${ordered.join(' → ')} — ${nodeById.size} park${nodeById.size === 1 ? '' : 's'} across ${rows.length} leg${rows.length === 1 ? '' : 's'}${milesText}.`,
    nodes: [...nodeById.values()],
    links,
    legs: rows.length,
    totalMiles: hasMiles ? totalMiles : null,
  };
}
