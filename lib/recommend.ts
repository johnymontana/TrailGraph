import { readGraph } from './neo4j';
import { PARK_SUMMARY_RETURN, type ParkSummary } from './queries';
import { getTravelConstraints } from './bridges';

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

  // Accessibility/travel constraints filter every recommendation (NPS-expansion P0 #1): keep only parks
  // with an RV-fitting / wheelchair-accessible campground and all required amenities (on a place or VC).
  const cons = await getTravelConstraints(userId);

  const personalized = await readGraph<Recommendation>(
    `
    MATCH (u:User {userId: $userId})-[pr:PREFERS]->(d)
    WHERE coalesce(pr.weight, 1.0) > 0
    MATCH (p:Park)-[:OFFERS|HAS_TOPIC]->(d)
    WHERE NOT (u)-[:CONSIDERED]->(p)
      AND NOT EXISTS { (u)-[:PLANNED]->(:Trip)-[:HAS_STOP]->(:Stop)-[:OF_PARK]->(p) }
      AND ($rv IS NULL OR EXISTS { (p)<-[:IN_PARK]-(cg:Campground) WHERE cg.rvMaxLengthFt >= $rv })
      AND (NOT $wheelchair OR EXISTS { (p)<-[:IN_PARK]-(cg:Campground) WHERE cg.wheelchairAccessible = true })
      AND ALL(req IN $required WHERE
            EXISTS { (p)-[:HAS_PLACE]->(:Place)-[:HAS_AMENITY]->(:Amenity {name: req}) }
            OR EXISTS { (p)<-[:IN_PARK]-(:VisitorCenter)-[:HAS_AMENITY]->(:Amenity {name: req}) })
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
    {
      userId,
      limit,
      hasHome,
      homeLat: homeLat ?? null,
      homeLng: homeLng ?? null,
      rv: cons.rvMaxLengthFt,
      wheelchair: cons.wheelchair,
      required: cons.requiredAmenities,
    },
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

/**
 * Live constraint re-ranking (ADR-046). The structured query a vector store can't do cleanly:
 * "campgrounds that fit a 22-ft RV AND Bortle ≤ 2 AND quiet". Hard filters lift verbatim from `forYou`;
 * the soft score is the user's PREFERS-weight sum (OPTIONAL — cold-start/anon parks still appear at
 * score 0) plus a crowd-tolerance boost over the existing `:Park.crowdLevel`. Unlike `forYou`, this
 * does NOT apply the novelty exclusion (an Explore-ranking concern, not a recommendation one).
 */
export interface RankParams {
  userId?: string | null;
  q?: string;
  stateCode?: string;
  activity?: string;
  topic?: string;
  amenity?: string;
  designation?: string;
  darkSky?: boolean;
  rvMaxLengthFt?: number | null;
  wheelchairAccessible?: boolean;
  requiredAmenities?: string[];
  /** Darker sky = lower Bortle. Keeps only parks with `bortleScale <= maxBortle`. */
  maxBortle?: number | null;
  /** 0..1 — how strongly to boost low-crowd parks (the real "fewer crowds" signal, ADR-045). */
  crowdTolerance?: number | null;
  limit?: number;
  offset?: number;
}

export interface RankedPark extends ParkSummary {
  crowdLevel: string | null;
  bortleScale: number | null;
  score: number;
  matches: number;
  matched: string[];
}

export async function rankParks(params: RankParams): Promise<{ items: RankedPark[]; total: number }> {
  const {
    userId = null,
    q,
    stateCode,
    activity,
    topic,
    amenity,
    designation,
    darkSky = false,
    rvMaxLengthFt = null,
    wheelchairAccessible = false,
    requiredAmenities = [],
    maxBortle = null,
    crowdTolerance = null,
    limit = 24,
    offset = 0,
  } = params;

  // The live "Refine live" panel layers its sliders on TOP of the active /explore facets (ADR-046), so
  // it must apply the SAME filters as searchParks — otherwise it shows parks the faceted search excluded
  // (e.g. a state the user filtered out). q reuses the same full-text index for an identical result set.
  const where: string[] = [];
  if (stateCode) where.push('(p)-[:LOCATED_IN]->(:State {code:$stateCode})');
  if (activity) where.push('(p)-[:OFFERS]->(:Activity {name:$activity})');
  if (topic) where.push('(p)-[:HAS_TOPIC]->(:Topic {name:$topic})');
  if (amenity)
    where.push(
      `(EXISTS { (p)-[:HAS_PLACE]->(:Place)-[:HAS_AMENITY]->(:Amenity {name:$amenity}) }
        OR EXISTS { (vc:VisitorCenter)-[:IN_PARK]->(p) WHERE (vc)-[:HAS_AMENITY]->(:Amenity {name:$amenity}) }
        OR EXISTS { (cg:Campground)-[:IN_PARK]->(p) WHERE (cg)-[:HAS_AMENITY]->(:Amenity {name:$amenity}) })`,
    );
  if (designation) where.push('p.designation = $designation');
  if (darkSky) where.push('p.darkSkyCertified = true');
  where.push('($rv IS NULL OR EXISTS { (p)<-[:IN_PARK]-(cg:Campground) WHERE cg.rvMaxLengthFt >= $rv })');
  where.push('(NOT $wheelchair OR EXISTS { (p)<-[:IN_PARK]-(cg:Campground) WHERE cg.wheelchairAccessible = true })');
  where.push(`ALL(req IN $required WHERE
        EXISTS { (p)-[:HAS_PLACE]->(:Place)-[:HAS_AMENITY]->(:Amenity {name: req}) }
        OR EXISTS { (p)<-[:IN_PARK]-(:VisitorCenter)-[:HAS_AMENITY]->(:Amenity {name: req}) })`);
  where.push('($maxBortle IS NULL OR coalesce(p.bortleScale, 99) <= $maxBortle)');
  const whereClause = 'WHERE ' + where.join('\n      AND ');
  // With a free-text query, draw the candidate set from the same fulltext index searchParks uses (then
  // apply the facet WHERE), so the live panel and the main grid agree on which parks qualify.
  const source = q
    ? `CALL db.index.fulltext.queryNodes('park_fulltext', $q) YIELD node AS p ${whereClause}`
    : `MATCH (p:Park) ${whereClause}`;

  const queryParams = {
    userId,
    q: q ?? null,
    stateCode: stateCode ?? null,
    activity: activity ?? null,
    topic: topic ?? null,
    amenity: amenity ?? null,
    designation: designation ?? null,
    rv: rvMaxLengthFt,
    wheelchair: wheelchairAccessible,
    required: requiredAmenities,
    maxBortle,
    crowdTolerance,
    limit,
    offset,
  };

  const items = await readGraph<RankedPark>(
    `
    ${source}
    OPTIONAL MATCH (u:User {userId:$userId})-[pr:PREFERS]->(d)
      WHERE coalesce(pr.weight, 1.0) > 0 AND ((p)-[:OFFERS]->(d) OR (p)-[:HAS_TOPIC]->(d))
    WITH p, sum(coalesce(pr.weight, 0.0)) AS prefScore, count(DISTINCT d) AS matches, collect(DISTINCT d.name) AS matched
    // crowdTolerance is a SIGNED adjustment, not a boost-only term: quiet parks gain, busy parks are
    // penalized, so raising the slider visibly demotes 'high'/'very high'-crowd parks instead of just
    // nudging the quiet ones up (which prefScore would dominate). Soft — never excludes (ADR-045/046).
    WITH p, matches, matched,
         prefScore + (CASE p.crowdLevel WHEN 'low' THEN 2 WHEN 'moderate' THEN 1 WHEN 'high' THEN -2 WHEN 'very high' THEN -4 ELSE 0 END)
                     * coalesce($crowdTolerance, 0.0) AS score
    RETURN ${PARK_SUMMARY_RETURN}, p.crowdLevel AS crowdLevel, p.bortleScale AS bortleScale, score, matches, matched
    ORDER BY score DESC, p.fullName ASC
    SKIP toInteger($offset) LIMIT toInteger($limit)
    `,
    queryParams,
  );
  const totalRows = await readGraph<{ total: number }>(
    `${source} RETURN count(p) AS total`,
    queryParams,
  );
  return { items, total: totalRows[0]?.total ?? items.length };
}

/** Clamp a numeric input to [lo, hi]; non-numbers/NaN → undefined. Pure (unit-tested). */
export function clampNum(n: unknown, lo: number, hi: number): number | undefined {
  if (typeof n !== 'number' || Number.isNaN(n)) return undefined;
  return Math.min(hi, Math.max(lo, n));
}

export interface RankRequestBody {
  maxBortle?: number;
  minBortle?: number; // alias — lower Bortle = darker; mapped to maxBortle
  crowdTolerance?: number;
  requiredAmenities?: string[];
  rvMaxLengthFt?: number | null;
  wheelchairAccessible?: boolean;
  q?: string;
  stateCode?: string;
  activity?: string;
  topic?: string;
  amenity?: string;
  designation?: string;
  darkSky?: boolean;
  limit?: number;
  offset?: number;
}
export interface SavedConstraints {
  wheelchair: boolean;
  rvMaxLengthFt: number | null;
  requiredAmenities: string[];
}

/**
 * Resolve the live-rerank request body against the user's saved travel constraints into `RankParams`
 * (pure — unit-tested for the merge precedence + clamps that the /api/parks/rank route relies on).
 * Body values OVERRIDE saved constraints when present; `rvMaxLengthFt <= 0` means "off" (null).
 */
export function resolveRankParams(body: RankRequestBody, cons: SavedConstraints, userId: string | null): RankParams {
  const rvRaw = body.rvMaxLengthFt !== undefined ? body.rvMaxLengthFt : cons.rvMaxLengthFt;
  return {
    userId,
    q: body.q || undefined,
    stateCode: body.stateCode,
    activity: body.activity,
    topic: body.topic,
    amenity: body.amenity,
    designation: body.designation,
    darkSky: body.darkSky ?? false,
    rvMaxLengthFt: rvRaw && rvRaw > 0 ? rvRaw : null,
    wheelchairAccessible: body.wheelchairAccessible ?? cons.wheelchair,
    requiredAmenities: body.requiredAmenities ?? cons.requiredAmenities,
    maxBortle: clampNum(body.maxBortle ?? body.minBortle, 1, 9) ?? null,
    crowdTolerance: clampNum(body.crowdTolerance, 0, 1) ?? null,
    limit: clampNum(body.limit, 1, 48) ?? 24,
    offset: clampNum(body.offset, 0, 100_000) ?? 0,
  };
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
