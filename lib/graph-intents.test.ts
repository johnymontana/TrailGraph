import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
const embedQuery = vi.fn();
const thematicTrail = vi.fn();
const similarParks = vi.fn();
const nearbyParks = vi.fn();
const searchParks = vi.fn();

vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a) }));
vi.mock('./embed-cache', () => ({ embedQuery: (...a: unknown[]) => embedQuery(...a) }));
vi.mock('./queries', () => ({
  thematicTrail: (...a: unknown[]) => thematicTrail(...a),
  similarParks: (...a: unknown[]) => similarParks(...a),
  nearbyParks: (...a: unknown[]) => nearbyParks(...a),
  searchParks: (...a: unknown[]) => searchParks(...a),
}));

import { runIntent, answerGraphQuery, INTENT_IDS } from './graph-intents';

beforeEach(() => {
  readGraph.mockReset();
  embedQuery.mockReset();
  thematicTrail.mockReset();
  similarParks.mockReset();
  nearbyParks.mockReset();
  searchParks.mockReset();
});

const park = (parkCode: string, name: string) => ({ parkCode, name, lat: 1, lng: 2, designation: 'National Park', states: 'CA', image: null, darkSky: false, accessible: false, feeFree: false });

describe('runIntent', () => {
  it('parks_by_person → person center + park nodes + ASSOCIATED_WITH links', async () => {
    thematicTrail.mockResolvedValueOnce([
      { ...park('yose', 'Yosemite'), via: 'John Muir' },
      { ...park('seki', 'Sequoia'), via: 'John Muir' },
    ]);
    const r = await runIntent('parks_by_person', { person: 'John Muir' });
    expect(thematicTrail).toHaveBeenCalledWith({ person: 'John Muir' }, 20);
    expect(r.nodes.find((n) => n.label === 'Person')).toMatchObject({ id: 'Person:John Muir', name: 'John Muir' });
    expect(r.nodes.filter((n) => n.label === 'Park').map((n) => n.id).sort()).toEqual(['seki', 'yose']);
    expect(r.links).toHaveLength(2);
    expect(r.links[0]).toMatchObject({ source: 'Person:John Muir', target: 'yose', caption: 'ASSOCIATED_WITH' });
    expect(r.narration).toContain('2 parks');
  });

  it('parks_by_person → narrated empty when nothing connects', async () => {
    thematicTrail.mockResolvedValueOnce([]);
    const r = await runIntent('parks_by_person', { person: 'Nobody' });
    expect(r.nodes).toEqual([]);
    expect(r.narration).toContain('No parks');
  });

  it('how_connected → resolves both parks then renders the shortest path', async () => {
    searchParks.mockImplementation(async ({ q }: { q: string }) => {
      const map: Record<string, ReturnType<typeof park>> = { zion: park('zion', 'Zion'), acadia: park('acad', 'Acadia') };
      const hit = map[q.toLowerCase()];
      return { items: hit ? [hit] : [], total: hit ? 1 : 0 };
    });
    readGraph.mockResolvedValueOnce([
      {
        pathNodes: [
          { parkCode: 'zion', name: 'Zion', lat: 1, lng: 1 },
          { parkCode: 'mid', name: 'Middle', lat: 2, lng: 2 },
          { parkCode: 'acad', name: 'Acadia', lat: 3, lng: 3 },
        ],
        relTypes: ['SHARES_TOPIC', 'NEAR'],
      },
    ]);
    const r = await runIntent('how_connected', { a: 'Zion', b: 'Acadia' });
    expect(r.nodes.map((n) => n.id)).toEqual(['zion', 'mid', 'acad']);
    expect(r.links).toEqual([
      { source: 'zion', target: 'mid', caption: 'SHARES_TOPIC' },
      { source: 'mid', target: 'acad', caption: 'NEAR' },
    ]);
    expect(r.narration).toContain('2 hops');
  });

  it('how_connected → not-found when a park cannot be resolved', async () => {
    searchParks.mockResolvedValue({ items: [], total: 0 });
    const r = await runIntent('how_connected', { a: 'Zzz', b: 'Acadia' });
    expect(r.nodes).toEqual([]);
    expect(r.narration).toContain("Couldn't find");
  });

  it('unknown intent → narrated, never throws', async () => {
    const r = await runIntent('nope', {});
    expect(r).toEqual({ narration: 'Unknown query type "nope".', nodes: [], links: [] });
  });
});

describe('answerGraphQuery (on-page bar classify + extract)', () => {
  // A tiny keyword embedding so cosine actually discriminates the person intent.
  const kwVec = (t: string): number[] => {
    const s = t.toLowerCase();
    return [
      s.includes('connected to') || s.includes('associated') || s.includes('linked') ? 1 : 0,
      s.includes('about') || s.includes('feature') || s.includes('topic') ? 1 : 0,
      s.includes('like') || s.includes('similar') ? 1 : 0,
    ];
  };

  it('classifies + extracts a single-entity intent and runs it', async () => {
    embedQuery.mockImplementation(async (t: string) => kwVec(t));
    thematicTrail.mockResolvedValueOnce([{ ...park('yose', 'Yosemite'), via: 'John Muir' }]);
    const r = await answerGraphQuery('parks connected to John Muir');
    expect(r.intent).toBe('parks_by_person');
    expect(r.nodes.some((n) => n.id === 'yose')).toBe(true);
    expect(r.candidates).toBeUndefined();
  });

  it('returns disambiguation chips on a low-confidence query', async () => {
    embedQuery.mockResolvedValue([0, 0, 0]); // query matches nothing
    const r = await answerGraphQuery('zzzzzz qqqqqq');
    expect(r.nodes).toEqual([]);
    expect(r.candidates?.length).toBeGreaterThan(0);
    expect(r.candidates?.length).toBeLessThanOrEqual(3);
  });
});

describe('INTENT_IDS', () => {
  it('exposes the curated intent set for the tool enum', () => {
    expect(INTENT_IDS).toContain('parks_by_person');
    expect(INTENT_IDS).toContain('how_connected');
    expect(INTENT_IDS.length).toBeGreaterThanOrEqual(8);
  });
});

describe('analytics intents (#7)', () => {
  it('central_parks → ranked park nodes, no links', async () => {
    readGraph.mockResolvedValueOnce([
      { parkCode: 'yell', name: 'Yellowstone', score: 0.9, lat: 1, lng: 2 },
      { parkCode: 'grca', name: 'Grand Canyon', score: 0.7, lat: 3, lng: 4 },
    ]);
    const r = await runIntent('central_parks', {});
    expect(r.nodes.map((n) => n.id)).toEqual(['yell', 'grca']);
    expect(r.links).toEqual([]);
    expect(r.narration).toContain('central');
  });

  it('central_parks / bridge_parks narrate gracefully when analytics are absent', async () => {
    readGraph.mockResolvedValue([]);
    const c = await runIntent('central_parks', {});
    expect(c.nodes).toEqual([]);
    expect(c.narration).toMatch(/not computed/i);
    const b = await runIntent('bridge_parks', {});
    expect(b.nodes).toEqual([]);
    expect(b.narration).toMatch(/not computed/i);
  });

  it('INTENT_IDS includes the analytics intents', () => {
    expect(INTENT_IDS).toContain('parks_in_cluster');
    expect(INTENT_IDS).toContain('central_parks');
    expect(INTENT_IDS).toContain('bridge_parks');
  });
});
