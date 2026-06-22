import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a) }));
// embeddings import side-effects aren't needed for parkGraph; stub embed to keep the module pure.
vi.mock('./embeddings', () => ({ embed: vi.fn() }));

import { parkGraph } from './queries';

beforeEach(() => readGraph.mockReset());

describe('parkGraph (per-park one-hop, NVL-shaped)', () => {
  const neighbors = [
    { label: 'Activity', caption: 'Hiking', natId: 'act-hike', parkCode: null, stateCode: null, name: 'Hiking', relType: 'OFFERS', dir: 'out' },
    { label: 'Topic', caption: 'Geology', natId: 'top-geo', parkCode: null, stateCode: null, name: 'Geology', relType: 'HAS_TOPIC', dir: 'out' },
    { label: 'State', caption: 'WY', natId: 'WY', parkCode: null, stateCode: 'WY', name: 'Wyoming', relType: 'LOCATED_IN', dir: 'out' },
    { label: 'Campground', caption: 'Canyon CG', natId: 'cg-canyon', parkCode: null, stateCode: null, name: 'Canyon CG', relType: 'IN_PARK', dir: 'in' },
    // duplicate Activity row → should dedupe to one node
    { label: 'Activity', caption: 'Hiking', natId: 'act-hike', parkCode: null, stateCode: null, name: 'Hiking', relType: 'OFFERS', dir: 'out' },
  ];

  it('builds a center park + deduped, color-coded, nav-tagged one-hop nodes', async () => {
    readGraph.mockResolvedValueOnce(neighbors); // neighbor query
    const g = await parkGraph('yell', { parkName: 'Yellowstone National Park', includeRelated: false });

    const center = g.nodes.find((n) => n.id === 'yell')!;
    expect(center).toMatchObject({ caption: 'Yellowstone National Park', label: 'Park', nav: { kind: 'none' } });

    // dedupe: only one Hiking activity node
    expect(g.nodes.filter((n) => n.id === 'Activity:act-hike')).toHaveLength(1);

    // nav descriptors by label
    expect(g.nodes.find((n) => n.id === 'Activity:act-hike')!.nav).toEqual({ kind: 'activity', name: 'Hiking' });
    expect(g.nodes.find((n) => n.id === 'Topic:top-geo')!.nav).toEqual({ kind: 'topic', name: 'Geology' });
    expect(g.nodes.find((n) => n.id === 'State:WY')!.nav).toEqual({ kind: 'state', code: 'WY' });
    expect(g.nodes.find((n) => n.id === 'Campground:cg-canyon')!.nav).toEqual({ kind: 'none' });

    // relationship direction preserved (out: center→node; in: node→center)
    expect(g.relationships).toContainEqual(
      expect.objectContaining({ from: 'yell', to: 'Activity:act-hike', caption: 'OFFERS' }),
    );
    expect(g.relationships).toContainEqual(
      expect.objectContaining({ from: 'Campground:cg-canyon', to: 'yell', caption: 'IN_PARK' }),
    );
  });

  it('appends similar parks as clickable nodes with a SIMILAR edge when includeRelated', async () => {
    readGraph
      .mockResolvedValueOnce(neighbors) // neighbor query
      .mockResolvedValueOnce([{ parkCode: 'grte', name: 'Grand Teton National Park' }]); // similarParks query
    const g = await parkGraph('yell', { parkName: 'Yellowstone National Park', includeRelated: true });

    const teton = g.nodes.find((n) => n.id === 'Park:grte')!;
    expect(teton).toMatchObject({ caption: 'Grand Teton National Park', label: 'Park', nav: { kind: 'park', parkCode: 'grte' } });
    expect(g.relationships).toContainEqual(expect.objectContaining({ from: 'yell', to: 'Park:grte', caption: 'SIMILAR' }));
  });
});
