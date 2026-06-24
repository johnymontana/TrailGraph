import { describe, it, expect, vi, beforeEach } from 'vitest';

// queries.ts imports the Neo4j driver boundary at module load; mock it so this pure-logic unit test
// never touches a real DB (matches lib/memory-graph.test.ts). vibeSearch embeds the query via the
// embed-cache, so mock that too — otherwise embedQuery would issue its own readGraph cache lookup and
// shift the vibeSearch query off mock.calls[0].
vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));
vi.mock('./embed-cache', () => ({ embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) }));

import { imagesWithFallback, tripBudget, vibeSearch } from './queries';
import { readGraph } from './neo4j';

describe('imagesWithFallback (park hero image source, ADR-039 #7)', () => {
  it('prefers the rich imagesFull records when present', () => {
    const full = [{ url: 'a.jpg', caption: 'A' }, { url: 'b.jpg' }];
    expect(imagesWithFallback(full, ['x.jpg'])).toEqual(full);
  });

  it('falls back to the plain p.images URL strings when imagesFull is empty', () => {
    expect(imagesWithFallback([], ['x.jpg', 'y.jpg'])).toEqual([{ url: 'x.jpg' }, { url: 'y.jpg' }]);
  });

  it('falls back when imagesFull is null/undefined', () => {
    expect(imagesWithFallback(null, ['x.jpg'])).toEqual([{ url: 'x.jpg' }]);
    expect(imagesWithFallback(undefined, ['x.jpg'])).toEqual([{ url: 'x.jpg' }]);
  });

  it('drops malformed entries in both sources', () => {
    expect(imagesWithFallback([{ caption: 'no url' }, { url: 'ok.jpg' }], [])).toEqual([{ url: 'ok.jpg' }]);
    expect(imagesWithFallback([], [null, 42, 'ok.jpg', { url: 'obj.jpg' }])).toEqual([
      { url: 'ok.jpg' },
      { url: 'obj.jpg' },
    ]);
  });

  it('returns an empty array when there is no image anywhere', () => {
    expect(imagesWithFallback([], [])).toEqual([]);
    expect(imagesWithFallback(null, null)).toEqual([]);
    expect(imagesWithFallback('garbage', undefined)).toEqual([]);
  });
});

describe('vibeSearch constraint-aware candidates (ADR-046, Friction #2)', () => {
  const mockRead = vi.mocked(readGraph);
  beforeEach(() => {
    mockRead.mockReset();
    mockRead.mockResolvedValue([] as never);
  });

  it('appends the travel-constraint WHERE clauses + params when constraints are passed', async () => {
    await vibeSearch('dark desert canyons', {
      limit: 6,
      rvMaxLengthFt: 30,
      wheelchairAccessible: true,
      requiredAmenities: ['Restrooms'],
      maxBortle: 2,
    });
    const [q, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(q).toContain('cg.rvMaxLengthFt >= $rv');
    expect(q).toContain('cg.wheelchairAccessible = true');
    expect(q).toContain('coalesce(p.bortleScale, 99) <= $maxBortle');
    expect(q).toContain('ALL(req IN $required');
    expect(params).toMatchObject({ rv: 30, wheelchair: true, required: ['Restrooms'], maxBortle: 2 });
    // over-fetch candidates when constraints will prune (treated as facets)
    expect(params.k).toBe(6 * 6);
  });

  it('stays backward-compatible: no constraints → null/false params, smaller candidate pool', async () => {
    await vibeSearch('alpine lakes', { limit: 10 });
    const [, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(params).toMatchObject({ rv: null, wheelchair: false, required: [], maxBortle: null });
    expect(params.k).toBe(10 * 2);
  });
});

describe('tripBudget (F2)', () => {
  const mockRead = vi.mocked(readGraph);
  beforeEach(() => {
    mockRead.mockReset();
  });

  it('coerces missing matching entrance fees to 0 in the query contract', async () => {
    mockRead
      .mockResolvedValueOnce([
        { parkCode: 'acad', name: 'Acadia National Park', fee: 0, feeFree: false },
        { parkCode: 'grca', name: 'Grand Canyon National Park', fee: 0, feeFree: true },
      ] as never)
      .mockResolvedValueOnce([{ cost: 80 }] as never);

    const budget = await tripBudget(['acad', 'grca'], 'vehicle');

    const [query, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(query).toContain('ELSE coalesce(fee, 0.0) END AS fee');
    expect(params).toMatchObject({ parkCodes: ['acad', 'grca'], unit: 'vehicle' });
    expect(budget.parks).toEqual([
      { parkCode: 'acad', name: 'Acadia National Park', fee: 0, feeFree: false },
      { parkCode: 'grca', name: 'Grand Canyon National Park', fee: 0, feeFree: true },
    ]);
    expect(budget.total).toBe(0);
    expect(budget.atbCost).toBe(80);
    expect(budget.atbSaves).toBe(false);
  });
});
