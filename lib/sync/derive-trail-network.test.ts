import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));
vi.mock('../blob-trails', () => ({ readParkTrails: vi.fn() }));

import { readGraph, writeGraph } from '../neo4j';
import { readParkTrails } from '../blob-trails';
import { deriveTrailNetwork } from './derive-trail-network';

const mockReadGraph = readGraph as unknown as ReturnType<typeof vi.fn>;
const mockWriteGraph = writeGraph as unknown as ReturnType<typeof vi.fn>;
const mockReadParkTrails = readParkTrails as unknown as ReturnType<typeof vi.fn>;

/**
 * derive-trail-network (ADR-072): reads each park's Blob FC once, extracts endpoint keys, computes
 * CONNECTS via the pure core, and upserts them. I/O is mocked so the glue (Blob read → endpoints →
 * computeConnections → write payload) is tested without Neo4j or a real Blob.
 */
describe('deriveTrailNetwork', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads each park FC once, derives CONNECTS from a shared endpoint, and upserts it', async () => {
    mockReadGraph.mockResolvedValue([{ parkCode: 'grca', geoUrl: null }]);
    mockReadParkTrails.mockResolvedValue({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 'a' }, geometry: { type: 'LineString', coordinates: [[-112.1, 36.0], [-112.0, 36.05]] } },
        { type: 'Feature', properties: { id: 'b' }, geometry: { type: 'MultiLineString', coordinates: [[[-112.0, 36.05], [-111.9, 36.1]]] } },
      ],
    });
    mockWriteGraph.mockResolvedValue([{ c: 1 }]);

    const res = await deriveTrailNetwork();

    expect(mockReadParkTrails).toHaveBeenCalledTimes(1);
    expect(mockReadParkTrails).toHaveBeenCalledWith('grca', null);
    // a SCOPED per-park DELETE (after the clean read) + the CONNECTS upsert
    expect(mockWriteGraph).toHaveBeenCalledTimes(2);
    const [delCypher, delParams] = mockWriteGraph.mock.calls[0];
    expect(delCypher).toContain('MATCH (a:Trail {parkCode:$parkCode})-[r:CONNECTS]->(:Trail) DELETE r');
    expect(delParams.parkCode).toBe('grca');
    const [cypher, params] = mockWriteGraph.mock.calls[1];
    expect(cypher).toContain('MERGE (a)-[r:CONNECTS]->(b)');
    expect(params.conns).toEqual([{ from: 'a', to: 'b', junctions: 1 }]); // shared (-112.0, 36.05)
    expect(res).toEqual({ edges: 1, parks: 1 });
  });

  it('a park whose geometry is not synced (no FC) is skipped entirely — no delete, no upsert (preserves edges)', async () => {
    mockReadGraph.mockResolvedValue([{ parkCode: 'zion', geoUrl: null }]);
    mockReadParkTrails.mockResolvedValue(null);

    const res = await deriveTrailNetwork();

    // The scoped-delete-after-read design means a transient/absent FC never wipes the park's prior edges.
    expect(mockWriteGraph).not.toHaveBeenCalled();
    expect(res).toEqual({ edges: 0, parks: 0 });
  });

  it('counts the park and clears its stale edges, but writes no upsert, when its trails do not connect', async () => {
    mockReadGraph.mockResolvedValue([{ parkCode: 'glac', geoUrl: 'https://blob/glac.geojson' }]);
    mockReadParkTrails.mockResolvedValue({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 'x' }, geometry: { type: 'LineString', coordinates: [[0, 0], [0, 1]] } },
        { type: 'Feature', properties: { id: 'y' }, geometry: { type: 'LineString', coordinates: [[5, 5], [5, 6]] } },
      ],
    });

    const res = await deriveTrailNetwork();

    expect(mockWriteGraph).toHaveBeenCalledTimes(1); // scoped DELETE only, no upsert
    expect(mockWriteGraph.mock.calls[0][1].parkCode).toBe('glac');
    expect(res).toEqual({ edges: 0, parks: 1 });
  });
});
