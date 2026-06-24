import { writeGraph } from '../neo4j';

/**
 * Materialize `(:Park)-[:SHARES_TOPIC {count}]->(:Park)` and `SHARES_ACTIVITY` (bonus) — precompute the
 * shared-topic/activity overlap that `graphNeighborhood`/`similarParks` compute at query time, for a
 * denser constellation graph + faster "similar parks". Post-sync derivation; rebuilt each run. The
 * `count` is an integer (toInteger). Edges are undirected-by-convention (written elementId(a) < elementId(b)).
 */
export async function deriveSharedEdges(minTopics = 3, minActivities = 3): Promise<{ topicEdges: number; activityEdges: number }> {
  await writeGraph(`MATCH (:Park)-[r:SHARES_TOPIC|SHARES_ACTIVITY]->(:Park) DELETE r`);
  const t = await writeGraph<{ c: number }>(
    `MATCH (a:Park)-[:HAS_TOPIC]->(x:Topic)<-[:HAS_TOPIC]-(b:Park)
     WHERE elementId(a) < elementId(b)
     WITH a, b, count(DISTINCT x) AS shared
     WHERE shared >= toInteger($minTopics)
     MERGE (a)-[r:SHARES_TOPIC]->(b) SET r.count = shared
     RETURN count(r) AS c`,
    { minTopics },
  );
  const act = await writeGraph<{ c: number }>(
    `MATCH (a:Park)-[:OFFERS]->(x:Activity)<-[:OFFERS]-(b:Park)
     WHERE elementId(a) < elementId(b)
     WITH a, b, count(DISTINCT x) AS shared
     WHERE shared >= toInteger($minActivities)
     MERGE (a)-[r:SHARES_ACTIVITY]->(b) SET r.count = shared
     RETURN count(r) AS c`,
    { minActivities },
  );
  return { topicEdges: t[0]?.c ?? 0, activityEdges: act[0]?.c ?? 0 };
}
