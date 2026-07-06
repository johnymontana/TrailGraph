import '../server-guard';
import type { FeatureCollection } from 'geojson';
import { readGraph, writeGraph } from '../neo4j';
import { env } from '../env';
import { readParkTrails, putParkTrails } from '../blob-trails';
import {
  resamplePolyline,
  computeProfile,
  metersToFeet,
  type ElevationSampler,
  type ElevationPoint,
} from '../datasources/elevation';
import { gradeTrail } from './trail-difficulty';
import { makeHeartbeat } from './heartbeat';

/**
 * derive-trail-elevation (ADR-068/069). Reads each park's trail geometry from Blob, resamples the polyline,
 * samples elevations via the adapter, then computes a profile (gain/loss/min/max) AND grades the trail
 * (Shenandoah difficulty + Naismith est-time, which need the derived gain). Writes the scalars to the
 * `:Trail` node and folds the downsampled profile + difficulty back into the Blob Feature props.
 *
 * Per-segment sampling: a `:Trail` is a named-aggregate whose MultiLineString holds unordered, possibly
 * disjoint GIS segments — so we resample + profile EACH LineString independently and sum gain/loss; we
 * never resample across the gap between two segments (that would invent off-trail elevation). Re-runs skip
 * already-graded features (so a crashed national crawl resumes + doesn't re-spend the API), and a global
 * sample budget (`TRAIL_ELEV_MAX_SAMPLES`) caps cost. The sampler is DEM-primary by design (ADR-068), but
 * server-side terrain-RGB decode needs a raster decoder we don't yet vendor — so this ships the batch
 * elevation-API sampler (`ELEVATION_API_URL`, opentopodata-compatible). No sampler → clean no-op.
 * Gated by `SYNC_TRAIL_ELEVATION=1`.
 */

/**
 * Raised when the batch elevation API answers HTTP 429 (quota / rate exhausted). The derive step catches
 * this to STOP the crawl cleanly — re-running later resumes (already-graded trails are skipped) — instead
 * of spending the rest of the run on dead calls or grading a trail on a truncated, half-sampled profile.
 */
export class ElevationRateLimitError extends Error {
  constructor(message = 'elevation API rate-limited (HTTP 429)') {
    super(message);
    this.name = 'ElevationRateLimitError';
  }
}

/**
 * Inter-call throttle in ms (`TRAIL_ELEV_THROTTLE_MS`). Default 1100 (~the public ~1 req/s limit); set `0`
 * for full speed against a self-hosted opentopodata with no rate limit. An explicit `0` is honored; an
 * empty/garbage/negative value falls back to the default.
 */
