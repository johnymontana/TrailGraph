import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a) }));
// explainGraph reads travel constraints via bridges; mock it (also keeps bridges' NAMS import out).
const getTravelConstraints = vi.fn();
vi.mock('./bridges', () => ({ getTravelConstraints: (...a: unknown[]) => getTravelConstraints(...a) }));

import { explainRecommendation, explainGraph, explainForParks } from './explain';

beforeEach(() => {
  readGraph.mockReset();
  getTravelConstraints.mockReset();
  getTravelConstraints.mockResolvedValue({ wheelchair: false, rvMaxLengthFt: null, requiredAmenities: [] });
});

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

describe('explainGraph (ADR-047 — literal explanatory edges)', () => {
  it('returns preference triples with relationship direction + the user\'s words', async () => {
    readGraph.mockResolvedValueOnce([
      {
        park: 'Bryce Canyon',
        prefPaths: [{ name: 'Stargazing', kind: 'activity', via: 'OFFERS', yourWords: 'dark skies', weight: 2 }],
      },
    ]);
    const out = await explainGraph('u1', 'brca');
    expect(out.park).toBe('Bryce Canyon');
    expect(out.prefPaths).toEqual([
      { name: 'Stargazing', kind: 'activity', via: 'OFFERS', yourWords: 'dark skies', weight: 2 },
    ]);
    expect(out.constraints).toEqual([]); // no constraints in the mock
  });

  it('cites the concrete campground that satisfies the wheelchair + RV constraints', async () => {
    getTravelConstraints.mockResolvedValue({ wheelchair: true, rvMaxLengthFt: 22, requiredAmenities: [] });
    readGraph
      .mockResolvedValueOnce([{ park: 'Yellowstone', prefPaths: [] }]) // prefRows
      .mockResolvedValueOnce([{ name: 'Canyon Campground' }]) // wheelchair cg
      .mockResolvedValueOnce([{ name: 'Canyon Campground', ft: 40 }]); // rv cg
    const out = await explainGraph('u1', 'yell');
    expect(out.constraints).toEqual([
      { kind: 'wheelchair', label: 'wheelchair-accessible camping', satisfiedBy: 'Canyon Campground' },
      { kind: 'rv', label: 'fits your 22 ft RV', satisfiedBy: 'Canyon Campground (≤ 40 ft)' },
    ]);
  });

  it('drops the OPTIONAL-MATCH null preference row', async () => {
    readGraph.mockResolvedValueOnce([{ park: 'Yellowstone', prefPaths: [{ name: null }] }]);
    const out = await explainGraph('u1', 'yell');
    expect(out.prefPaths).toEqual([]);
  });
});

describe('explainForParks (batched "because you liked …")', () => {
  it('returns {} for an empty park list without hitting the DB', async () => {
    expect(await explainForParks('u1', [])).toEqual({});
    expect(readGraph).not.toHaveBeenCalled();
  });

  it('maps each parkCode to its matched preference names', async () => {
    readGraph.mockResolvedValue([
      { parkCode: 'glac', matched: ['Hiking', 'Astronomy'] },
      { parkCode: 'yell', matched: [] },
    ]);
    const out = await explainForParks('u1', ['glac', 'yell']);
    expect(out).toEqual({ glac: ['Hiking', 'Astronomy'], yell: [] });
  });
});
