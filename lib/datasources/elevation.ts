import type { Position } from 'geojson';

/**
 * Elevation adapter (ADR-068). NPS GIS has no elevation, so we DERIVE profiles/gain/loss by sampling a
 * trail polyline against a DEM. This module is the pure, source-agnostic core — DEM-pixel decode, polyline
 * resampling, and profile math (gain/loss/min/max + downsample) — with NO I/O. The graph-writing derive
 * step (`derive-trail-elevation`) plugs in a `ElevationSampler`: terrain-RGB tile decode when
 * `NEXT_PUBLIC_MAP_TERRAIN_URL` is set, else a batch elevation API (`ELEVATION_API_URL`). Both paths funnel
 * elevations through `computeProfile`, so everything downstream is source-agnostic + unit-tested.
 */

export type DemEncoding = 'terrarium' | 'mapbox';

/** Decode a terrain-RGB pixel to meters. Pure. (terrarium ≈ AWS open-data; mapbox = Terrain-RGB v1.) */
export function decodeElevationM(
  r: number,
  g: number,
  b: number,
  encoding: DemEncoding = 'terrarium',
): number {
  return encoding === 'mapbox'
    ? -10000 + (r * 65536 + g * 256 + b) * 0.1
    : r * 256 + g + b / 256 - 32768;
}

export function metersToFeet(m: number): number {
  return m * 3.280839895;
}

const METERS_PER_MILE = 1609.344;

/** Great-circle distance between two [lng,lat] positions, in meters. Pure. */
export function haversineMeters(a: Position, b: Position): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface SamplePoint {
  lng: number;
  lat: number;
  distMi: number;
}

/**
 * Resample a polyline into evenly-spaced points (default 30m) with cumulative distance, so the sampler
 * has a bounded, uniform set of coordinates to look up elevations for. Always includes the final vertex.
 * Pure.
 */
export function resamplePolyline(coords: Position[], spacingMeters = 30): SamplePoint[] {
  if (coords.length === 0) return [];
  if (coords.length === 1) return [{ lng: coords[0][0], lat: coords[0][1], distMi: 0 }];
  const out: SamplePoint[] = [{ lng: coords[0][0], lat: coords[0][1], distMi: 0 }];
  let acc = 0; // cumulative meters to coords[i-1]
  let nextAt = spacingMeters;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const segLen = haversineMeters(a, b);
    if (segLen === 0) continue;
    while (nextAt <= acc + segLen) {
      const t = (nextAt - acc) / segLen;
      out.push({
        lng: a[0] + (b[0] - a[0]) * t,
        lat: a[1] + (b[1] - a[1]) * t,
        distMi: nextAt / METERS_PER_MILE,
      });
      nextAt += spacingMeters;
    }
    acc += segLen;
  }
  const last = coords[coords.length - 1];
  if (out[out.length - 1].distMi < acc / METERS_PER_MILE) {
    out.push({ lng: last[0], lat: last[1], distMi: acc / METERS_PER_MILE });
  }
  return out;
}

export interface ElevationPoint {
  distMi: number;
  elevFt: number;
}

export interface ElevationProfile {
  gainFt: number;
  lossFt: number;
  minFt: number;
  maxFt: number;
  profile: ElevationPoint[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function downsample(samples: ElevationPoint[], target: number): ElevationPoint[] {
  if (samples.length <= target) {
    return samples.map((s) => ({ distMi: round2(s.distMi), elevFt: Math.round(s.elevFt) }));
  }
  const step = (samples.length - 1) / (target - 1);
  const out: ElevationPoint[] = [];
  for (let i = 0; i < target; i++) {
    const s = samples[Math.round(i * step)];
    out.push({ distMi: round2(s.distMi), elevFt: Math.round(s.elevFt) });
  }
  return out;
}

/**
 * Compute gain/loss/min/max + a downsampled profile from sampled `{distMi, elevFt}` points. A
 * `noiseThresholdFt` hysteresis suppresses DEM jitter so cumulative gain isn't inflated by ±1ft pixel
 * noise. Pure.
 */
export function computeProfile(
  samples: ElevationPoint[],
  opts: { noiseThresholdFt?: number; downsampleTo?: number } = {},
): ElevationProfile {
  const noise = opts.noiseThresholdFt ?? 5;
  const target = opts.downsampleTo ?? 64;
  if (samples.length === 0) return { gainFt: 0, lossFt: 0, minFt: 0, maxFt: 0, profile: [] };
  let gain = 0;
  let loss = 0;
  let minFt = Infinity;
  let maxFt = -Infinity;
  let ref = samples[0].elevFt;
  for (const s of samples) {
    if (s.elevFt < minFt) minFt = s.elevFt;
    if (s.elevFt > maxFt) maxFt = s.elevFt;
    const delta = s.elevFt - ref;
    if (Math.abs(delta) >= noise) {
      if (delta > 0) gain += delta;
      else loss += -delta;
      ref = s.elevFt;
    }
  }
  return {
    gainFt: Math.round(gain),
    lossFt: Math.round(loss),
    minFt: Math.round(minFt),
    maxFt: Math.round(maxFt),
    profile: downsample(samples, target),
  };
}

/**
 * Pluggable elevation sampler: a batch of lng/lat → meters (null when unavailable). The derive step
 * provides a terrain-RGB tile sampler or a batch-API sampler; this module stays I/O-free.
 */
export type ElevationSampler = (
  points: { lng: number; lat: number }[],
) => Promise<(number | null)[]>;
