import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Static guard for scripts/seed-test-data.ts — the seed inlines every value into single-quoted Cypher
 * string literals, so an apostrophe inside any of them breaks the WHOLE seed at runtime (every integration
 * suite seeds in beforeAll → all 23 fail). Cypher does NOT support SQL-style `''` quote-doubling (only the
 * backslash escape `\'`), so an apostrophe written as `park''s` OR a lone `park's` is a syntax error.
 * This catches both without needing a Neo4j (the integration suite can't run locally against prod). Fix:
 * rephrase to avoid the apostrophe (the seed's house style), or pass the value as a $param.
 */
const seedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/seed-test-data.ts');
const src = readFileSync(seedPath, 'utf8');

describe('seed-test-data Cypher is apostrophe-safe', () => {
  it('uses no SQL-style `\'\'` quote-doubling (Cypher rejects it)', () => {
    const offenders = src.split('\n').filter((l) => l.includes("''"));
    expect(offenders, `lines with '' quote-doubling:\n${offenders.join('\n')}`).toHaveLength(0);
  });

  it('has no lone apostrophe inside a word (would terminate an inlined Cypher string early)', () => {
    const offenders = src.split('\n').filter((l) => /[A-Za-z]'[A-Za-z]/.test(l));
    expect(offenders, `lines with an in-word apostrophe:\n${offenders.join('\n')}`).toHaveLength(0);
  });
});
