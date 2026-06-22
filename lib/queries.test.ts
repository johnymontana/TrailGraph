import { describe, it, expect, vi } from 'vitest';

// queries.ts imports the Neo4j driver boundary at module load; mock it so this pure-logic unit test
// never touches a real DB (matches lib/memory-graph.test.ts).
vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));

import { imagesWithFallback } from './queries';

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
