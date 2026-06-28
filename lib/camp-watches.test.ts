import { describe, it, expect, vi } from 'vitest';

// camp-watches.ts imports the Neo4j boundary at module load; mock it so we can unit-test the pure
// cancellation-diff helper without a DB.
vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));

import { freshOpenings } from './camp-watches';

describe('freshOpenings (cancellation detection)', () => {
  it('returns only keys absent from the prior snapshot', () => {
    const prev = JSON.stringify(['cg|2026-07-03|s1', 'cg|2026-07-04|s2']);
    const now = ['cg|2026-07-03|s1', 'cg|2026-07-04|s2', 'cg|2026-07-05|s9']; // s9 is new
    expect(freshOpenings(prev, now)).toEqual(['cg|2026-07-05|s9']);
  });

  it('treats a null/garbage snapshot as empty (everything is fresh)', () => {
    expect(freshOpenings(null, ['a', 'b'])).toEqual(['a', 'b']);
    expect(freshOpenings('not json', ['a'])).toEqual(['a']);
    expect(freshOpenings('{}', ['a'])).toEqual(['a']); // not an array → empty
  });

  it('returns [] when nothing new opened (a still-open site does not re-alert)', () => {
    const prev = JSON.stringify(['cg|2026-07-03|s1']);
    expect(freshOpenings(prev, ['cg|2026-07-03|s1'])).toEqual([]);
  });

  it('a site that closed then reopened is fresh again', () => {
    // snapshot had s1 open; now s1 is gone (closed) and s2 opened → only s2 is fresh
    const prev = JSON.stringify(['cg|2026-07-03|s1']);
    expect(freshOpenings(prev, ['cg|2026-07-03|s2'])).toEqual(['cg|2026-07-03|s2']);
  });
});
