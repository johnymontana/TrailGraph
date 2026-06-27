import { naismithHours } from './sync/trail-difficulty';

/**
 * Loop suggestions (ADR-072, the Phase-4 loop builder) — the graph-over-vector payoff: stitch real trails
 * into hikeable loops with recomputed length / gain / time. Two honest sources, both labeled estimates:
 *  - SINGLE: a trail whose own `routeType` is 'loop'.
 *  - PAIR: two CONNECTED trails sharing ≥2 distinct junctions, so their union closes a loop ("link Bright
 *    Angel + South Kaibab for a rim-to-rim"). Combined length/gain are summed; time via Naismith over the
 *    combined metrics (same estimator the per-trail grade uses). Sorted shortest-first (most accessible).
 * Pure + unit-tested; the ranger tool / trail page read the park's trails + CONNECTS edges and call this.
 */
export interface LoopTrail {
  id: string;
  name: string;
  lengthMiles: number | null;
  elevationGainFt: number | null;
  elevationLossFt?: number | null;
  routeType?: string | null;
  difficulty?: string | null;
}
export interface LoopConnection {
  from: string;
  to: string;
  junctions: number;
}
export interface SuggestedLoop {
  trailIds: string[];
  names: string[];
  kind: 'single' | 'pair';
  lengthMiles: number;
  elevationGainFt: number;
  estTimeHrs: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function suggestLoops(
  trails: LoopTrail[],
  connections: LoopConnection[],
  opts: { limit?: number } = {},
): SuggestedLoop[] {
  const byId = new Map(trails.map((t) => [t.id, t]));
  const loops: SuggestedLoop[] = [];
  const seen = new Set<string>(); // dedupe by the sorted trail-id set

  const push = (l: SuggestedLoop) => {
    const k = [...l.trailIds].sort().join('|');
    if (seen.has(k)) return;
    seen.add(k);
    loops.push(l);
  };

  for (const t of trails) {
    if (t.routeType === 'loop') {
      push({
        trailIds: [t.id],
        names: [t.name],
        kind: 'single',
        lengthMiles: round1(t.lengthMiles ?? 0),
        elevationGainFt: Math.round(t.elevationGainFt ?? 0),
        estTimeHrs: naismithHours(t.lengthMiles ?? 0, t.elevationGainFt ?? 0, t.elevationLossFt ?? 0),
      });
    }
  }

  for (const c of connections) {
    if (c.junctions < 2) continue; // two shared junctions are required to close a loop
    const a = byId.get(c.from);
    const b = byId.get(c.to);
    if (!a || !b) continue;
    const lengthMiles = (a.lengthMiles ?? 0) + (b.lengthMiles ?? 0);
    const gain = (a.elevationGainFt ?? 0) + (b.elevationGainFt ?? 0);
    const loss = (a.elevationLossFt ?? 0) + (b.elevationLossFt ?? 0);
    push({
      trailIds: [a.id, b.id],
      names: [a.name, b.name],
      kind: 'pair',
      lengthMiles: round1(lengthMiles),
      elevationGainFt: Math.round(gain),
      estTimeHrs: naismithHours(lengthMiles, gain, loss),
    });
  }

  loops.sort((x, y) => x.lengthMiles - y.lengthMiles || x.trailIds.join().localeCompare(y.trailIds.join()));
  return opts.limit ? loops.slice(0, opts.limit) : loops;
}
