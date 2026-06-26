import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
const writeGraph = vi.fn();
vi.mock('./neo4j', () => ({
  readGraph: (...a: unknown[]) => readGraph(...a),
  writeGraph: (...a: unknown[]) => writeGraph(...a),
}));

import { gdsAvailable, getInsights } from './graph-analytics';

beforeEach(() => {
  readGraph.mockReset();
  writeGraph.mockReset();
});

describe('gdsAvailable', () => {
  it('true when gds.version() resolves', async () => {
    readGraph.mockResolvedValueOnce([{ v: '2.x' }]);
    expect(await gdsAvailable()).toBe(true);
  });
  it('false when GDS is not installed (query throws)', async () => {
    readGraph.mockRejectedValueOnce(new Error('Unknown function gds.version'));
    expect(await gdsAvailable()).toBe(false);
  });
});

describe('getInsights', () => {
  it('labels communities by top topics and passes through central/bridges', async () => {
    // Promise.all order: communities, central, bridges.
    readGraph
      .mockResolvedValueOnce([
        { id: 1, size: 5, topTopics: ['Volcanoes', 'Geology', 'Night Sky', 'Wildlife'], parkCodes: ['yell', 'crla'] },
        { id: 2, size: 3, topTopics: [], parkCodes: ['zion'] },
      ])
      .mockResolvedValueOnce([{ parkCode: 'yell', name: 'Yellowstone', score: 0.9 }])
      .mockResolvedValueOnce([{ parkCode: 'grca', name: 'Grand Canyon', bridges: 4, betweenness: 12.3 }]);
    const r = await getInsights();
    expect(r.communities[0]).toMatchObject({ id: 1, size: 5, parkCodes: ['yell', 'crla'] });
    expect(r.communities[0].label).toBe('Volcanoes · Geology · Night Sky'); // top 3 only
    expect(r.communities[1].label).toBe('Cluster 2'); // empty topics → fallback label
    expect(r.central).toEqual([{ parkCode: 'yell', name: 'Yellowstone', score: 0.9 }]);
    expect(r.bridges[0]).toMatchObject({ parkCode: 'grca', bridges: 4 });
  });

  it('returns empty arrays when analytics have not been computed', async () => {
    readGraph.mockResolvedValue([]);
    const r = await getInsights();
    expect(r).toEqual({ communities: [], central: [], bridges: [] });
  });
});
