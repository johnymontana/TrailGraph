import { describe, it, expect } from 'vitest';
import { encodeSeed, decodeSeed } from './graph-handoff';

/**
 * Gap coverage for the #10 plan-from-graph codec (graph-handoff.test.ts owns the main round-trip / dedupe /
 * cap / null suite). Here we pin the CODE_RE `{2,12}` length boundaries and the non-array / non-string
 * iterable input branches that the existing suite doesn't exercise.
 */
describe('graph-handoff codec — length boundaries + iterable/coercion gaps', () => {
  it('accepts 2-char and 12-char codes, rejects 1-char and 13-char (CODE_RE boundaries)', () => {
    expect(decodeSeed('ab')).toEqual(['ab']); // min length
    expect(decodeSeed('a')).toEqual([]); // below min
    expect(decodeSeed('abcdefghijkl')).toEqual(['abcdefghijkl']); // exactly 12
    expect(decodeSeed('abcdefghijklm')).toEqual([]); // 13 → over max
  });

  it('accepts all-numeric and alphanumeric codes (NPS codes are short alphanumerics)', () => {
    expect(decodeSeed('p0,12,3a4b')).toEqual(['p0', '12', '3a4b']);
  });

  it('encodeSeed accepts any iterable, not just arrays (Set / generator)', () => {
    expect(encodeSeed(new Set(['yell', 'grca', 'yell']))).toBe('yell,grca'); // Set dedupes + codec dedupes
    function* gen() {
      yield 'ZION';
      yield ' yell ';
    }
    expect(encodeSeed(gen())).toBe('zion,yell'); // lowercased + trimmed
  });

  it('encodeSeed coerces non-string members via String() before validating', () => {
    // numbers become valid short alphanumeric codes; a junk object coerces to an invalid token and is dropped.
    expect(encodeSeed([123, 'yell'] as unknown as string[])).toBe('123,yell');
    expect(encodeSeed([{} as unknown as string, 'grca'])).toBe('grca');
  });
});
