import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a) }));

import { resolveParkRefs } from './park-resolve';

const CODE: Record<string, string> = { zion: 'zion', 'arches national park': 'arch', arch: 'arch' };
const NAME: Record<string, string> = { zion: 'Zion National Park', arch: 'Arches National Park' };

beforeEach(() => {
  readGraph.mockReset();
  readGraph.mockImplementation(async (cypher: string, params: { q?: string; code?: string }) => {
    if (cypher.includes('park_fulltext')) {
      const code = params.q ? CODE[params.q.toLowerCase()] : undefined;
      return code ? [{ code }] : [];
    }
    if (cypher.includes('fullName AS name')) {
      return [{ name: params.code ? NAME[params.code] ?? null : null }];
    }
    return [];
  });
});

describe('resolveParkRefs (shared by build_itinerary + propose_itinerary)', () => {
  it('resolves names→codes, preserves order, de-dupes, and collects unresolved', async () => {
    const { resolved, unresolved } = await resolveParkRefs(['Zion', 'Arches National Park', 'Zion', 'Bogus Park']);
    expect(resolved).toEqual([
      { code: 'zion', name: 'Zion National Park' },
      { code: 'arch', name: 'Arches National Park' },
    ]);
    expect(unresolved).toEqual(['Bogus Park']);
  });

  it('returns empty resolved when nothing matches', async () => {
    const { resolved, unresolved } = await resolveParkRefs(['Nowhere']);
    expect(resolved).toEqual([]);
    expect(unresolved).toEqual(['Nowhere']);
  });
});
