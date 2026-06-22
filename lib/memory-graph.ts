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
