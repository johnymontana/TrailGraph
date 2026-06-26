import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
const ensureNearProjection = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a) }));
vi.mock('./graph-analytics', () => ({
  ensureNearProjection: (...a: unknown[]) => ensureNearProjection(...a),
  NEAR_GRAPH: 'parks-near',
}));

import { topicalPath, drivingPath, shortestPathBetween, graphTripPath } from './graph-query';

beforeEach(() => {
  readGraph.mockReset();
  ensureNearProjection.mockReset();
});

const N = (parkCode: string, name: string) => ({ parkCode, name, lat: 1, lng: 2 });

describe('topicalPath', () => {
  it('builds nodes/links/orderedRelIds from the shortestPath result', async () => {
    readGraph.mockResolvedValueOnce([
      { pathNodes: [N('zion', 'Zion'), N('mid', 'Middle'), N('acad', 'Acadia')], relTypes: ['SHARES_TOPIC', 'NEAR'] },
    ]);
    const p = await topicalPath('zion', 'acad');
    expect(p.nodes.map((n) => n.id)).toEqual(['zion', 'mid', 'acad']);
    expect(p.links).toEqual([
      { source: 'zion', target: 'mid', caption: 'SHARES_TOPIC' },
      { source: 'mid', target: 'acad', caption: 'NEAR' },
    ]);
    expect(p.orderedRelIds).toEqual(['zion--mid', 'mid--acad']);
    expect(p.hops).toBe(2);
    expect(p.mode).toBe('topical');
    expect(p.narration).toContain('2 hops');
  });

  it('returns an empty narrated path when no route exists', async () => {
    readGraph.mockResolvedValueOnce([]);
    const p = await topicalPath('a', 'b');
    expect(p.nodes).toEqual([]);
    expect(p.narration).toMatch(/No connection/i);
  });
});

describe('drivingPath', () => {
  it('falls back to the topical path when GDS is unavailable', async () => {
    ensureNearProjection.mockResolvedValue(false);
    readGraph.mockResolvedValueOnce([{ pathNodes: [N('zion', 'Zion'), N('acad', 'Acadia')], relTypes: ['NEAR'] }]);
    const p = await drivingPath('zion', 'acad');
    expect(p.nodes.map((n) => n.id)).toEqual(['zion', 'acad']);
    expect(p.narration).toMatch(/GDS unavailable/i);
  });

  it('uses the weighted GDS dijkstra result when available (totalMiles + NEAR edges)', async () => {
    ensureNearProjection.mockResolvedValue(true);
    readGraph.mockResolvedValueOnce([{ parks: [N('zion', 'Zion'), N('brca', 'Bryce')], totalCost: 71.5 }]);
    const p = await drivingPath('zion', 'brca');
    expect(p.mode).toBe('driving');
    expect(p.totalMiles).toBe(71.5);
    expect(p.links.map((l) => l.caption)).toEqual(['NEAR']);
    expect(p.narration).toContain('72 mi'); // rounded
  });

  it('falls back to topical when GDS returns no NEAR route', async () => {
    ensureNearProjection.mockResolvedValue(true);
    readGraph
      .mockResolvedValueOnce([]) // dijkstra: no path
      .mockResolvedValueOnce([{ pathNodes: [N('zion', 'Zion'), N('acad', 'Acadia')], relTypes: ['SHARES_TOPIC'] }]); // topical fallback
    const p = await drivingPath('zion', 'acad');
    expect(p.nodes.map((n) => n.id)).toEqual(['zion', 'acad']);
    expect(p.narration).toMatch(/No NEAR route/i);
  });
});

describe('shortestPathBetween', () => {
  it('rejects identical endpoints without a DB call', async () => {
    const p = await shortestPathBetween('zion', 'zion', 'topical');
    expect(p.nodes).toEqual([]);
    expect(p.narration).toMatch(/different/i);
    expect(readGraph).not.toHaveBeenCalled();
  });
});

describe('graphTripPath (#10 — trip route through an ordered selection)', () => {
  it('chains consecutive NEAR legs into one deduped route + sums miles (FLOAT)', async () => {
    // Leg 0: zion → (mid) → brca ; Leg 1: brca → cany. `brca` is the shared endpoint → deduped to one node.
    readGraph.mockResolvedValueOnce([
      { leg: 0, ns: [N('zion', 'Zion'), N('mid', 'Middle'), N('brca', 'Bryce')], miles: [40.2, 30.1], synthetic: false },
      { leg: 1, ns: [N('brca', 'Bryce'), N('cany', 'Canyonlands')], miles: [120.5], synthetic: false },
    ]);
    const t = await graphTripPath(['zion', 'brca', 'cany']);
    expect(t.nodes.map((n) => n.id).sort()).toEqual(['brca', 'cany', 'mid', 'zion']);
    expect(t.links).toEqual([
      { source: 'zion', target: 'mid', caption: '40 mi' },
      { source: 'mid', target: 'brca', caption: '30 mi' },
      { source: 'brca', target: 'cany', caption: '121 mi' },
    ]);
    expect(t.legs).toBe(2);
    expect(t.totalMiles).toBeCloseTo(190.8);
    expect(t.narration).toContain('Zion → Bryce → Canyonlands');
  });

  it('falls back to a synthetic direct edge when a pair has no nearby route', async () => {
    readGraph.mockResolvedValueOnce([
      { leg: 0, ns: [N('yell', 'Yellowstone'), N('acad', 'Acadia')], miles: [], synthetic: true },
    ]);
    const t = await graphTripPath(['yell', 'acad']);
    expect(t.links).toEqual([{ source: 'yell', target: 'acad', caption: 'no nearby route' }]);
    expect(t.totalMiles).toBeNull();
  });

  it('guards against < 2 parks without a DB call', async () => {
    const t = await graphTripPath(['yell']);
    expect(t.nodes).toEqual([]);
    expect(t.legs).toBe(0);
    expect(readGraph).not.toHaveBeenCalled();
  });
});
