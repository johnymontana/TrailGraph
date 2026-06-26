import { writeGraph } from '../neo4j';
import { gdsAvailable, projectThemes, dropProjection, THEME_GRAPH } from '../graph-analytics';

/**
 * Materialize `Park.pagerank` + `Park.betweenness` (#7) via GDS over the `parks-themes` projection
 * (Park + SHARES_TOPIC/SHARES_ACTIVITY). A post-sync derivation, rebuilt each run. Scores are FLOAT.
 *
 * The `gdsAvailable()` guard lives INSIDE this fn (not in the `runSlowSync` `'use workflow'` body) so the
 * step list stays stable for replay — it no-ops cleanly (returns `{skipped:1}`) on a Neo4j without GDS.
 * Each `gds.*` is a separate `writeGraph` (one statement per tx); the projection is dropped in `finally`.
 */
export async function deriveCentrality(): Promise<{ pagerank: number; betweenness: number; skipped?: number }> {
  if (!(await gdsAvailable())) return { pagerank: 0, betweenness: 0, skipped: 1 };
  try {
    await projectThemes();
    const pr = await writeGraph<{ n: number }>(
      `CALL gds.pageRank.write($name, { relationshipWeightProperty: 'weight', writeProperty: 'pagerank', maxIterations: 20, dampingFactor: 0.85 })
       YIELD nodePropertiesWritten RETURN nodePropertiesWritten AS n`,
      { name: THEME_GRAPH },
    );
    const bw = await writeGraph<{ n: number }>(
      `CALL gds.betweenness.write($name, { writeProperty: 'betweenness' })
       YIELD nodePropertiesWritten RETURN nodePropertiesWritten AS n`,
      { name: THEME_GRAPH },
    );
    return { pagerank: pr[0]?.n ?? 0, betweenness: bw[0]?.n ?? 0 };
  } finally {
    await dropProjection(THEME_GRAPH).catch(() => {});
  }
}
