import { readGraph } from './neo4j';

/**
 * "Your memory" reads (E3). Returns the user's context subgraph from the co-resident Neo4j (AD-1):
 * canonical preferences (PREFERS bridges), considered parks, and planned trips. userId-scoped (R4).
 */
export interface UserMemory {
  preferences: { kind: 'activity' | 'topic'; name: string; category: string | null; value: string | null; feedback: string | null; weight: number | null }[];
  considered: { parkCode: string; name: string }[];
  planned: { tripId: string; name: string }[];
  travel: { wheelchair: boolean; rvMaxLengthFt: number | null; requiredAmenities: string[] };
  passes: { id: string; name: string }[];
  stamps: { id: string; label: string }[];
  availability: { start: string | null; end: string | null };
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

export async function getUserMemory(userId: string): Promise<UserMemory> {
  const rows = await readGraph<
    Omit<UserMemory, 'travel' | 'availability'> & {
      wheelchair: boolean | null;
      rvMaxLengthFt: number | null;
      requiredAmenities: string[];
      availStart: string | null;
      availEnd: string | null;
    }
  >(
    `
    MATCH (u:User {userId: $userId})
    OPTIONAL MATCH (u)-[pr:PREFERS]->(d)
    WITH u, collect(DISTINCT {
      kind: CASE WHEN d:Activity THEN 'activity' ELSE 'topic' END,
      name: d.name, category: pr.category, value: pr.value, feedback: pr.feedback, weight: pr.weight
    }) AS preferences
    OPTIONAL MATCH (u)-[:CONSIDERED]->(cp:Park)
    WITH u, preferences, collect(DISTINCT {parkCode: cp.parkCode, name: cp.fullName}) AS considered
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
    OPTIONAL MATCH (u)-[av:AVAILABLE]->(:Season)
    RETURN preferences, considered, planned,
           con.wheelchair AS wheelchair, con.rvMaxLengthFt AS rvMaxLengthFt, requiredAmenities, passes, stamps,
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
  };
}
