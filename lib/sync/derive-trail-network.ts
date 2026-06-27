import type { Geometry, Position } from 'geojson';
import { readGraph, writeGraph } from '../neo4j';
import { readParkTrails } from '../blob-trails';
import { endpointKeys } from './trail-aggregate';
import { computeConnections } from '../trail-network';

function linesOf(geom: Geometry | null | undefined): Position[][] {
  if (!geom) return [];
  if (geom.type === 'LineString') return [geom.coordinates as Position[]];
  if (geom.type === 'MultiLineString') return geom.coordinates as Position[][];
  return [];
}

/**
 * Materialize `(:Trail)-[:CONNECTS {junctions}]->(:Trail)` (ADR-072, the Phase-4 loop builder) from shared
 * endpoint junctions, per park. Geometry lives in Blob (ADR-067), so we read each park's FeatureCollection
 * ONCE, extract endpoint keys per trail (`trail-aggregate#endpointKeys`), and `computeConnections` (the pure
 * core). The `junctions` count gates loop-stitching (≥2 ⇒ a closable loop). Slow-tier; degrades to a no-op
 * when a park's geometry isn't synced.
 *
 * Rebuild is SCOPED PER PARK and only AFTER a successful Blob read: a park's stale edges are cleared right
 * before its rebuild, never globally up front. `readParkTrails` returns null on a transient fetch failure
 * just like a genuinely-ungeometried park, so a global delete + skip-on-null would silently wipe a park's
 * loop data on a blip — the scoped delete leaves prior edges intact until the park reads cleanly.
 */
export async function deriveTrailNetwork(): Promise<{ edges: number; parks: number }> {
  const parks = await readGraph<{ parkCode: string; geoUrl: string | null }>(
    `MATCH (t:Trail)-[:IN_PARK]->(p:Park)
     RETURN DISTINCT p.parkCode AS parkCode, p.trailsGeoUrl AS geoUrl`,
  );

  let edges = 0;
  let parksDone = 0;
  for (const { parkCode, geoUrl } of parks) {
    const fc = await readParkTrails(parkCode, geoUrl);
    if (!fc) continue; // transient miss or ungeometried park → leave any prior CONNECTS intact
    // Clear only THIS park's edges, after a clean read, so removed/renamed trails don't leave stale
    // connections (CONNECTS is within-park, so the from-trail's parkCode scopes every edge).
    await writeGraph(`MATCH (a:Trail {parkCode:$parkCode})-[r:CONNECTS]->(:Trail) DELETE r`, { parkCode });
    const trails = fc.features
      .map((f) => ({
        id: (f.properties?.id ?? f.id) as string | undefined,
        endpointKeys: endpointKeys(linesOf(f.geometry as Geometry | null)),
      }))
      .filter((t): t is { id: string; endpointKeys: string[] } => !!t.id);
    const conns = computeConnections(trails);
    parksDone++;
    if (!conns.length) continue;
    const res = await writeGraph<{ c: number }>(
      `UNWIND $conns AS c
       MATCH (a:Trail {id: c.from}), (b:Trail {id: c.to})
       MERGE (a)-[r:CONNECTS]->(b) SET r.junctions = toInteger(c.junctions)
       RETURN count(r) AS c`,
      { conns },
    );
    edges += res[0]?.c ?? 0;
  }
  return { edges, parks: parksDone };
}
