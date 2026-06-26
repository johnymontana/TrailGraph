import type { Map as MlMap } from 'maplibre-gl';

/**
 * Cinematic camera fly-through (#11A): ease a MapLibre camera stop-to-stop, pitched, banking toward each next
 * stop, with a dwell at each. Pairs with the 3D terrain hooks in `lib/mapStyle` (when a DEM is configured the
 * pitched camera reveals relief; unset → a flat, pitched 2D tour). Abortable via an AbortSignal + `map.stop()`,
 * and honors prefers-reduced-motion by jumping (no animation) between stops. The `bearingBetween` math is pure
 * + unit-tested; the orchestration awaits each leg's `moveend` so legs never overlap.
 */
export interface FlyLeg {
  lng: number;
  lat: number;
  label?: string;
}

/** Initial compass bearing (degrees, 0=N) from coordinate a to b. Pure — unit-tested. */
export function bearingBetween(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** Await one camera leg: resolves on the map's next `moveend` (also fired by `map.stop()` on abort). */
function flyLeg(map: MlMap, camera: { center: [number, number]; zoom: number; pitch: number; bearing: number; duration: number }): Promise<void> {
  return new Promise((resolve) => {
    map.once('moveend', () => resolve());
    map.easeTo({ ...camera, essential: true });
  });
}

export interface FlyThroughOpts {
  signal?: AbortSignal;
  pitch?: number;
  zoom?: number;
  reduced?: boolean;
  onLeg?: (index: number, leg: FlyLeg) => void;
}

/**
 * Run the fly-through. Resolves when the tour finishes or the signal aborts (the caller restores the camera).
 * Reduced-motion → flat jumps with a dwell. Otherwise a 2s opening glide then ~3.2s banked legs, dwelling
 * ~0.7s at each stop. Always bails between legs when aborted so a Stop button takes effect immediately.
 */
export async function runFlyThrough(map: MlMap, legs: FlyLeg[], opts: FlyThroughOpts = {}): Promise<void> {
  const located = legs.filter((l) => Number.isFinite(l.lng) && Number.isFinite(l.lat));
  if (located.length === 0) return;
  const pitch = opts.pitch ?? 62;
  const zoom = opts.zoom ?? 9;
  for (let i = 0; i < located.length; i++) {
    if (opts.signal?.aborted) return;
    const leg = located[i];
    opts.onLeg?.(i, leg);
    const bearing = i > 0 ? bearingBetween([located[i - 1].lng, located[i - 1].lat], [leg.lng, leg.lat]) : 0;
    if (opts.reduced) {
      map.jumpTo({ center: [leg.lng, leg.lat], zoom, pitch: 0, bearing: 0 });
      await delay(900, opts.signal);
    } else {
      await flyLeg(map, { center: [leg.lng, leg.lat], zoom, pitch, bearing, duration: i === 0 ? 2000 : 3200 });
      if (opts.signal?.aborted) return;
      await delay(700, opts.signal); // dwell at the stop
    }
  }
}
