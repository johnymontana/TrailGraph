import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the embedding call + Neo4j boundary; contentHash → identity so the normalized query is the key.
vi.mock('./embeddings', () => ({ embed: vi.fn(), contentHash: (t: string) => t }));
vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));

import { embedQuery } from './embed-cache';
import { embed } from './embeddings';
import { readGraph, writeGraph } from './neo4j';

const mEmbed = vi.mocked(embed);
const mRead = vi.mocked(readGraph);
const mWrite = vi.mocked(writeGraph);

beforeEach(() => {
  mEmbed.mockReset();
  mRead.mockReset();
  mWrite.mockReset();
  mRead.mockResolvedValue([] as never); // DB miss by default
  mWrite.mockResolvedValue([] as never);
});

// Each test uses a UNIQUE query string — the LRU is module-level state shared across tests in this file.
describe('embedQuery (audit C5)', () => {
  it('embeds once, then serves equivalent queries from the LRU', async () => {
    mEmbed.mockResolvedValue([[1, 2, 3]] as never);
    const a = await embedQuery('Once   Alpha'); // normalizes to "once alpha"
    const b = await embedQuery('once alpha'); // same key → LRU hit
    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([1, 2, 3]);
    expect(mEmbed).toHaveBeenCalledTimes(1);
  });

  it('serves from the Neo4j cache tier on an LRU miss, without embedding', async () => {
    mRead.mockResolvedValueOnce([{ vector: [7, 8, 9] }] as never);
    const v = await embedQuery('db-hit-unique');
    expect(v).toEqual([7, 8, 9]);
    expect(mEmbed).not.toHaveBeenCalled();
  });

  it('embeds and persists on a full miss', async () => {
    mEmbed.mockResolvedValue([[4, 5, 6]] as never);
    const v = await embedQuery('full-miss-unique');
    expect(v).toEqual([4, 5, 6]);
    expect(mEmbed).toHaveBeenCalledTimes(1);
    expect(mWrite).toHaveBeenCalledTimes(1);
    const [, params] = mWrite.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.vector).toEqual([4, 5, 6]);
  });

  it('still returns the vector when the cache WRITE fails (best-effort)', async () => {
    mEmbed.mockResolvedValue([[1, 1, 1]] as never);
    mWrite.mockRejectedValue(new Error('write boom') as never);
    const v = await embedQuery('write-fail-unique');
    expect(v).toEqual([1, 1, 1]);
  });

  it('falls back to a fresh embedding when the cache READ throws', async () => {
    mRead.mockRejectedValue(new Error('read boom') as never);
    mEmbed.mockResolvedValue([[2, 2, 2]] as never);
    const v = await embedQuery('read-fail-unique');
    expect(v).toEqual([2, 2, 2]);
  });
});
