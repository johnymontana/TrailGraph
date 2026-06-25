import { writeGraph } from '../neo4j';

/**
 * Materialize `(:LessonPlan)-[:CAN_USE_MEDIA]->(:AudioFile|:Video|:Gallery)` — a lesson can use any NPS
 * multimedia (F6) that is `ABOUT` the same park (Ranger School, docs/RANGER_SCHOOL_DESIGN.md §4). A
 * post-sync derivation step like `deriveNear`/`deriveSharedEdges`: it needs the full corpus, so it runs
 * last. Idempotent — rebuild cleanly so media dropped from a later sync don't leave stale edges, then
 * MERGE the current joins. A no-op until BOTH lessonplans and multimedia (`SYNC_MULTIMEDIA=1`) have synced
 * (the MATCH yields nothing otherwise). The edge is a denormalized one-hop shortcut for the tutor tools +
 * offline pack; the `/learn` reader still anchors media on the shared park via `mediaForPark`.
 */
export async function deriveLessonJoins(): Promise<{ edges: number }> {
  await writeGraph(`MATCH (:LessonPlan)-[r:CAN_USE_MEDIA]->() DELETE r`);
  const res = await writeGraph<{ edges: number }>(
    `MATCH (lp:LessonPlan)-[:ABOUT]->(:Park)<-[:ABOUT]-(m)
     WHERE m:AudioFile OR m:Video OR m:Gallery
     WITH DISTINCT lp, m
     MERGE (lp)-[r:CAN_USE_MEDIA]->(m)
     RETURN count(r) AS edges`,
  );
  return { edges: res[0]?.edges ?? 0 };
}
