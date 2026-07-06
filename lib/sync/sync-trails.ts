import '../server-guard';
import type { FeatureCollection } from 'geojson';
import { readGraph, writeGraph } from '../neo4j';
import { env } from '../env';
import { contentHash } from '../embeddings';
import { fetchParkTrails } from '../datasources/nps-trails';
import { putParkTrails } from '../blob-trails';
import { aggregateTrails } from './trail-aggregate';
import { upsertTrails } from './upserts';
import { makeHeartbeat } from './heartbeat';

/**
 * sync-trails (ADR-066/067). Per park: fetch NPS GIS centerlines, aggregate into named `:Trail` nodes,
 * persist simplified geometry to Blob, upsert metadata. A per-park content-hash (`:Park.trailsSyncHash`)
 * skips unchanged parks on re-run so a national re-sync is cheap — BUT only if the geometry pointer
 * (`:Park.trailsGeoUrl`) is still present: a null URL (Blob wiped, store migrated, or manually cleared)
 * forces a re-upload even when the hash matches, so the skip can never mask missing Blob geometry. One
 * park's failure is isolated (caught + counted), not fatal. Gated by `SYNC_TRAILS=1` in `runSlowSync`;
 * difficulty/elevation are a later step.
 */
export async function syncTrails(): Promise<Record<string, number>> {
  const parks = await readGraph<{ parkCode: string; hash: string | null; geoUrl: string | null }>(
    `MATCH (p:Park)
     RETURN p.parkCode AS parkCode, p.trailsSyncHash AS hash, p.trailsGeoUrl AS geoUrl
     ORDER BY p.parkCode`,
  );

  let trails = 0;
  let parksWithTrails = 0;
  let parksSkipped = 0;
  let parksErrored = 0;
  let parkIdx = 0;
  const heartbeat = makeHeartbeat('sync-trails');
  heartbeat(() => `starting: ${parks.length} parks to crawl (NPS GIS → :Trail + Blob)`, true);

  for (const { parkCode, hash, geoUrl: existingGeoUrl } of parks) {
    parkIdx += 1;
    heartbeat(
      () =>
        `park ${parkIdx}/${parks.length} (${parkCode}): ${trails} trails upserted, ` +
        `${parksWithTrails} parks synced, ${parksSkipped} unchanged${parksErrored ? `, ${parksErrored} errored` : ''}`,
    );
    try {
      const features = await fetchParkTrails(parkCode);
      if (features.length === 0) continue;

      const aggregated = aggregateTrails(features, {
        parkCode,
        simplifyTolerance: env.trails.simplifyTolerance,
      });
      if (aggregated.length === 0) continue;

      const setHash = contentHash(aggregated.map((t) => t.contentHash).join(','));
      // Skip only when nothing changed AND the geometry is still in Blob — a missing `trailsGeoUrl`
      // re-uploads even on a hash match (the skip must never report "done" with no Blob object).
      if (process.env.SYNC_FORCE !== '1' && setHash === hash && existingGeoUrl) {
        parksSkipped += 1;
        continue;
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
            trailClass: t.trailClass,
            allowedUses: t.allowedUses,
            difficulty: null, // filled by derive-trail-elevation
            dataConfidence: t.dataConfidence,
            source: t.source,
          },
        })),
      };

      const geoUrl = await putParkTrails(parkCode, fc);
      trails += await upsertTrails(parkCode, aggregated, geoUrl);
      await writeGraph(`MATCH (p:Park {parkCode: $pc}) SET p.trailsSyncHash = $h`, {
        pc: parkCode,
        h: setHash,
      });
      parksWithTrails += 1;
    } catch {
      parksErrored += 1;
    }
    await new Promise((r) => setTimeout(r, 80)); // polite between parks
  }

  return { trails, parksWithTrails, parksSkipped, parksErrored };
}
