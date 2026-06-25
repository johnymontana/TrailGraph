import { describe, it, expect, vi } from 'vitest';

// Pure-logic test: stub I/O so importing the module never touches a driver or the queries layer.
vi.mock('./neo4j', () => ({ readGraph: vi.fn() }));
vi.mock('./queries', () => ({ lessonPlanContext: vi.fn() }));

import { quizDifficultyForMastery, toFulltextQuery, gradeBandRange } from './learn-queries';

describe('gradeBandRange (catalog grade filter)', () => {
  it('maps known bands to [min,max], case-insensitive', () => {
    expect(gradeBandRange('k-2')).toEqual([0, 2]);
    expect(gradeBandRange('3-5')).toEqual([3, 5]);
    expect(gradeBandRange('6-8')).toEqual([6, 8]);
    expect(gradeBandRange('9-12')).toEqual([9, 12]);
    expect(gradeBandRange('K-2')).toEqual([0, 2]);
  });
  it('returns null for empty / unknown bands', () => {
    expect(gradeBandRange('')).toBeNull();
    expect(gradeBandRange(null)).toBeNull();
    expect(gradeBandRange(undefined)).toBeNull();
    expect(gradeBandRange('grad-school')).toBeNull();
  });
});

describe('toFulltextQuery (catalog search sanitizer)', () => {
  it('lowercases + prefix-wildcards each term', () => {
    expect(toFulltextQuery('Yellowstone Geology')).toBe('yellowstone* geology*');
    expect(toFulltextQuery('  wildlife  ')).toBe('wildlife*');
  });
  it('strips Lucene-operator / punctuation injection (no special chars survive)', () => {
    expect(toFulltextQuery('geology!')).toBe('geology*');
    expect(toFulltextQuery('a AND b OR (c)~*')).toBe('a* and* b* or* c*');
    expect(toFulltextQuery('"quoted" -term')).toBe('quoted* term*');
  });
  it('returns empty for an empty / punctuation-only query (caller falls back to the catalog)', () => {
    expect(toFulltextQuery('')).toBe('');
    expect(toFulltextQuery('   ')).toBe('');
    expect(toFulltextQuery('!@#$%^&*()')).toBe('');
  });
});

describe('quizDifficultyForMastery (adaptive difficulty)', () => {
  it('starts gentle for an unseen topic', () => {
    expect(quizDifficultyForMastery(null)).toBe('easy');
    expect(quizDifficultyForMastery(undefined)).toBe('easy');
  });
  it('low mastery → easy, mid → medium, high → hard', () => {
    expect(quizDifficultyForMastery(0)).toBe('easy');
    expect(quizDifficultyForMastery(0.59)).toBe('easy');
    expect(quizDifficultyForMastery(0.6)).toBe('medium');
    expect(quizDifficultyForMastery(0.8)).toBe('medium');
    expect(quizDifficultyForMastery(0.81)).toBe('hard');
    expect(quizDifficultyForMastery(1)).toBe('hard');
  });
});
