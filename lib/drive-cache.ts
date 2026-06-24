import { routing, type DriveSegment, type LatLng } from './routing';
import { readGraph, writeGraph } from './neo4j';

/**
 * Shared drive-segment cache (audit C7). recomputeSegments() fires on EVERY trip mutation (add/remove/
 * reorder/fork), and OpenRouteService's free tier is tight (2000/day, 40/min). A coordinate pair that
 * recurs across trips (or across rapid edits) re-hit ORS every time. This caches each consecutive
 * coordinate pair as a global :DriveLeg node (rounded to ~10m), so an identical pair is served from
 * Neo4j with zero ORS calls. Only ORS-sourced legs are cached — the great-circle fallback is never
 * cached, so a leg that degraded once retries ORS next time.
 */

const round = (n: number) => Math.round(n * 1e4) / 1e4; // 4 decimals ≈ 10 m

function legKey(a: LatLng, b: LatLng) {
  return { fromLat: round(a.latitude), fromLng: round(a.longitude), toLat: round(b.latitude), toLng: round(b.longitude) };
}

interface CachedLeg {
  idx: number;
  miles: number | null;
  minutes: number | null;
  source: 'ors' | 'great_circle' | null;
}

export async function cachedDriveSegments(stops: LatLng[]): Promise<DriveSegment[]> {
  if (stops.length < 2) return [];
  const keys: ReturnType<typeof legKey>[] = [];
  for (let i = 0; i < stops.length - 1; i++) keys.push(legKey(stops[i], stops[i + 1]));

  let cached: CachedLeg[] = [];
  try {
    cached = await readGraph<CachedLeg>(
      `UNWIND range(0, size($keys) - 1) AS idx
       WITH idx, $keys[idx] AS k
       OPTIONAL MATCH (l:DriveLeg {fromLat:k.fromLat, fromLng:k.fromLng, toLat:k.toLat, toLng:k.toLng})
       RETURN idx, l.miles AS miles, l.minutes AS minutes, l.source AS source`,
      { keys },
    );
  } catch {
    cached = [];
  }
  const byIdx = new Map(cached.map((c) => [c.idx, c]));
  const allHit = keys.every((_, i) => byIdx.get(i)?.miles != null);

  if (allHit) {
    return keys.map((_, i) => {
      const c = byIdx.get(i)!;
      return { fromIndex: i, toIndex: i + 1, miles: c.miles as number, minutes: c.minutes as number, source: c.source ?? 'ors' };
    });
  }

  // Miss: one ORS round-trip for the whole trip, then persist the ORS-sourced legs.
  const segments = await routing.driveSegments(stops);
  const orsLegs = segments
    .map((s, i) => ({ ...keys[i], miles: s.miles, minutes: s.minutes, source: s.source }))
    .filter((l) => l.source === 'ors');
  if (orsLegs.length) {
    try {
      await writeGraph(
        `UNWIND $legs AS leg
         MERGE (l:DriveLeg {fromLat:leg.fromLat, fromLng:leg.fromLng, toLat:leg.toLat, toLng:leg.toLng})
         SET l.miles = leg.miles, l.minutes = leg.minutes, l.source = leg.source, l.computedAt = timestamp()`,
        { legs: orsLegs },
      );
    } catch {
      /* best-effort cache write; never fail the recompute on it */
    }
  }
  return segments;
}
