import { writeGraph } from '../neo4j';

/**
 * Materialize `(:Park)-[:CO_CONSIDERED {users}]->(:Park)` (#4 co-considered lens): how many DISTINCT users
 * have CONSIDERED both parks. Aggregate-only — never stores identities. Enforces a k-anonymity floor
 * (default 5, env CO_CONSIDERED_MIN_USERS, clamped to ≥5) BEFORE writing, so sub-k pairs are never
 * materialized; the lens API clamps again (defense in depth). Mirrors derive-shared (DELETE-then-MERGE,
 * single-direction `elementId(a) < elementId(b)`). Rebuilt each slow sync; sparse/empty until enough users.
 */
export async function deriveCoConsidered(
  minUsers = Number(process.env.CO_CONSIDERED_MIN_USERS) || 5,
): Promise<{ edges: number }> {
  await writeGraph(`MATCH (:Park)-[r:CO_CONSIDERED]->(:Park) DELETE r`);
  const res = await writeGraph<{ edges: number }>(
    `MATCH (u:User)-[:CONSIDERED]->(a:Park), (u)-[:CONSIDERED]->(b:Park)
     WHERE elementId(a) < elementId(b)
     WITH a, b, count(DISTINCT u) AS users
     WHERE users >= toInteger($minUsers)
     MERGE (a)-[r:CO_CONSIDERED]->(b) SET r.users = users
     RETURN count(r) AS edges`,
    { minUsers: Math.max(5, minUsers) },
  );
  return { edges: res[0]?.edges ?? 0 };
}
