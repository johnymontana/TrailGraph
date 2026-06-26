import type { NodePosition } from './graph-controller';

/**
 * Pure layout helpers for the /graph explorer (feature #1). NVL has no native "radial" or "geographic"
 * layout, so we compute fixed coordinates and push them via `setNodePositions` under the `'free'` layout
 * (positions only stick under `'free'` or with pinned nodes). DOM-free + unit-tested.
 */

// Web-Mercator is undefined at the poles; clamp like every web map does.
const MAX_LAT = 85.05112878;

/** Web-Mercator projection to an abstract NVL coordinate space (north-up: smaller y = further north). */
export function mercatorXY(lat: number, lng: number, scale = 1000): { x: number; y: number } {
  const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const x = (lng + 180) / 360;
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return { x: x * scale, y: y * scale };
}

/** Geographic positions for nodes that carry coordinates; nodes without lat/lng are skipped. */
export function geographicPositions(
  nodes: Array<{ id: string; lat?: number | null; lng?: number | null }>,
  scale = 1000,
): NodePosition[] {
  const out: NodePosition[] = [];
  for (const n of nodes) {
    if (n.lat == null || n.lng == null) continue;
    const { x, y } = mercatorXY(n.lat, n.lng, scale);
    out.push({ id: n.id, x, y });
  }
  return out;
}

/** Evenly spaced ring (a stand-in for the missing native radial layout). */
export function radialPositions(ids: string[], radius = 400): NodePosition[] {
  const n = ids.length;
  return ids.map((id, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, n);
    return { id, x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  });
}
