import { readGraph } from './neo4j';
import type { ParkSummary } from './queries';

/**
 * "For you" (E2, ADR-015): direct cached cross-graph query, no agent hop. Joins the user's canonical
 * PREFERS edges to domain parks, excludes parks they've already considered or planned (novelty), and
 * falls back to popular parks for cold-start users so the surface is never empty.
 */

export interface Recommendation extends ParkSummary {
  matches: number;
  matched: string[];
  miles?: number;
}

export async function forYou(
  userId: string,
  opts: { limit?: number; homeLat?: number; homeLng?: number } = {},
): Promise<{ source: 'personalized' | 'popular'; parks: Recommendation[] }> {
  const { limit = 12, homeLat, homeLng } = opts;
  const hasHome = homeLat != null && homeLng != null;

  const personalized = await readGraph<Recommendation>(
    `
    MATCH (u:User {userId: $userId})-[pr:PREFERS]->(d)
    WHERE coalesce(pr.weight, 1.0) > 0
    MATCH (p:Park)-[:OFFERS|HAS_TOPIC]->(d)
    WHERE NOT (u)-[:CONSIDERED]->(p)
      AND NOT EXISTS { (u)-[:PLANNED]->(:Trip)-[:HAS_STOP]->(:Stop)-[:OF_PARK]->(p) }
    WITH p, sum(coalesce(pr.weight, 1.0)) AS score, count(DISTINCT d) AS matches, collect(DISTINCT d.name) AS matched
    RETURN p.parkCode AS parkCode, p.fullName AS name, p.designation AS designation, p.states AS states,
           p.location.latitude AS lat, p.location.longitude AS lng,
           CASE WHEN size(coalesce(p.images,[])) > 0 THEN p.images[0] ELSE null END AS image,
           matches, matched,
           CASE WHEN $hasHome AND p.location IS NOT NULL
                THEN point.distance(p.location, point({latitude:$homeLat, longitude:$homeLng}))/1609.344
                ELSE null END AS miles
    ORDER BY score DESC, ${hasHome ? 'miles ASC,' : ''} name ASC
    LIMIT toInteger($limit)
    `,
    { userId, limit, hasHome, homeLat: homeLat ?? null, homeLng: homeLng ?? null },
  );

  if (personalized.length > 0) return { source: 'personalized', parks: personalized };

  // Cold-start fallback: richest National Parks (graceful degradation, §14).
  const popular = await readGraph<Recommendation>(
    `
    MATCH (p:Park) WHERE p.designation CONTAINS 'National Park'
    OPTIONAL MATCH (p)-[:OFFERS]->(a:Activity)
    WITH p, count(a) AS richness
    RETURN p.parkCode AS parkCode, p.fullName AS name, p.designation AS designation, p.states AS states,
           p.location.latitude AS lat, p.location.longitude AS lng,
           CASE WHEN size(coalesce(p.images,[])) > 0 THEN p.images[0] ELSE null END AS image,
           0 AS matches, [] AS matched
    ORDER BY richness DESC, name ASC LIMIT toInteger($limit)
    `,
    { limit },
  );
  return { source: 'popular', parks: popular };
}

/** Map default filters (E2): the user's top preference targets, split by kind. */
export async function mapDefaultFilters(userId: string) {
  const rows = await readGraph<{ activities: string[]; topics: string[] }>(
    `
    MATCH (u:User {userId: $userId})-[r:PREFERS]->(d)
    WITH d, r ORDER BY r.at DESC
    RETURN [x IN collect(d) WHERE x:Activity | x.name][0..6] AS activities,
           [x IN collect(d) WHERE x:Topic | x.name][0..6] AS topics
    `,
    { userId },
  );
  return rows[0] ?? { activities: [], topics: [] };
}
