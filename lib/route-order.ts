import { greatCircleMiles } from './routing';

/**
 * Graph-/geo-aware trip ordering (R2 §P3): greedy nearest-neighbor over stop coordinates, anchored at
 * the first located stop. Pure + deterministic. Stops without coordinates keep their relative order at
 * the end. Returns stop ids in the suggested visit order.
 */
export interface OrderableStop {
  id: string;
  lat: number | null;
  lng: number | null;
}

export function nearestNeighborOrder(stops: OrderableStop[]): string[] {
  const located = stops.filter((s): s is { id: string; lat: number; lng: number } => s.lat != null && s.lng != null);
  const unlocated = stops.filter((s) => s.lat == null || s.lng == null).map((s) => s.id);
  if (located.length <= 2) return [...located.map((s) => s.id), ...unlocated];

  const remaining = [...located];
  const order: string[] = [];
  let current = remaining.shift()!;
  order.push(current.id);
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((s, i) => {
      const d = greatCircleMiles({ latitude: current.lat, longitude: current.lng }, { latitude: s.lat, longitude: s.lng });
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    current = remaining.splice(bestIdx, 1)[0];
    order.push(current.id);
  }
  return [...order, ...unlocated];
}
