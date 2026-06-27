import '../server-guard';
import { writeGraph } from '../neo4j';

/**
 * derive-trail-logistics (ADR-072). Link each `:Trail` to the nearest existing logistics nodes by spatial
 * proximity from its `trailheadPoint`: `STARTS_AT` → nearest `:ParkingLot`/`:Place` (within ~1 mi) and
 * `NEAR_SERVICE` → nearest `:Campground`/`:VisitorCenter` (within ~10 mi). We use `NEAR_SERVICE`, not `NEAR`,
 * because F9 reserves `(:Park)-[:NEAR {miles}]->(:Park)` for park proximity — reusing `NEAR` would pollute
 * that namespace (e.g. the unscoped GDS projection guard). No new `:Trailhead` label — we reuse
 * `ParkingLot.accessibleSpaces`/EV for the accessibility-first mode. Rebuilt each run (clean slate), so
 * shrinking a radius never leaves stale edges. A trail with nothing nearby simply gets no edge (honest).
 */
export async function deriveTrailLogistics(
  trailheadRadiusMiles = Number(process.env.TRAIL_TRAILHEAD_RADIUS_MILES) || 1,
  nearRadiusMiles = Number(process.env.TRAIL_NEAR_RADIUS_MILES) || 10,
): Promise<Record<string, number>> {
  await writeGraph(`MATCH (:Trail)-[r:STARTS_AT]->() DELETE r`);
  await writeGraph(`MATCH (:Trail)-[r:NEAR_SERVICE]->() DELETE r`);

  const startsAt = await writeGraph<{ c: number }>(
    `MATCH (t:Trail) WHERE t.trailheadPoint IS NOT NULL
     CALL {
       WITH t
       MATCH (l:ParkingLot) WHERE l.location IS NOT NULL
         AND point.distance(t.trailheadPoint, l.location) < $meters
       RETURN l, point.distance(t.trailheadPoint, l.location) AS d
       UNION
       WITH t
       MATCH (l:Place) WHERE l.location IS NOT NULL
         AND point.distance(t.trailheadPoint, l.location) < $meters
       RETURN l, point.distance(t.trailheadPoint, l.location) AS d
     }
     WITH t, l, d ORDER BY d ASC
     WITH t, collect(l)[0] AS nearest
     WHERE nearest IS NOT NULL
     MERGE (t)-[:STARTS_AT]->(nearest)
     RETURN count(*) AS c`,
    { meters: trailheadRadiusMiles * 1609.344 },
  );

  const near = await writeGraph<{ c: number }>(
    `MATCH (t:Trail) WHERE t.trailheadPoint IS NOT NULL
     CALL {
       WITH t
       MATCH (l:Campground) WHERE l.location IS NOT NULL
         AND point.distance(t.trailheadPoint, l.location) < $meters
       RETURN l, point.distance(t.trailheadPoint, l.location) AS d
       UNION
       WITH t
       MATCH (l:VisitorCenter) WHERE l.location IS NOT NULL
         AND point.distance(t.trailheadPoint, l.location) < $meters
       RETURN l, point.distance(t.trailheadPoint, l.location) AS d
     }
     WITH t, l, d ORDER BY d ASC
     WITH t, collect(l)[0] AS nearest
     WHERE nearest IS NOT NULL
     MERGE (t)-[:NEAR_SERVICE]->(nearest)
     RETURN count(*) AS c`,
    { meters: nearRadiusMiles * 1609.344 },
  );

  return { startsAt: startsAt[0]?.c ?? 0, near: near[0]?.c ?? 0 };
}
