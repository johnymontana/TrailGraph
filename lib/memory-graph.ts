import { readGraph } from './neo4j';
import { contextToNvl, type ContextBridge } from './graph-nvl';

/**
 * "Your memory" reads (E3). Returns the user's context subgraph from the co-resident Neo4j (AD-1):
 * canonical preferences (PREFERS bridges), considered parks, and planned trips. userId-scoped (R4).
 */
export interface UserMemory {
  preferences: { kind: 'activity' | 'topic'; name: string; category: string | null; value: string | null; feedback: string | null; weight: number | null }[];
  considered: { parkCode: string; name: string; source: string | null }[];
  planned: { tripId: string; name: string }[];
  travel: { wheelchair: boolean; rvMaxLengthFt: number | null; requiredAmenities: string[] };
  passes: { id: string; name: string }[];
  stamps: { id: string; label: string }[];
  availability: { start: string | null; end: string | null };
  // Trail memory (ADR-071): preferences anchor + saved/wishlisted/done trails.
  trailPreferences: { maxMiles: number | null; maxGainFt: number | null; difficulty: string | null; avoidExposure: boolean; dogsRequired: boolean };
  trailHistory: { saved: { id: string; name: string }[]; wishlisted: { id: string; name: string }[]; done: { id: string; name: string }[] };
  // Camp memory (Campgrounds feature, Phase 3): preferences anchor + saved campgrounds.
  campPreferences: { rig: string | null; maxLengthFt: number | null; hookups: string | null; tentOk: boolean; ada: boolean; pets: boolean; quiet: boolean; budget: number | null };
  campHistory: { saved: { id: string; name: string }[] };
}

/**
 * Bounding box of the parks the user has considered (R4 §4 — memory-driven map defaults). Returns
 * `[[west,south],[east,north]]` for MapLibre `fitBounds`, or null when there's nothing to center on.
 */
export async function consideredBounds(
  userId: string,
): Promise<[[number, number], [number, number]] | null> {
  const rows = await readGraph<{
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
    n: number;
  }>(
    `MATCH (:User {userId:$userId})-[:CONSIDERED]->(p:Park) WHERE p.location IS NOT NULL
     RETURN min(p.location.longitude) AS minLng, min(p.location.latitude) AS minLat,
            max(p.location.longitude) AS maxLng, max(p.location.latitude) AS maxLat, count(p) AS n`,
    { userId },
  );
  const r = rows[0];
  if (!r || !r.n) return null;
  return [
    [r.minLng, r.minLat],
    [r.maxLng, r.maxLat],
  ];
}

/** A located park pin for the "your map" memory overlay (#6). */
export interface MapPin {
  parkCode: string;
  lat: number;
  lng: number;
}

/** Parks the user has CONSIDERED (saved/viewed), as map pins (#6). */
export async function consideredParksGeo(userId: string): Promise<MapPin[]> {
  return readGraph<MapPin>(
    `MATCH (:User {userId:$userId})-[:CONSIDERED]->(p:Park) WHERE p.location IS NOT NULL
     RETURN p.parkCode AS parkCode, p.location.latitude AS lat, p.location.longitude AS lng`,
    { userId },
  );
}

/** Parks where the user has COLLECTED a passport stamp, as map pins (#6). */
export async function collectedStampParksGeo(userId: string): Promise<MapPin[]> {
  return readGraph<MapPin>(
    `MATCH (:User {userId:$userId})-[:COLLECTED]->(:PassportStamp)-[:IN_PARK]->(p:Park) WHERE p.location IS NOT NULL
     RETURN DISTINCT p.parkCode AS parkCode, p.location.latitude AS lat, p.location.longitude AS lng`,
    { userId },
  );
}

