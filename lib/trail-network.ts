/**
 * Trail-network adjacency (ADR-072, the Phase-4 loop builder). Pure core: given each trail's endpoint
 * coordinate keys (from `trail-aggregate#endpointKeys` over its Blob geometry), CONNECTS two trails that
 * meet at ≥1 shared junction. Edges are symmetric and deduped (ordered by id, like `derive-shared`). The
 * `junctions` count distinguishes a single touch (a chainable connector) from a two-junction pair, which
 * is what closes a loop. Unit-tested; the graph-writing derive step calls this per park.
 */
export interface TrailEndpoints {
  id: string;
  endpointKeys: string[];
}
export interface TrailConnection {
  from: string;
  to: string;
  junctions: number;
}

export function computeConnections(trails: TrailEndpoints[]): TrailConnection[] {
  const out: TrailConnection[] = [];
  for (let i = 0; i < trails.length; i++) {
    const a = trails[i];
    const aset = new Set(a.endpointKeys);
    if (!aset.size) continue;
    for (let j = i + 1; j < trails.length; j++) {
      const b = trails[j];
      // Count DISTINCT shared junctions (a trail may list the same key twice across its segments).
      const shared = new Set<string>();
      for (const k of b.endpointKeys) if (aset.has(k)) shared.add(k);
      if (shared.size > 0) {
        const [from, to] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
        out.push({ from, to, junctions: shared.size });
      }
    }
  }
  return out;
}
