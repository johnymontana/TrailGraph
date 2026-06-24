import { describe, it, expect, vi } from 'vitest';

// Mock the embedding call + Neo4j boundary; contentHash is stubbed to identity so the normalized-query
// key is easy to reason about. The DB tier always misses here, so we're testing the in-process LRU.
vi.mock('./embeddings', () => ({
  embed: vi.fn(),
  contentHash: (t: string) => t,
}));
vi.mock('./neo4j', () => ({
  readGraph: vi.fn().mockResolvedValue([]),
  writeGraph: vi.fn().mockResolvedValue([]),
}));

import { embedQuery } from './embed-cache';
import { embed } from './embeddings';

describe('embedQuery (audit C5 cache)', () => {
  it('embeds once, then serves equivalent queries from the LRU', async () => {
    vi.mocked(embed).mockResolvedValue([[1, 2, 3]]);
    const a = await embedQuery('Dark   Skies'); // normalizes to "dark skies"
    const b = await embedQuery('dark skies'); // same normalized key → LRU hit
    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([1, 2, 3]);
    expect(embed).toHaveBeenCalledTimes(1);
  });
});
