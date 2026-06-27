import '../server-guard';
import type { FeatureCollection } from 'geojson';
import { readGraph, writeGraph } from '../neo4j';
import { env } from '../env';
import { bboxAround, fetchParkTrailsOSM, sacToDifficulty } from '../datasources/osm-trails';
import { parkCodeToUnitCode } from '../datasources/nps-trails';
import { aggregateTrails } from './trail-aggregate';
import { putParkTrails } from '../blob-trails';
import { upsertTrails } from './upserts';

/**
 * enrich-trails-osm (ADR-072, Phase 2). FILL — not merge — OSM trails for parks with NO `:Trail` (NPS-empty),
 * so there's no NPS↔OSM dedup. OSM ways are transformed to NPS-shaped features and run through the SAME
 * `aggregateTrails` pipeline (source='osm'); geometry → Blob, metadata → graph. Once a park is filled it has
 * `:Trail`s, so the `NOT EXISTS` guard excludes it next run (fill-once). **ODbL** attribution is carried via
 * `source='osm'`. Gated `ENRICH_OSM_TRAILS=1`; throttled (Overpass is rate-limited). Best run AFTER sync-trails.
 */
export async function enrichTrailsOSM(): Promise<Record<string, number>> {
  const parks = await readGraph<{ parkCode: string; lat: number | null; lng: number | null }>(
    `MATCH (p:Park)
     WHERE p.location IS NOT NULL AND NOT EXISTS { (:Trail)-[:IN_PARK]->(p) }
     RETURN p.parkCode AS parkCode, p.location.latitude AS lat, p.location.longitude AS lng
     ORDER BY p.parkCode`,
  );

  const delta = Number(process.env.OSM_BBOX_DELTA_DEG) || 0.25;
  let trails = 0;
  let parksFilled = 0;
  let parksErrored = 0;

  for (const { parkCode, lat, lng } of parks) {
    if (lat == null || lng == null) continue;
    try {
      const features = await fetchParkTrailsOSM(bboxAround(lat, lng, delta), parkCodeToUnitCode(parkCode));
      if (features.length === 0) continue;

      const aggregated = aggregateTrails(features, {
        parkCode,
        simplifyTolerance: env.trails.simplifyTolerance,
        source: 'osm',
      });
      if (aggregated.length === 0) continue;

      // OSM gives sac_scale → a difficulty estimate up front (NPS needs the elevation derive for this).
      const sacByTrail = new Map<string, string | null>();
      for (const f of features) {
        const p = f.properties as { TRLNAME?: string; _sacScale?: string | null } | null;
        const d = sacToDifficulty(p?._sacScale);
        if (p?.TRLNAME && d && !sacByTrail.has(p.TRLNAME)) sacByTrail.set(p.TRLNAME, d);
      }

      const fc: FeatureCollection = {
        type: 'FeatureCollection',
        features: aggregated.map((t) => ({
          type: 'Feature',
          geometry: t.geometry,
          properties: {
            id: t.id,
            name: t.name,
            parkCode: t.parkCode,
            lengthMiles: t.lengthMiles,
            routeType: t.routeType,
            difficulty: sacByTrail.get(t.name) ?? null,
            allowedUses: t.allowedUses,
            dataConfidence: t.dataConfidence,
            source: 'osm',
          },
        })),
      };

      const geoUrl = await putParkTrails(parkCode, fc);
      trails += await upsertTrails(parkCode, aggregated, geoUrl);
      // Set the sac-derived difficulty on the graph nodes too (elevation derive may refine it later).
      await writeGraph(
        `UNWIND $rows AS row MATCH (t:Trail {id: row.id}) SET t.difficulty = coalesce(t.difficulty, row.difficulty)`,
        { rows: aggregated.map((t) => ({ id: t.id, difficulty: sacByTrail.get(t.name) ?? null })) },
      );
      parksFilled += 1;
    } catch {
      parksErrored += 1;
    } finally {
      // Throttle EVERY iteration that hit the network — including the no-feature `continue` and error
      // paths — so a rate-limiting (429/504 → []) Overpass instance isn't hammered back-to-back.
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  return { trails, parksFilled, parksErrored };
}
