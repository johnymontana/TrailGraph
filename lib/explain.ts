import { readGraph } from './neo4j';

/**
 * "Why this?" (D4): graph provenance for a recommendation. Traverses the canonical bridge
 * (:User)-[:PREFERS]->(:Activity|:Topic)<-[:OFFERS|HAS_TOPIC]-(:Park) and reports which of the
 * user's preferences connected to the park — including the user's original words (r.value).
 * Grounded in the graph, so the explanation can't hallucinate (R6).
 */
export interface Explanation {
  parkCode: string;
  park: string | null;
  matches: { name: string; yourWords: string | null }[];
}

export async function explainRecommendation(userId: string, parkCode: string): Promise<Explanation> {
  const rows = await readGraph<{ park: string | null; matches: { name: string; yourWords: string | null }[] }>(
    `
    MATCH (p:Park {parkCode: $parkCode})
    OPTIONAL MATCH (u:User {userId: $userId})-[r:PREFERS]->(d)
      WHERE (p)-[:OFFERS]->(d) OR (p)-[:HAS_TOPIC]->(d)
    RETURN p.fullName AS park,
           collect(DISTINCT {name: d.name, yourWords: r.value}) AS matches
    `,
    { userId, parkCode },
  );
  const r = rows[0];
  return {
    parkCode,
    park: r?.park ?? null,
    matches: (r?.matches ?? []).filter((m) => m.name),
  };
}

/**
 * Batched "because you liked …" for many parks at once (§5f) — extends the rationale beyond "For you"
 * to Similar/Nearby on park pages. Returns parkCode → matched preference names (empty if none).
 */
export async function explainForParks(userId: string, parkCodes: string[]): Promise<Record<string, string[]>> {
  if (!parkCodes.length) return {};
  const rows = await readGraph<{ parkCode: string; matched: string[] }>(
    `
    UNWIND $codes AS code
    MATCH (p:Park {parkCode: code})
    OPTIONAL MATCH (u:User {userId: $userId})-[:PREFERS]->(d)
      WHERE (p)-[:OFFERS]->(d) OR (p)-[:HAS_TOPIC]->(d)
    RETURN code AS parkCode, [x IN collect(DISTINCT d.name) WHERE x IS NOT NULL] AS matched
    `,
    { userId, codes: parkCodes },
  );
  return Object.fromEntries(rows.map((r) => [r.parkCode, r.matched]));
}