export async function getUserMemory(userId: string): Promise<UserMemory> {
  const rows = await readGraph<
    Omit<UserMemory, 'travel' | 'availability' | 'trailPreferences' | 'trailHistory' | 'campPreferences' | 'campHistory'> & {
      wheelchair: boolean | null;
      rvMaxLengthFt: number | null;
      requiredAmenities: string[];
      availStart: string | null;
      availEnd: string | null;
      tpMaxMiles: number | null;
      tpMaxGainFt: number | null;
      tpDifficulty: string | null;
      tpAvoidExposure: boolean;
      tpDogsRequired: boolean;
      trailHistory: { id: string; name: string; kind: string }[];
      cpRig: string | null;
      cpMaxLengthFt: number | null;
      cpHookups: string | null;
      cpTentOk: boolean;
      cpAda: boolean;
      cpPets: boolean;
      cpQuiet: boolean;
      cpBudget: number | null;
      campHistory: { id: string; name: string }[];
    }
  >(
    `
    MATCH (u:User {userId: $userId})
    OPTIONAL MATCH (u)-[pr:PREFERS]->(d)
    WITH u, collect(DISTINCT {
      kind: CASE WHEN d:Activity THEN 'activity' ELSE 'topic' END,
      name: d.name, category: pr.category, value: pr.value, feedback: pr.feedback, weight: pr.weight
    }) AS preferences
    OPTIONAL MATCH (u)-[cr:CONSIDERED]->(cp:Park)
    WITH u, preferences, collect(DISTINCT {parkCode: cp.parkCode, name: cp.fullName, source: cr.source}) AS considered
    OPTIONAL MATCH (u)-[:PLANNED]->(t:Trip)
    WITH u, preferences, considered, collect(DISTINCT {tripId: t.id, name: t.name}) AS planned
    OPTIONAL MATCH (u)-[:TRAVELS_WITH]->(con:Constraint)
    OPTIONAL MATCH (u)-[:REQUIRES]->(ra:Amenity)
    WITH u, preferences, considered, planned, con,
         [x IN collect(DISTINCT ra.name) WHERE x IS NOT NULL] AS requiredAmenities
    OPTIONAL MATCH (u)-[:HOLDS]->(ep:EntrancePass)
    WITH u, preferences, considered, planned, con, requiredAmenities,
         [x IN collect(DISTINCT {id: ep.id, name: ep.name}) WHERE x.id IS NOT NULL] AS passes
    OPTIONAL MATCH (u)-[:COLLECTED]->(ps:PassportStamp)
    WITH u, preferences, considered, planned, con, requiredAmenities, passes,
         [x IN collect(DISTINCT {id: ps.id, label: ps.label}) WHERE x.id IS NOT NULL] AS stamps
    OPTIONAL MATCH (u)-[:PREFERS_TRAIL]->(tp:TrailPrefs)
    WITH u, preferences, considered, planned, con, requiredAmenities, passes, stamps, tp
    OPTIONAL MATCH (u)-[sv:SAVED|WISHLISTED|DID]->(tr:Trail)
    WITH u, preferences, considered, planned, con, requiredAmenities, passes, stamps, tp,
         [x IN collect(DISTINCT CASE WHEN tr IS NULL THEN null ELSE {id: tr.id, name: tr.name, kind: type(sv)} END) WHERE x IS NOT NULL] AS trailHistory
    OPTIONAL MATCH (u)-[:PREFERS_CAMP]->(cpr:CampPrefs)
    WITH u, preferences, considered, planned, con, requiredAmenities, passes, stamps, tp, trailHistory, cpr
    OPTIONAL MATCH (u)-[:SAVED]->(sc:Campground)
    WITH u, preferences, considered, planned, con, requiredAmenities, passes, stamps, tp, trailHistory, cpr,
         [x IN collect(DISTINCT CASE WHEN sc IS NULL THEN null ELSE {id: sc.id, name: sc.name} END) WHERE x IS NOT NULL] AS campHistory
    OPTIONAL MATCH (u)-[av:AVAILABLE]->(:Season)
    RETURN preferences, considered, planned,
           con.wheelchair AS wheelchair, con.rvMaxLengthFt AS rvMaxLengthFt, requiredAmenities, passes, stamps,
           tp.maxMiles AS tpMaxMiles, tp.maxGainFt AS tpMaxGainFt, tp.difficulty AS tpDifficulty,
           coalesce(tp.avoidExposure, false) AS tpAvoidExposure, coalesce(tp.dogsRequired, false) AS tpDogsRequired,
           trailHistory,
           cpr.rig AS cpRig, cpr.maxLengthFt AS cpMaxLengthFt, cpr.hookups AS cpHookups,
           coalesce(cpr.tentOk, false) AS cpTentOk, coalesce(cpr.ada, false) AS cpAda,
           coalesce(cpr.pets, false) AS cpPets, coalesce(cpr.quiet, false) AS cpQuiet, cpr.budget AS cpBudget,
           campHistory,
           av.start AS availStart, av.end AS availEnd
    `,
    { userId },
  );
  const r = rows[0];
  return {
    preferences: (r?.preferences ?? []).filter((p) => p.name),
    considered: (r?.considered ?? []).filter((c) => c.parkCode),
    planned: (r?.planned ?? []).filter((t) => t.tripId),
    travel: {
      wheelchair: r?.wheelchair ?? false,
      rvMaxLengthFt: r?.rvMaxLengthFt ?? null,
      requiredAmenities: r?.requiredAmenities ?? [],
    },
    passes: r?.passes ?? [],
    stamps: r?.stamps ?? [],
    availability: { start: r?.availStart ?? null, end: r?.availEnd ?? null },
    trailPreferences: {
      maxMiles: r?.tpMaxMiles ?? null,
      maxGainFt: r?.tpMaxGainFt ?? null,
      difficulty: r?.tpDifficulty ?? null,
      avoidExposure: r?.tpAvoidExposure ?? false,
      dogsRequired: r?.tpDogsRequired ?? false,
    },
    trailHistory: {
      saved: (r?.trailHistory ?? []).filter((t) => t.kind === 'SAVED').map((t) => ({ id: t.id, name: t.name })),
      wishlisted: (r?.trailHistory ?? []).filter((t) => t.kind === 'WISHLISTED').map((t) => ({ id: t.id, name: t.name })),
      done: (r?.trailHistory ?? []).filter((t) => t.kind === 'DID').map((t) => ({ id: t.id, name: t.name })),
    },
    campPreferences: {
      rig: r?.cpRig ?? null,
      maxLengthFt: r?.cpMaxLengthFt ?? null,
      hookups: r?.cpHookups ?? null,
      tentOk: r?.cpTentOk ?? false,
      ada: r?.cpAda ?? false,
      pets: r?.cpPets ?? false,
      quiet: r?.cpQuiet ?? false,
      budget: r?.cpBudget ?? null,
    },
    campHistory: { saved: r?.campHistory ?? [] },
  };
}

