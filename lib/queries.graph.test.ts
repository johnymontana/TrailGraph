import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
const embedQuery = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a) }));
vi.mock('./embed-cache', () => ({ embedQuery: (...a: unknown[]) => embedQuery(...a) }));

import { graphSeed, expandNode, graphLens, isGraphLens, unifiedNodeSearch, egoNetwork, GRAPH_NODE_KEYS, isGraphNodeLabel } from './queries';

beforeEach(() => {
  readGraph.mockReset();
  embedQuery.mockReset();
});

describe('graphSeed (similarity backbone)', () => {
  it('reads one row per NP (topic SET) and shapes the IDF backbone into a SeedGraph', async () => {
    // Three parks: yell & grte share two DISTINCTIVE topics (Geysers, Grizzlies — each on 2/3 parks),
    // plus a ubiquitous "Mountains" on all 3 (idf 0). glac shares only Mountains → no backbone edge to it.
    readGraph.mockResolvedValueOnce([
      { code: 'yell', name: 'Yellowstone', lat: 44.4, lng: -110.5, topics: ['Mountains', 'Geysers', 'Grizzlies'] },
      { code: 'grte', name: 'Grand Teton', lat: 43.7, lng: -110.7, topics: ['Mountains', 'Geysers', 'Grizzlies'] },
      { code: 'glac', name: 'Glacier', lat: 48.7, lng: -113.7, topics: ['Mountains'] },
    ]);
    const g = await graphSeed();
    // Every NP is emitted as a bare-keyed Park node (even the edgeless one).
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['glac', 'grte', 'yell']);
    const yell = g.nodes.find((n) => n.id === 'yell')!;
    expect(yell).toMatchObject({ id: 'yell', label: 'Park', key: 'yell', parkCode: 'yell', lat: 44.4 });
    // The distinctive pair gets an edge; value = #distinctive shared topics; the ubiquitous topic is excluded.
    expect(g.links).toHaveLength(1);
    expect(g.links[0]).toMatchObject({ source: 'grte', target: 'yell', value: 2 });
    expect(g.links[0].topics).toEqual(expect.arrayContaining(['Geysers', 'Grizzlies']));
    expect(g.links[0].topics).not.toContain('Mountains');
    // glac shared only the ubiquitous topic → edgeless but still present (degree 0).
    expect(g.nodes.find((n) => n.id === 'glac')!.degree).toBe(0);
  });

  it('passes a single-statement read with no LIMIT/SKIP (cap is applied in the pure helper)', async () => {
    readGraph.mockResolvedValueOnce([]);
    await graphSeed();
    const cypher = readGraph.mock.calls[0][0] as string;
    expect(cypher).toMatch(/OPTIONAL MATCH \(p\)-\[:HAS_TOPIC\]->\(t:Topic\)/);
    expect(cypher).not.toMatch(/LIMIT/);
  });
});

describe('expandNode', () => {
  it('shapes neighbours: bare park ids, prefixed entity ids, edge direction, node dedupe', async () => {
    readGraph.mockResolvedValueOnce([
      { label: 'Topic', natId: 'topic:geology', caption: 'Geology', lat: null, lng: null, relType: 'HAS_TOPIC', outgoing: true },
      { label: 'Topic', natId: 'topic:geology', caption: 'Geology', lat: null, lng: null, relType: 'HAS_TOPIC', outgoing: true }, // dup row → one node
      { label: 'Park', natId: 'grte', caption: 'Grand Teton', lat: 43.7, lng: -110.7, relType: 'NEAR', outgoing: false },
    ]);
    const { nodes, links } = await expandNode('yell', 'Park');
    expect([...nodes.map((n) => n.id)].sort()).toEqual(['Topic:topic:geology', 'grte']);
    expect(nodes.find((n) => n.id === 'Topic:topic:geology')).toMatchObject({ label: 'Topic', key: 'topic:geology' });
    expect(nodes.find((n) => n.id === 'grte')).toMatchObject({ label: 'Park', parkCode: 'grte', key: 'grte' });
    // outgoing edge → center is source; incoming edge → center is target
    expect(links).toContainEqual({ source: 'yell', target: 'Topic:topic:geology', caption: 'HAS_TOPIC' });
    expect(links).toContainEqual({ source: 'grte', target: 'yell', caption: 'NEAR' });
  });

  it('passes the decoded key + the closed neighbour allowlist to the query', async () => {
    readGraph.mockResolvedValueOnce([]);
    await expandNode('topic:geology', 'Topic');
    const params = readGraph.mock.calls[0][1] as { key: string; allowed: string[] };
    expect(params.key).toBe('topic:geology');
    expect(params.allowed).toEqual(Object.keys(GRAPH_NODE_KEYS));
  });
});

