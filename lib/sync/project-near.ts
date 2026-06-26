import { gdsAvailable, projectNear } from '../graph-analytics';

/**
 * Refresh the resident `parks-near` GDS projection (#6) after NEAR edges are rebuilt, so weighted
 * pathfinding (gds.shortestPath.dijkstra) runs against current proximities without projecting per request.
 * No-ops without GDS (guard inside, like the other analytics steps). The path API also ensures the
 * projection on demand (in case a Neo4j restart drops it between syncs).
 */
export async function refreshNearProjection(): Promise<{ projected: number; skipped?: number }> {
  if (!(await gdsAvailable())) return { projected: 0, skipped: 1 };
  await projectNear();
  return { projected: 1 };
}
