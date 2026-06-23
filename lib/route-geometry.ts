/**
 * Pure polyline geometry for the trip-map route-drawing animation (ADR-048/§7.3). Extracted from the
 * client `TripMap` so the clip-by-progress math is unit-testable in the node project (a bad
 * interpolation would silently mis-draw the growing route line).
 */
export type Coord = [number, number];

/**
 * The polyline coordinates clipped to `frac` (0..1) of its total length — used to "grow" the route as
 * the draw animation progresses. `frac<=0` → just the first point; `frac>=1` → the full line. The final
 * point is linearly interpolated within the segment the target length falls in.
 */
export function lineSlice(coords: Coord[], frac: number): Coord[] {
  if (coords.length < 2 || frac >= 1) return coords;
  if (frac <= 0) return [coords[0]];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    seg.push(d);
    total += d;
  }
  const target = total * frac;
  const out: Coord[] = [coords[0]];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = seg[i - 1];
    if (acc + d >= target) {
      const t = d === 0 ? 0 : (target - acc) / d;
      out.push([coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t]);
      break;
    }
    acc += d;
    out.push(coords[i]);
  }
  return out;
}
