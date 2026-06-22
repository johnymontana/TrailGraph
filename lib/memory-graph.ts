import { readGraph } from './neo4j';

/**
 * "Your memory" reads (E3). Returns the user's context subgraph from the co-resident Neo4j (AD-1):
 * canonical preferences (PREFERS bridges), considered parks, and planned trips. userId-scoped (R4).
 */
export interface UserMemory {
  preferences: { kind: 'activity' | 'topic'; name: string; category: string | null; value: string | null; feedback: string | null; weight: number | null }[];
  considered: { parkCode: string; name: string }[];
  planned: { tripId: string; name: string }[];
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
  const rows = await readGraph<UserMemory>(
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
    RETURN preferences, considered,
           collect(DISTINCT {tripId: t.id, name: t.name}) AS planned
    `,
    { userId },
  );
  const r = rows[0] ?? { preferences: [], considered: [], planned: [] };
  return {
    preferences: (r.preferences ?? []).filter((p) => p.name),
    considered: (r.considered ?? []).filter((c) => c.parkCode),
    planned: (r.planned ?? []).filter((t) => t.tripId),
  };
}
