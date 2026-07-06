import { readGraph, writeGraph } from './neo4j';

/**
 * Graph analytics (#7) — read side + GDS projection helpers. Communities (Leiden/Louvain) and centrality
 * (PageRank/betweenness) are materialized onto the graph by the slow-sync derive steps
 * (lib/sync/derive-communities.ts, derive-centrality.ts); `getInsights` just READS the materialized props,
 * so it works (returning empties) even where GDS isn't installed / hasn't been synced yet.
 *
 * GDS lifecycle rule (from lib/neo4j.ts): one statement per `tx.run`, so every `gds.*` call is a separate
 * `writeGraph`/`readGraph` — project/write/drop are WRITE; version/stream are READ. Projections are NAMED
 * + native and dropped in a `finally` by the derive steps.
 */

/** Named native GDS projection over the park theme graph (Park + SHARES_TOPIC/SHARES_ACTIVITY, weighted). */
export const THEME_GRAPH = 'parks-themes';
/** Named native GDS projection over the proximity graph (Park + NEAR, weighted by miles) — for #6 weighted pathfinding. */
export const NEAR_GRAPH = 'parks-near';

/** True when the GDS plugin is installed (gates the derive steps + their integration tests). */
export async function gdsAvailable(): Promise<boolean> {
  try {
    await readGraph('RETURN gds.version() AS v');
    return true;
  } catch {
    return false;
  }
}

/** Drop a named projection if present (idempotent — `false` = don't fail when absent). */
export async function dropProjection(name: string): Promise<void> {
  await writeGraph('CALL gds.graph.drop($name, false) YIELD graphName RETURN graphName', { name });
}

/** (Re)create the `parks-themes` projection: Park nodes + UNDIRECTED SHARES_TOPIC/SHARES_ACTIVITY, weighted by `count`. */
export async function projectThemes(): Promise<void> {
  await dropProjection(THEME_GRAPH); // clean any stale projection first
  await writeGraph(
    `CALL gds.graph.project($name, 'Park', {
       SHARES_TOPIC:    { orientation: 'UNDIRECTED', properties: { weight: { property: 'count', defaultValue: 1.0 } } },
       SHARES_ACTIVITY: { orientation: 'UNDIRECTED', properties: { weight: { property: 'count', defaultValue: 1.0 } } }
     }) YIELD graphName RETURN graphName`,
    { name: THEME_GRAPH },
  );
}

/** (Re)create the `parks-near` projection: Park nodes + UNDIRECTED NEAR, weighted by `miles` (NEAR is stored directed). */
export async function projectNear(): Promise<void> {
  await dropProjection(NEAR_GRAPH);
  await writeGraph(
    `CALL gds.graph.project($name, 'Park', {
       NEAR: { orientation: 'UNDIRECTED', properties: { weight: { property: 'miles', defaultValue: 1.0 } } }
     }) YIELD graphName RETURN graphName`,
    { name: NEAR_GRAPH },
  );
}

/**
 * Ensure the (resident) `parks-near` projection exists for weighted pathfinding — recreates it after a Neo4j
 * restart drops it. Returns false when GDS is unavailable OR when there are no `NEAR` edges yet: a GDS native
 * projection THROWS if the relationship type has zero instances (a fresh / pre-`deriveNear` DB), so we guard it
 * and return false instead so callers (drivingPath) fall back to the topical path rather than erroring.
 */
export async function ensureNearProjection(): Promise<boolean> {
  if (!(await gdsAvailable())) return false;
  const r = await readGraph<{ exists: boolean }>('CALL gds.graph.exists($name) YIELD exists RETURN exists', { name: NEAR_GRAPH });
  if (r[0]?.exists) return true;
  // Park→Park ONLY: the Campgrounds feature also uses NEAR for (:Campground)-[:NEAR]->(:Park), which the
  // Park-scoped native projection excludes — an untyped check here would "succeed" into an EMPTY near graph
  // (no fallback to the topical path) whenever camp edges exist but deriveNear hasn't run.
  const has = await readGraph<{ has: boolean }>('RETURN EXISTS { (:Park)-[:NEAR]->(:Park) } AS has');
  if (!has[0]?.has) return false;
  await projectNear();
  return true;
}

export interface CommunityCard {
  id: number;
  label: string;
  size: number;
  parkCodes: string[];
}
export interface ParkRank {
  parkCode: string;
  name: string;
  score: number;
}
export interface BridgePark {
  parkCode: string;
  name: string;
  bridges: number;
  betweenness: number;
}
export interface Insights {
  communities: CommunityCard[];
  central: ParkRank[];
  bridges: BridgePark[];
}

/**
 * Read the materialized analytics for the Insights panel + the ask-the-graph cluster/central/bridge intents.
 * Communities are labelled by their top shared topics; member lists are the National-Park members (what the
 * constellation can highlight). Empty arrays when analytics haven't been computed.
 */
export async function getInsights(limit = 6): Promise<Insights> {
  const [communities, central, bridges] = await Promise.all([
    readGraph<{ id: number; size: number; topTopics: string[]; parkCodes: string[] }>(
      `MATCH (c:Community)
       OPTIONAL MATCH (p:Park)-[:IN_COMMUNITY]->(c) WHERE p.designation CONTAINS 'National Park'
       WITH c, [x IN collect(p.parkCode) WHERE x IS NOT NULL] AS parkCodes
       WHERE size(parkCodes) > 0
       RETURN c.id AS id, c.size AS size, coalesce(c.topTopics, []) AS topTopics, parkCodes
       ORDER BY size DESC LIMIT toInteger($limit)`,
      { limit },
    ),
    readGraph<ParkRank>(
      `MATCH (p:Park) WHERE p.pagerank IS NOT NULL AND p.designation CONTAINS 'National Park'
       RETURN p.parkCode AS parkCode, p.fullName AS name, p.pagerank AS score
       ORDER BY score DESC LIMIT toInteger($limit)`,
      { limit },
    ),
    readGraph<BridgePark>(
      `MATCH (p:Park)-[:SHARES_TOPIC|SHARES_ACTIVITY|NEAR]-(q:Park)
       WHERE p.community IS NOT NULL AND q.community IS NOT NULL AND q.community <> p.community
         AND p.designation CONTAINS 'National Park'
       WITH p, count(DISTINCT q.community) AS bridges, coalesce(p.betweenness, 0.0) AS bc
       RETURN p.parkCode AS parkCode, p.fullName AS name, bridges, bc AS betweenness
       ORDER BY bridges DESC, bc DESC LIMIT toInteger($limit)`,
      { limit },
    ),
  ]);
  return {
    communities: communities.map((c) => ({
      id: c.id,
      label: (c.topTopics ?? []).slice(0, 3).join(' · ') || `Cluster ${c.id}`,
      size: c.size,
      parkCodes: c.parkCodes,
    })),
    central,
    bridges,
  };
}
