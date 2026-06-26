import { describe, it, expect } from 'vitest';
import { encodeSeed, decodeSeed, SEED_CAP } from './graph-handoff';

describe('graph-handoff seed codec (#10 plan-from-graph)', () => {
  it('encode → decode round-trips a clean park-code list', () => {
    expect(encodeSeed(['yell', 'grca', 'zion'])).toBe('yell,grca,zion');
    expect(decodeSeed('yell,grca,zion')).toEqual(['yell', 'grca', 'zion']);
  });

  it('normalises case + whitespace and dedupes, preserving first-seen order', () => {
    expect(decodeSeed(' YELL , grca ,yell, GRCA ')).toEqual(['yell', 'grca']);
    expect(encodeSeed(['YELL', 'Yell', 'grca'])).toBe('yell,grca');
  });

  it('drops invalid entries (empty, punctuation, over-long, injection)', () => {
    expect(decodeSeed('yell,,gr ca,$$$,zion')).toEqual(['yell', 'zion']);
    expect(decodeSeed('a,reallylongnotacode123456,grca')).toEqual(['grca']); // 'a' too short, long one rejected
    expect(decodeSeed("yell'; MATCH (n) DETACH DELETE n")).toEqual([]); // no valid token survives
  });

  it('caps the list at SEED_CAP', () => {
    const many = Array.from({ length: SEED_CAP + 5 }, (_, i) => `p${i}`);
    expect(decodeSeed(many.join(',')).length).toBe(SEED_CAP);
    expect(encodeSeed(many).split(',').length).toBe(SEED_CAP);
  });

  it('returns [] for null/undefined/empty', () => {
    expect(decodeSeed(null)).toEqual([]);
    expect(decodeSeed(undefined)).toEqual([]);
    expect(decodeSeed('')).toEqual([]);
    expect(encodeSeed([])).toBe('');
  });
});
