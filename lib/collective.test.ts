import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
const writeGraph = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a), writeGraph: (...a: unknown[]) => writeGraph(...a) }));

import { travelersAlsoLoved, getCollectiveOptIn } from './collective';

beforeEach(() => {
  readGraph.mockReset();
  writeGraph.mockReset();
});

describe('travelersAlsoLoved (E5 — opt-in collective intelligence)', () => {
  it('returns nothing for a user who has not opted in (no traversal runs)', async () => {
    readGraph.mockResolvedValueOnce([{ optIn: false }]); // getCollectiveOptIn
    const picks = await travelersAlsoLoved('u1');
    expect(picks).toEqual([]);
    expect(readGraph).toHaveBeenCalledTimes(1); // never ran the aggregate traversal
  });

  it('returns anonymized counts when opted in', async () => {
    readGraph
      .mockResolvedValueOnce([{ optIn: true }]) // getCollectiveOptIn
      .mockResolvedValueOnce([
        { parkCode: 'grca', name: 'Grand Canyon National Park', travelers: 4 },
        { parkCode: 'zion', name: 'Zion National Park', travelers: 2 },
      ]);
    const picks = await travelersAlsoLoved('u1');
    expect(picks).toHaveLength(2);
    expect(picks[0]).toEqual({ parkCode: 'grca', name: 'Grand Canyon National Park', travelers: 4 });
    expect(picks[0]).not.toHaveProperty('userId'); // identities never leak
  });
});

describe('getCollectiveOptIn', () => {
  it('defaults to false when the user has no flag', async () => {
    readGraph.mockResolvedValue([]);
    expect(await getCollectiveOptIn('u1')).toBe(false);
  });
});