export function parseThrottleMs(raw: string | undefined): number {
  if (raw == null || raw === '') return 1100;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1100;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Batch elevation-API sampler (opentopodata-compatible: `?locations=lat,lng|…`, parses `results[].elevation`).
 * Batches 100 points/call (the public per-call cap) and throttles `throttleMs` between calls. A 429 THROWS
 * `ElevationRateLimitError` (caller stops + resumes later); any other failure degrades that batch to nulls
 * (treated as no-data, like an out-of-coverage pixel). Exported for unit testing.
 */
export function createApiSampler(apiUrl: string, throttleMs: number): ElevationSampler {
  return async (points) => {
    const out: (number | null)[] = [];
    const BATCH = 100;
    for (let i = 0; i < points.length; i += BATCH) {
      const slice = points.slice(i, i + BATCH);
      let res: Response;
      try {
        const url = new URL(apiUrl);
        url.searchParams.set('locations', slice.map((p) => `${p.lat},${p.lng}`).join('|'));
        res = await fetch(url.toString());
      } catch {
        out.push(...slice.map(() => null)); // network error → no data for this batch
        if (throttleMs > 0) await sleep(throttleMs);
        continue;
      }
      // Quota/rate exhausted: abort the whole crawl rather than waste the rest of the run on dead calls.
      if (res.status === 429) throw new ElevationRateLimitError();
      if (!res.ok) {
        out.push(...slice.map(() => null));
      } else {
        const json = (await res.json()) as { results?: { elevation: number | null }[] };
        const results = json.results ?? [];
        out.push(...slice.map((_, k) => results[k]?.elevation ?? null));
      }
      if (throttleMs > 0) await sleep(throttleMs);
    }
    return out;
  };
}

function makeSampler(): ElevationSampler | null {
  const apiUrl = env.trails.elevationApiUrl;
  if (apiUrl) return createApiSampler(apiUrl, parseThrottleMs(process.env.TRAIL_ELEV_THROTTLE_MS));
  // DEM terrain-RGB tile sampling (DEM-primary, ADR-068) is scaffolded — it needs a server-side raster
  // decoder. Until then, set ELEVATION_API_URL to enable elevation derivation; the pure profile core +
  // decodeElevationM in lib/datasources/elevation.ts are ready for the tile sampler to plug into.
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function deriveTrailElevation(): Promise<Record<string, number>> {
  const sampler = makeSampler();
  if (!sampler) return { skipped: 1 };
  const spacing = Number(process.env.TRAIL_ELEV_SPACING_M) || 30;
  const maxSamples = Number(process.env.TRAIL_ELEV_MAX_SAMPLES) || Infinity;
  const throttleMs = parseThrottleMs(process.env.TRAIL_ELEV_THROTTLE_MS);

  const parks = await readGraph<{ parkCode: string; url: string | null }>(
    `MATCH (p:Park) WHERE p.trailsGeoUrl IS NOT NULL
     RETURN p.parkCode AS parkCode, p.trailsGeoUrl AS url ORDER BY p.parkCode`,
  );

  let graded = 0;
  let requested = 0;
  let budgetHit = 0;
  let rateLimited = false;
  let noData = 0; // null samples (failed/no-coverage batches degrade to nulls — high counts mean the API is not answering)
  let parkIdx = 0;
  const heartbeat = makeHeartbeat('elevation');
  const startedAt = Date.now();
  heartbeat(
    () =>
      `starting: ${parks.length} parks to scan (spacing ${spacing}m, throttle ${throttleMs}ms, ` +
      `budget ${Number.isFinite(maxSamples) ? `${maxSamples} samples` : 'unlimited'})`,
    true,
  );

  for (const { parkCode, url } of parks) {
    parkIdx += 1;
    if (requested >= maxSamples) {
      budgetHit = 1;
      break;
    }
    const fc = await readParkTrails(parkCode, url);
    if (!fc?.features?.length) continue;
    let changed = false;

    for (const f of fc.features) {
      if (requested >= maxSamples) {
        budgetHit = 1;
        break;
      }
      if (!f.geometry || f.geometry.type !== 'MultiLineString') continue;
      const props = (f.properties ?? {}) as Record<string, unknown>;
      // Re-runs only fill gaps: a feature already carrying elevation is skipped (resume + no re-spend).
      if (process.env.SYNC_FORCE !== '1' && props.elevationGainFt != null) continue;

      let gainFt = 0;
      let lossFt = 0;
      let minFt = Infinity;
      let maxFt = -Infinity;
      let offsetMi = 0;
      const merged: ElevationPoint[] = [];

      try {
        for (const line of f.geometry.coordinates) {
          if (line.length < 2) continue;
          const samplePts = resamplePolyline(line, spacing);
          requested += samplePts.length;
          const elevsM = await sampler(samplePts.map((s) => ({ lng: s.lng, lat: s.lat })));
          for (const m of elevsM) if (m == null) noData += 1;
          heartbeat(() => {
            const rate = Math.round(requested / Math.max((Date.now() - startedAt) / 60_000, 0.01));
            return (
              `park ${parkIdx}/${parks.length} (${parkCode}): ${graded} trails graded, ` +
              `${requested} samples (~${rate}/min${Number.isFinite(maxSamples) ? `, ${Math.round((requested / maxSamples) * 100)}% of budget` : ''})` +
              (noData ? `, ${noData} no-data` : '')
            );
          });
          const seg: ElevationPoint[] = [];
          for (let i = 0; i < samplePts.length; i++) {
            const m = elevsM[i];
            if (m == null) continue;
            seg.push({ distMi: samplePts[i].distMi, elevFt: metersToFeet(m) });
          }
          const lineLenMi = samplePts.length ? samplePts[samplePts.length - 1].distMi : 0;
          if (seg.length >= 2) {
            const p = computeProfile(seg); // per-segment gain/loss — never across the inter-segment gap
            gainFt += p.gainFt;
            lossFt += p.lossFt;
            minFt = Math.min(minFt, p.minFt);
            maxFt = Math.max(maxFt, p.maxFt);
            for (const pt of seg) merged.push({ distMi: round2(pt.distMi + offsetMi), elevFt: pt.elevFt });
          }
          offsetMi += lineLenMi;
        }
      } catch (e) {
        // Quota/rate hit mid-trail: do NOT grade this trail on a partial profile (it'd be marked complete
        // and never retried). Stop the crawl here; the next run resumes from this trail.
        if (e instanceof ElevationRateLimitError) {
          rateLimited = true;
          heartbeat(() => `HTTP 429 at park ${parkIdx}/${parks.length} (${parkCode}) — stopping crawl; re-run to resume`, true);
          break;
        }
        throw e;
      }

      if (merged.length < 2) continue;
      const profile = computeProfile(merged).profile; // downsampled charting profile (its gain is ignored)
      const lengthMiles = Number(props.lengthMiles) || offsetMi;
      const grade = gradeTrail({
        lengthMiles,
        elevationGainFt: gainFt,
        elevationLossFt: lossFt,
        trailClass: Number(props.trailClass) || null,
      });
      const id = String(props.id ?? '');

      f.properties = {
        ...props,
        elevationGainFt: gainFt,
        elevationLossFt: lossFt,
        minElevationFt: Math.round(minFt),
        maxElevationFt: Math.round(maxFt),
        difficulty: grade.difficulty,
        difficultyRating: grade.difficultyRating,
        estTimeHrs: grade.estTimeHrs,
        profile,
      };
      changed = true;

      if (id) {
        await writeGraph(
          `MATCH (t:Trail {id: $id})
           SET t.elevationGainFt = $gain, t.elevationLossFt = $loss,
               t.minElevationFt = $min, t.maxElevationFt = $max,
               t.difficulty = $difficulty, t.difficultyRating = $rating, t.estTimeHrs = $est`,
          {
            id,
            gain: gainFt,
            loss: lossFt,
            min: Math.round(minFt),
            max: Math.round(maxFt),
            difficulty: grade.difficulty,
            rating: grade.difficultyRating,
            est: grade.estTimeHrs,
          },
        );
        graded += 1;
      }
    }

    // Persist this park's already-graded features even if we're about to stop (their Blob profiles + graph
    // scalars are complete); the trail that hit the 429 was left ungraded, so it's retried next run.
    if (changed) {
      await putParkTrails(parkCode, fc as FeatureCollection);
      heartbeat(() => `${parkCode} done (park ${parkIdx}/${parks.length}): ${graded} trails graded total`, true);
    }
    if (rateLimited) break;
  }

  if (budgetHit) heartbeat(() => `sample budget (${maxSamples}) reached at park ${parkIdx}/${parks.length} — re-run to resume`, true);
  heartbeat(() => `finished: ${graded} trails graded, ${requested} samples, ${noData} no-data`, true);
  return { graded, requested, budgetHit, rateLimited: rateLimited ? 1 : 0 };
}
