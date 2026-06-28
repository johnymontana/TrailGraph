import { writeGraph } from '../neo4j';

/**
 * Materialize `(:Campground)-[:NEAR {miles}]->(:Park)` and `(:Campground)-[:NEAR_TRAILHEAD {miles}]->(:Trail)`
 * — the cross-boundary unlock: a USFS/BLM campground with no `IN_PARK` edge still answers "campgrounds near
 * Yosemite." Mirrors derive-near.ts (clean rebuild, `point.distance/1609.344`, FLOAT miles via round/10,
 * `LIMIT toInteger`); index-backed by campground_location (001) + park_location (001) + trail_trailhead (025).
 * The NEAR_TRAILHEAD branch no-ops cleanly when trails aren't synced (no trailheadPoint rows).
 */
export async function deriveCampNear(
  parkRadiusMiles = Number(process.env.CAMP_NEAR_PARK_MILES) || 60,
  trailRadiusMiles = Number(process.env.CAMP_NEAR_TRAIL_MILES) || 15,
  capPerCampground = Number(process.env.CAMP_NEAR_CAP) || 8,
): Promise<{ nearPark: number; nearTrailhead: number }> {
  // Rebuild cleanly so a shrinking radius/cap doesn't leave stale edges.
  await writeGraph(`MATCH (:Campground)-[r:NEAR]->(:Park) DELETE r`);
  await writeGraph(`MATCH (:Campground)-[r:NEAR_TRAILHEAD]->(:Trail) DELETE r`);

  const park = await writeGraph<{ edges: number }>(
    `MATCH (c:Campground) WHERE c.location IS NOT NULL
     CALL {
       WITH c
       MATCH (p:Park) WHERE p.location IS NOT NULL
         AND point.distance(c.location, p.location) < $meters
       WITH p, point.distance(c.location, p.location) / 1609.344 AS miles
       ORDER BY miles ASC
       LIMIT toInteger($cap)
       RETURN collect({code: p.parkCode, miles: miles}) AS nearest
     }
     UNWIND nearest AS n
     MATCH (p2:Park {parkCode: n.code})
     MERGE (c)-[r:NEAR]->(p2)
       SET r.miles = round(n.miles * 10) / 10.0
     RETURN count(r) AS edges`,
    { meters: parkRadiusMiles * 1609.344, cap: capPerCampground },
  );

  const trail = await writeGraph<{ edges: number }>(
    `MATCH (c:Campground) WHERE c.location IS NOT NULL
     CALL {
       WITH c
       MATCH (t:Trail) WHERE t.trailheadPoint IS NOT NULL
         AND point.distance(c.location, t.trailheadPoint) < $meters
       WITH t, point.distance(c.location, t.trailheadPoint) / 1609.344 AS miles
       ORDER BY miles ASC
       LIMIT toInteger($cap)
       RETURN collect({id: t.id, miles: miles}) AS nearest
     }
     UNWIND nearest AS n
     MATCH (t2:Trail {id: n.id})
     MERGE (c)-[r:NEAR_TRAILHEAD]->(t2)
       SET r.miles = round(n.miles * 10) / 10.0
     RETURN count(r) AS edges`,
    { meters: trailRadiusMiles * 1609.344, cap: capPerCampground },
  );

  return { nearPark: park[0]?.edges ?? 0, nearTrailhead: trail[0]?.edges ?? 0 };
}
