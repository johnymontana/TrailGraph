import { writeGraph } from '../neo4j';
import { gdsAvailable, projectThemes, dropProjection, THEME_GRAPH } from '../graph-analytics';

/**
 * Materialize emergent park communities (#7): GDS Leiden (Louvain fallback) over `parks-themes`, writing
 * `Park.community` (int), then a `:Community {id, size, topTopics}` node per cluster with
 * `(:Park)-[:IN_COMMUNITY]->(:Community)`. A post-sync derivation, rebuilt each run.
 *
 * `gdsAvailable()` guard INSIDE the fn (replay-stable; no-ops to `{skipped:1}` without GDS). Communities/
 * centrality span ALL parks (derive-shared has no National-Park filter) — a conscious global property; the
 * UI highlights only the constellation's NP members. Determinism: randomSeed + concurrency:1. Projection
 * dropped in `finally`. Cleans stale `:Community`/`IN_COMMUNITY` before rematerializing.
 */
export async function deriveCommunities(): Promise<{ communities: number; named: number; skipped?: number }> {
  if (!(await gdsAvailable())) return { communities: 0, named: 0, skipped: 1 };
  try {
    // Clean previous run (separate statements — one per tx.run).
    await writeGraph('MATCH ()-[r:IN_COMMUNITY]->() DELETE r');
    await writeGraph('MATCH (c:Community) DETACH DELETE c');

    await projectThemes();
    // Leiden is the better community algo but isn't in every GDS edition — fall back to Louvain.
    let count = 0;
    try {
      const r = await writeGraph<{ n: number }>(
        `CALL gds.leiden.write($name, { relationshipWeightProperty: 'weight', writeProperty: 'community', randomSeed: 42, concurrency: 1 })
         YIELD communityCount RETURN communityCount AS n`,
        { name: THEME_GRAPH },
      );
      count = r[0]?.n ?? 0;
    } catch {
      const r = await writeGraph<{ n: number }>(
        `CALL gds.louvain.write($name, { relationshipWeightProperty: 'weight', writeProperty: 'community' })
         YIELD communityCount RETURN communityCount AS n`,
        { name: THEME_GRAPH },
      );
      count = r[0]?.n ?? 0;
    }

    // Materialize :Community nodes labelled by their top shared topics (single valid statement).
    const named = await writeGraph<{ c: number }>(
      `MATCH (p:Park) WHERE p.community IS NOT NULL
       WITH p.community AS cid, collect(p) AS parks, count(*) AS sz
       CALL {
         WITH parks
         UNWIND parks AS pp
         MATCH (pp)-[:HAS_TOPIC]->(t:Topic)
         WITH t.name AS topic, count(*) AS freq ORDER BY freq DESC
         RETURN collect(topic)[0..3] AS topTopics
       }
       MERGE (c:Community {id: cid}) SET c.size = sz, c.topTopics = topTopics
       WITH c, parks UNWIND parks AS p MERGE (p)-[:IN_COMMUNITY]->(c)
       RETURN count(DISTINCT c) AS c`,
      {},
    );
    return { communities: count, named: named[0]?.c ?? 0 };
  } finally {
    await dropProjection(THEME_GRAPH).catch(() => {});
  }
}
