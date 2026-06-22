import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB layer so canonicalize's alias map is seeded from a fixed vocabulary.
vi.mock('./neo4j', () => ({
  readGraph: vi.fn().mockResolvedValue([
    { activities: ['Astronomy', 'Hiking', 'Birdwatching'], topics: ['Volcanoes', 'Lakes'] },
  ]),
}));

import { canonicalizeValue, extractCanonicalTerms, resetAliasCache } from './canonicalize';

describe('canonicalizeValue', () => {
  beforeEach(() => resetAliasCache());

  it('matches an exact domain activity name (case-insensitive)', async () => {
    expect(await canonicalizeValue('astronomy')).toMatchObject({ kind: 'activity', name: 'Astronomy', method: 'exact' });
  });

  it('matches an exact domain topic name', async () => {
    expect(await canonicalizeValue('Volcanoes')).toMatchObject({ kind: 'topic', name: 'Volcanoes', method: 'exact' });
  });

  it('resolves a curated synonym to the canonical NPS name', async () => {
    expect(await canonicalizeValue('stargazing')).toMatchObject({ kind: 'activity', name: 'Astronomy', method: 'synonym' });
    expect(await canonicalizeValue('dark skies')).toMatchObject({ name: 'Astronomy' });
  });

  it('returns null when there is no confident match (no laundered guess)', async () => {
    expect(await canonicalizeValue('underwater basket weaving')).toBeNull();
  });
});

describe('extractCanonicalTerms (deterministic recall, R2 §3.2)', () => {
  beforeEach(() => resetAliasCache());

  it('captures ALL stated preferences from one sentence', async () => {
    const got = await extractCanonicalTerms(
      'I love alpine lakes, dark skies for stargazing, and quiet parks with easy hikes',
    );
    const names = got.map((g) => g.target.name);
    expect(names).toEqual(expect.arrayContaining(['Lakes', 'Astronomy', 'Hiking']));
  });

  it('prefers the longer phrase ("alpine lakes" → Lakes) and de-dupes by canonical node', async () => {
    const got = await extractCanonicalTerms('alpine lakes and more lakes');
    expect(got.filter((g) => g.target.name === 'Lakes')).toHaveLength(1);
  });

  it('returns nothing for text with no known terms', async () => {
    expect(await extractCanonicalTerms('the weather was pleasant today')).toEqual([]);
  });
});