describe('graphLens', () => {
  it('near lens: passes $maxMiles as FLOAT (no toInteger), rebuilds node degrees, carries captions', async () => {
    readGraph.mockResolvedValueOnce([
      { source: 'zion', sName: 'Zion', target: 'brca', tName: 'Bryce', value: 71.4, caption: '71 mi' },
      { source: 'zion', sName: 'Zion', target: 'cany', tName: 'Canyonlands', value: 180.2, caption: '180 mi' },
    ]);
    const g = await graphLens('near', { maxMiles: 150 });
    const params = readGraph.mock.calls[0][1] as { maxMiles: number; minUsers: number };
    expect(params.maxMiles).toBe(150);
    expect(g.nodes.find((n) => n.id === 'zion')?.degree).toBe(2); // appears in both links
    expect(g.links[0]).toEqual({ source: 'zion', target: 'brca', value: 71.4, caption: '71 mi' });
  });

  it('co_considered lens: clamps minUsers to the k-anonymity floor (≥5)', async () => {
    readGraph.mockResolvedValueOnce([]);
    await graphLens('co_considered', { minUsers: 2 });
    expect((readGraph.mock.calls[0][1] as { minUsers: number }).minUsers).toBe(5);
  });

  it('isGraphLens validates the lens enum', () => {
    expect(isGraphLens('near')).toBe(true);
    expect(isGraphLens('co_considered')).toBe(true);
    expect(isGraphLens('nope')).toBe(false);
  });
});

