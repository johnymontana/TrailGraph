import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P1.3 read-only tour preview. Mocks the Neo4j boundary so we test the pure SHAPING of previewTourFromTour:
 * title → "<title> (tour)", ordered stops, dropping null/nameless TourStops, and the null guards — without
 * a DB. The query itself (ordering, AT-target resolution) is covered by tour-confirm.itest.ts.
 */
vi.mock('../../lib/neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));

import { readGraph } from '../../lib/neo4j';
import { previewTourFromTour } from '../../lib/trips';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = (r: unknown[]) => vi.mocked(readGraph).mockResolvedValue(r as any);

beforeEach(() => vi.clearAllMocks());

describe('previewTourFromTour shaping (P1.3, no write)', () => {
  it('names the trip "<title> (tour)" and keeps the ordered named stops', async () => {
    rows([{ title: 'Canyon Rim Tour', stops: [{ ordinal: 0, name: 'Artist Point' }, { ordinal: 1, name: 'Canyon Visitor Center' }] }]);
    const r = await previewTourFromTour('tour-1');
    expect(r).toEqual({ name: 'Canyon Rim Tour (tour)', stops: [{ name: 'Artist Point' }, { name: 'Canyon Visitor Center' }] });
    expect(vi.mocked(readGraph)).toHaveBeenCalledOnce();
  });

  it('drops null entries (a TourStop with no AT target) and nameless stops', async () => {
    rows([{ title: 'T', stops: [null, { ordinal: 0, name: 'Has Name' }, { ordinal: 1, name: null }] }]);
    const r = await previewTourFromTour('t');
    expect(r?.stops).toEqual([{ name: 'Has Name' }]);
  });

  it('returns null when the tour does not exist (no title)', async () => {
    rows([{ title: null, stops: [] }]);
    expect(await previewTourFromTour('missing')).toBeNull();
  });

  it('returns null when there are no rows at all', async () => {
    rows([]);
    expect(await previewTourFromTour('missing')).toBeNull();
  });

  it('returns null when the tour exists but has no usable (named) stops', async () => {
    rows([{ title: 'Empty Tour', stops: [null, { ordinal: 0, name: null }] }]);
    expect(await previewTourFromTour('empty')).toBeNull();
  });
});
