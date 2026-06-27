import { describe, it, expect } from 'vitest';
import { tokenize, nameSimilarity } from './join-thingstodo-trails';

describe('tokenize', () => {
  it('lowercases, strips punctuation, drops short tokens', () => {
    expect([...tokenize('Bright Angel Trail!')]).toEqual(['bright', 'angel', 'trail']);
    expect([...tokenize('a to of')]).toEqual([]); // all ≤ 2 chars
  });
});

describe('nameSimilarity (ADR-066 ThingToDo→Trail join)', () => {
  it('scores a strong match high (stop-words ignored)', () => {
    expect(nameSimilarity('Bright Angel Trail', 'Hike the Bright Angel Trail')).toBeGreaterThan(0.5);
  });
  it('scores an unrelated pair near zero', () => {
    expect(nameSimilarity('Bright Angel Trail', 'Rim to River Road')).toBeLessThan(0.34);
  });
  it('is symmetric and bounded 0–1', () => {
    const a = nameSimilarity('South Kaibab Trail', 'Kaibab South Trail');
    const b = nameSimilarity('Kaibab South Trail', 'South Kaibab Trail');
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(1);
  });
  it('returns 0 when either side has no content tokens', () => {
    expect(nameSimilarity('the trail', 'a loop')).toBe(0); // all stop-words
  });
});
