import { writeGraph } from '../neo4j';

/**
 * Materialize `(:Park)-[:NEAR {miles}]->(:Park)` for the nearest parks within a radius (plan F9). A
 * post-sync derivation step (like embedParks) using the `park_location` point index. Caps degree to keep
 * the edge count bounded; edges are asymmetric (the nearest-N per park, both directions queried outbound).
 *
 * neo4j-v6: `miles` is a FLOAT (round, NOT toInteger); only the LIMIT is an integer.
 */
export async function deriveNear(
  radiusMiles = Number(process.env.NEAR_RADIUS_MILES) || 150,
  capPerPark = Number(process.env.NEAR_CAP_PER_PARK) || 10,
): Promise<{ edges: number }> {
  // Rebuild cleanly so shrinking radius/cap doesn't leave stale edges.
  await writeGraph(`MATCH (:Park)-[r:NEAR]->(:Park) DELETE r`);
  const res = await writeGraph<{ edges: number }>(
    `MATCH (p:Park) WHERE p.location IS NOT NULL
     CALL {
       WITH p
       MATCH (q:Park)
       WHERE q.parkCode <> p.parkCode AND q.location IS NOT NULL
         AND point.distance(p.location, q.location) < $meters
       WITH q, point.distance(p.location, q.location) / 1609.344 AS miles
       ORDER BY miles ASC
       LIMIT toInteger($cap)
       RETURN collect({q: q, miles: miles}) AS nearest
     }
     UNWIND nearest AS n
     MERGE (p)-[r:NEAR]->(n.q)
       SET r.miles = round(n.miles * 10) / 10.0
     RETURN count(r) AS edges`,
    { meters: radiusMiles * 1609.344, cap: capPerPark },
  );
  return { edges: res[0]?.edges ?? 0 };
}
