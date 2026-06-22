import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a) }));

import { explainRecommendation } from './explain';

beforeEach(() => readGraph.mockReset());

describe('explainRecommendation (D4 — graph-grounded "why this")', () => {
  it('returns the matched preferences with the user\'s own words', async () => {
    readGraph.mockResolvedValue([
      {
        park: 'Glacier National Park',
        matches: [
          { name: 'Hiking', yourWords: 'easy hikes' },
          { name: 'Astronomy', yourWords: 'dark skies' },
        ],
      },
    ]);
    const out = await explainRecommendation('u1', 'glac');
    expect(out).toEqual({
      parkCode: 'glac',
      park: 'Glacier National Park',
      matches: [
        { name: 'Hiking', yourWords: 'easy hikes' },
        { name: 'Astronomy', yourWords: 'dark skies' },
      ],
      accessibility: [], // no constraints set in this mock → no accessibility clauses
    });
  });

  it('drops empty match rows (the OPTIONAL MATCH no-match collapses to a {name:null})', async () => {
    readGraph.mockResolvedValue([{ park: 'Yellowstone', matches: [{ name: null, yourWords: null }] }]);
    const out = await explainRecommendation('u1', 'yell');
    expect(out.matches).toEqual([]);
  });

  it('handles a park with no row at all (null park, empty matches)', async () => {
    readGraph.mockResolvedValue([]);
    const out = await explainRecommendation('u1', 'nope');
    expect(out).toEqual({ parkCode: 'nope', park: null, matches: [], accessibility: [] });
  });
});
