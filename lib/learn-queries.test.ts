import { describe, it, expect, vi } from 'vitest';

// Pure-logic test: stub I/O so importing the module never touches a driver or the queries layer.
vi.mock('./neo4j', () => ({ readGraph: vi.fn() }));
vi.mock('./queries', () => ({ lessonPlanContext: vi.fn() }));

import {
  quizDifficultyForMastery,
  toFulltextQuery,
  gradeBandRange,
  crossParkTopics,
  learningTrailForTopic,
} from './learn-queries';
import { readGraph } from './neo4j';

const readGraphMock = vi.mocked(readGraph);

/** Every `$param` the Cypher references must be a key in the params object the call supplies — the
 * exact class of bug (a referenced-but-unbound param → neo4j-driver "Expected parameter(s)") that
 * typecheck/build can't see. Asserts on the recorded readGraph(cypher, params) call args. */
function expectAllParamsBound(callIndex = 0): void {
  const [cypher, params] = readGraphMock.mock.calls[callIndex] as [string, Record<string, unknown> | undefined];
  const referenced = new Set([...cypher.matchAll(/\$(\w+)/g)].map((m) => m[1]));
  for (const name of referenced) {
    expect(params, `param $${name} referenced but no params object passed`).toBeDefined();
    expect(Object.keys(params ?? {}), `param $${name} referenced but not bound`).toContain(name);
  }
}

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

describe('cross-park trail reads bind every referenced Cypher param', () => {
  it('crossParkTopics passes { limit } (default + explicit)', async () => {
    readGraphMock.mockResolvedValue([]);
    readGraphMock.mockClear();
    await crossParkTopics(10);
    expect(readGraphMock).toHaveBeenCalledTimes(1);
    expect(readGraphMock.mock.calls[0][1]).toEqual({ limit: 10 });
    expectAllParamsBound();

    readGraphMock.mockClear();
    await crossParkTopics(); // default 12
    expect(readGraphMock.mock.calls[0][1]).toEqual({ limit: 12 });
    expectAllParamsBound();
  });

  it('learningTrailForTopic passes { topic }', async () => {
    readGraphMock.mockResolvedValue([]);
    readGraphMock.mockClear();
    await learningTrailForTopic('Geology');
    expect(readGraphMock).toHaveBeenCalledTimes(1);
    expect(readGraphMock.mock.calls[0][1]).toEqual({ topic: 'Geology' });
    expectAllParamsBound();
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