/**
 * The user's context graph as NVL nodes/rels (ADR-047) — `/me` renders it as a living graph and `/graph`
 * overlays it on the domain constellation. Reuses the tested `getUserMemory` read + the pure
 * `contextToNvl` mapper (CONSIDERED parks keyed by bare parkCode so they merge with the domain graph).
 */
export async function userContextGraph(userId: string) {
  return contextToNvl(await getUserMemory(userId));
}

/**
 * "You in the graph" bridges (#8): edges from a user's context nodes (preferences / trips / stamps) to the
 * DOMAIN parks they touch, restricted to parks currently on the constellation (`parkCodes`). Bounded by a
 * per-preference cap AND a global `maxBridges` cap so a power user can't blow past NVL's edge ceiling.
 * Pref edges carry the real relationship type (OFFERS / HAS_TOPIC) as their caption.
 */
export async function userContextBridges(
  userId: string,
  parkCodes: string[],
  opts: { perPrefCap?: number; maxBridges?: number } = {},
): Promise<ContextBridge[]> {
  if (parkCodes.length === 0) return [];
  const { perPrefCap = 40, maxBridges = 300 } = opts;
  const [prefRows, tripRows, stampRows] = await Promise.all([
    readGraph<{ fromKind: 'activity' | 'topic'; fromKey: string; via: string; parkCode: string }>(
      `MATCH (u:User {userId: $userId})-[pr:PREFERS]->(d)
       WHERE (d:Activity OR d:Topic) AND coalesce(pr.weight, 1.0) > 0
       MATCH (p:Park)-[rel:OFFERS|HAS_TOPIC]->(d)
       WHERE p.parkCode IN $parkCodes
       WITH d, pr, type(rel) AS via, p.parkCode AS parkCode,
            (CASE WHEN d:Activity THEN 'activity' ELSE 'topic' END) AS kind
       ORDER BY coalesce(pr.weight, 1.0) DESC
       WITH kind, d.name AS prefName, via, collect(parkCode)[0..toInteger($perPrefCap)] AS parks
       UNWIND parks AS parkCode
       RETURN kind AS fromKind, prefName AS fromKey, via, parkCode`,
      { userId, parkCodes, perPrefCap },
    ),
    readGraph<{ fromKind: 'trip'; fromKey: string; via: string; parkCode: string }>(
      `MATCH (u:User {userId: $userId})-[:PLANNED]->(t:Trip)-[:HAS_STOP]->(:Stop)-[:OF_PARK]->(p:Park)
       WHERE p.parkCode IN $parkCodes
       RETURN 'trip' AS fromKind, t.id AS fromKey, 'INCLUDES' AS via, p.parkCode AS parkCode`,
      { userId, parkCodes },
    ),
    readGraph<{ fromKind: 'stamp'; fromKey: string; via: string; parkCode: string }>(
      `MATCH (u:User {userId: $userId})-[:COLLECTED]->(s:PassportStamp)-[:IN_PARK]->(p:Park)
       WHERE p.parkCode IN $parkCodes
       RETURN 'stamp' AS fromKind, s.id AS fromKey, 'AT' AS via, p.parkCode AS parkCode`,
      { userId, parkCodes },
    ),
  ]);
  return [...prefRows, ...tripRows, ...stampRows].slice(0, maxBridges);
}