describe('unifiedNodeSearch', () => {
  it('embeds the query ONCE and reuses the vector across the vector searches', async () => {
    // parks/places/people vector queries return nothing; only the Topic/Activity CONTAINS lookup hits.
    embedQuery.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    readGraph.mockImplementation((cypher: string) =>
      /CONTAINS/.test(cypher)
        ? Promise.resolve([
            { kind: 'topic', key: 'topic:geology', name: 'Geology' },
            { kind: 'activity', key: 'act:hiking', name: 'Hiking' },
          ])
        : Promise.resolve([]),
    );
    const hits = await unifiedNodeSearch('geology');
    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(hits).toContainEqual({ kind: 'topic', label: 'Topic', key: 'topic:geology', name: 'Geology' });
    expect(hits).toContainEqual({ kind: 'activity', label: 'Activity', key: 'act:hiking', name: 'Hiking' });
  });

  it('degrades to graph-only hits when the embed gateway fails (does not go fully dark)', async () => {
    // Gateway down → embedQuery rejects. The vector searches are skipped but the Topic/Activity CONTAINS
    // lookup still runs, so the search box returns graph-only hits instead of throwing.
    embedQuery.mockRejectedValueOnce(new Error('AI Gateway embeddings 401'));
    readGraph.mockImplementation((cypher: string) =>
      /CONTAINS/.test(cypher)
        ? Promise.resolve([{ kind: 'topic', key: 'topic:geology', name: 'Geology' }])
        : Promise.resolve([]),
    );
    const hits = await unifiedNodeSearch('geology');
    expect(hits).toEqual([{ kind: 'topic', label: 'Topic', key: 'topic:geology', name: 'Geology' }]);
    // Only the CONTAINS query ran — no vector search was attempted with an undefined vector.
    for (const call of readGraph.mock.calls) expect(call[0]).toMatch(/CONTAINS/);
  });

  it('merges parks + places + people + topics into one ranked hit list with bare/prefixed keys', async () => {
    embedQuery.mockResolvedValueOnce([0.1, 0.2]);
    readGraph.mockImplementation((cypher: string) => {
      if (/park_embedding/.test(cypher)) return Promise.resolve([{ parkCode: 'yell', name: 'Yellowstone', states: ['WY'], score: 0.9 }]);
      if (/HAS_PLACE/.test(cypher)) return Promise.resolve([{ id: 'place:oldfaithful', title: 'Old Faithful', parks: [{ parkCode: 'yell', parkName: 'Yellowstone' }], score: 0.8 }]);
      if (/ASSOCIATED_WITH/.test(cypher)) return Promise.resolve([{ id: 'person:muir', title: 'John Muir', parks: [{ parkCode: 'yose', parkName: 'Yosemite' }], score: 0.7 }]);
      if (/CONTAINS/.test(cypher)) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const hits = await unifiedNodeSearch('yellowstone');
    const kinds = hits.map((h) => h.kind);
    expect(kinds).toContain('park');
    expect(kinds).toContain('place');
    expect(kinds).toContain('person');
    const park = hits.find((h) => h.kind === 'park')!;
    expect(park).toMatchObject({ label: 'Park', key: 'yell', name: 'Yellowstone' });
    const place = hits.find((h) => h.kind === 'place')!;
    expect(place).toMatchObject({ label: 'Place', key: 'place:oldfaithful' });
  });
});

describe('egoNetwork', () => {
  it('builds the center node + one-hop neighbours with narration', async () => {
    readGraph
      .mockResolvedValueOnce([{ name: 'Yellowstone', lat: 44.4, lng: -110.5 }]) // center lookup
      .mockResolvedValueOnce([
        { label: 'Topic', natId: 'topic:geology', caption: 'Geology', lat: null, lng: null, relType: 'HAS_TOPIC', outgoing: true },
        { label: 'Park', natId: 'grte', caption: 'Grand Teton', lat: 43.7, lng: -110.7, relType: 'NEAR', outgoing: false },
      ]);
    const ego = await egoNetwork('yell', 'Park');
    const center = ego.nodes.find((n) => n.id === 'yell')!;
    expect(center).toMatchObject({ id: 'yell', label: 'Park', name: 'Yellowstone' });
    expect(ego.nodes.find((n) => n.id === 'Topic:topic:geology')).toBeDefined();
    expect(ego.nodes.find((n) => n.id === 'grte')).toBeDefined();
    expect(ego.links).toContainEqual({ source: 'yell', target: 'Topic:topic:geology', caption: 'HAS_TOPIC' });
    expect(ego.links).toContainEqual({ source: 'grte', target: 'yell', caption: 'NEAR' });
    expect(ego.narration).toMatch(/Yellowstone/);
  });

  it('returns a narration even when the node has no neighbours', async () => {
    readGraph
      .mockResolvedValueOnce([{ name: 'Lonely Topic', lat: null, lng: null }])
      .mockResolvedValueOnce([]);
    const ego = await egoNetwork('topic:obscure', 'Topic');
    expect(ego.nodes).toHaveLength(1);
    expect(ego.links).toHaveLength(0);
    expect(typeof ego.narration).toBe('string');
  });

  it('returns an empty result (no phantom centre) for an unknown id', async () => {
    readGraph.mockResolvedValueOnce([]); // centre lookup finds nothing
    const ego = await egoNetwork('topic:does-not-exist', 'Topic');
    expect(ego.nodes).toEqual([]);
    expect(ego.links).toEqual([]);
    expect(ego.narration).toMatch(/not found/i);
    // expandNode must NOT be called once the centre is unknown.
    expect(readGraph).toHaveBeenCalledTimes(1);
  });
});

describe('isGraphNodeLabel (expand allowlist)', () => {
  it('accepts known labels and rejects Season / user / unknown labels', () => {
    expect(isGraphNodeLabel('Park')).toBe(true);
    expect(isGraphNodeLabel('Topic')).toBe(true);
    expect(isGraphNodeLabel('Season')).toBe(false);
    expect(isGraphNodeLabel('User')).toBe(false);
    expect(isGraphNodeLabel('Nope')).toBe(false);
  });
});
