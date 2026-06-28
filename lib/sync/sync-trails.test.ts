import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the I/O boundary syncTrails orchestrates so we can assert its per-park skip vs. re-upload decision.
// `vi.hoisted` makes the spies exist before the (hoisted) vi.mock factories bind to them.
const h = vi.hoisted(() => ({
  readGraph: vi.fn(),
  writeGraph: vi.fn(async () => []),
  fetchParkTrails: vi.fn(),
  putParkTrails: vi.fn(async () => 'https://blob.example/trails/test.geojson'),
  upsertTrails: vi.fn(async () => 1),
  aggregateTrails: vi.fn(),
}));

vi.mock('../neo4j', () => ({ readGraph: h.readGraph, writeGraph: h.writeGraph }));
vi.mock('../datasources/nps-trails', () => ({ fetchParkTrails: h.fetchParkTrails }));
vi.mock('../blob-trails', () => ({ putParkTrails: h.putParkTrails }));
vi.mock('./upserts', () => ({ upsertTrails: h.upsertTrails }));
vi.mock('./trail-aggregate', () => ({ aggregateTrails: h.aggregateTrails }));
// Deterministic, inspectable hash so we can seed a matching :Park.trailsSyncHash to trigger the skip path.
vi.mock('../embeddings', () => ({ contentHash: (s: string) => `h:${s}` }));
vi.mock('../env', () => ({ env: { trails: { simplifyTolerance: 0.0001 } } }));

import { syncTrails } from './sync-trails';

// One aggregated trail whose own contentHash is 'tc1' → the park-level setHash is contentHash('tc1') = 'h:tc1'.
const AGG = [
  {
    id: 'nps:test:loop',
    name: 'Test Loop',
    parkCode: 'test',
    source: 'nps',
    lengthMiles: 2,
    routeType: 'loop',
    trailClass: 2,
    allowedUses: ['hiking'],
    dataConfidence: 'medium',
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    trailheadPoint: [0, 0],
    bbox: [0, 0, 1, 1],
    contentHash: 'tc1',
  },
];
const MATCHING_HASH = 'h:tc1';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SYNC_FORCE;
  h.writeGraph.mockResolvedValue([]);
  h.fetchParkTrails.mockResolvedValue([{ type: 'Feature' }]); // non-empty → aggregation runs
  h.aggregateTrails.mockReturnValue(AGG);
  h.putParkTrails.mockResolvedValue('https://blob.example/trails/test.geojson');
  h.upsertTrails.mockResolvedValue(1);
});

describe('syncTrails per-park skip', () => {
  it('skips an unchanged park whose geometry is still in Blob (hash match + non-null trailsGeoUrl)', async () => {
    h.readGraph.mockResolvedValue([{ parkCode: 'test', hash: MATCHING_HASH, geoUrl: 'https://blob.example/trails/test.geojson' }]);

    const r = await syncTrails();

    expect(h.putParkTrails).not.toHaveBeenCalled();
    expect(h.upsertTrails).not.toHaveBeenCalled();
    expect(r).toMatchObject({ parksSkipped: 1, parksWithTrails: 0, trails: 0 });
  });

  it('still skips a non-null LOCAL-path trailsGeoUrl on a hash match (migrating local→Blob needs SYNC_FORCE)', async () => {
    // A local-dev path is truthy, so the geometry-present skip holds — only a NULL url forces a re-upload.
    // To migrate prod URLs polluted with local paths to Blob, use SYNC_FORCE=1 (per docs/DEPLOY-MAP-DATA.md).
    h.readGraph.mockResolvedValue([{ parkCode: 'test', hash: MATCHING_HASH, geoUrl: '/trails/test.geojson' }]);

    const r = await syncTrails();

    expect(h.putParkTrails).not.toHaveBeenCalled();
    expect(r).toMatchObject({ parksSkipped: 1, parksWithTrails: 0 });
  });

  it('re-uploads on a hash match when trailsGeoUrl is NULL (Blob wiped / manually cleared)', async () => {
    h.readGraph.mockResolvedValue([{ parkCode: 'test', hash: MATCHING_HASH, geoUrl: null }]);

    const r = await syncTrails();

    // The bug fix: a missing Blob pointer forces a re-upload even though the content hash is unchanged.
    expect(h.putParkTrails).toHaveBeenCalledTimes(1);
    expect(h.upsertTrails).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ parksSkipped: 0, parksWithTrails: 1 });
  });

  it('re-uploads when the upstream geometry changed (hash mismatch), even with a URL present', async () => {
    h.readGraph.mockResolvedValue([{ parkCode: 'test', hash: 'h:stale', geoUrl: 'https://blob.example/trails/test.geojson' }]);

    const r = await syncTrails();

    expect(h.putParkTrails).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ parksSkipped: 0, parksWithTrails: 1 });
  });

  it('SYNC_FORCE=1 re-uploads even on a full hash + URL match', async () => {
    process.env.SYNC_FORCE = '1';
    h.readGraph.mockResolvedValue([{ parkCode: 'test', hash: MATCHING_HASH, geoUrl: 'https://blob.example/trails/test.geojson' }]);

    const r = await syncTrails();

    expect(h.putParkTrails).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ parksSkipped: 0, parksWithTrails: 1 });
  });
});
